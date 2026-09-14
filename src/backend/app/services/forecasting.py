"""Congestion forecasting — LightGBM with quantile uncertainty bands.

Implements the plan's forecasting approach (doc 3 §4.1):
  * targets: congestion index, queue length, average anchorage wait, yard utilisation
  * features: lag/rolling congestion, calendar terms, ETA arrival pressure (bunching),
    berth load factor
  * model: **LightGBM** point model + **quantile regression** (alpha 0.1 / 0.9) which
    gives the uncertainty band "almost for free"
  * reproducible: a model version is attached to every run (log it with predictions)

Recursive 1-step rollout produces the 24/48/72h horizon; a 48h holdout plus
multi-origin rollouts give MAE / R^2 / skill-vs-persistence and per-horizon sigma.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import lightgbm as lgb
import numpy as np
from sqlalchemy import select

from .. import reference as ref
from ..config import get_settings
from ..models import WeatherObservation

HORIZON = 72
HOLDOUT_HOURS = 48
ROLLOUT_ORIGINS = 8
QUANTILE_LO, QUANTILE_HI = 0.10, 0.90
Z_80 = 1.2816  # 80% band

# ---- W2 confidence / weather (documented constants) -------------------------
EXPECTED_HISTORY = 336        # 14 days of hourly history is the reference "full" support
MIN_TRAIN_ROWS = 26           # below this LightGBM cannot be trained -> baseline fallback
MIN_WEATHER_ROWS = 6          # fewer usable weather hours than this -> treat weather as unavailable
BAND_REFERENCE = 45.0         # band width (index points) at which uncertainty confidence -> 0
WEATHER_INDEX_LIFT = 12.0     # max index points added by the most severe forecast weather
WEATHER_BAND_LIFT = 10.0      # max extra half-band width (index points) under adverse weather

FEATURES = [
    "index_t", "d_index_1h", "index_t_24", "d_index_24h", "mean_index_6h", "mean_index_24h",
    "queue_t", "wait_t", "yard_t", "hour_sin", "hour_cos", "dow_sin", "dow_cos",
    "arrival_pressure_6h", "berth_load_factor",
]
TARGETS = ("index", "queue", "wait", "yard")

LGB_PARAMS = dict(
    objective="regression", n_estimators=140, learning_rate=0.05, num_leaves=15,
    min_child_samples=8, subsample=0.9, colsample_bytree=0.9, verbose=-1, n_jobs=2,
)


@dataclass
class ForecastPoint:
    hour: int
    ts: datetime
    index: float
    queue: float
    wait: float
    yard_util: float
    lo: float
    hi: float
    # per-target prediction intervals (Module F: band for queue / wait / utilisation too)
    queue_lo: float = 0.0
    queue_hi: float = 0.0
    wait_lo: float = 0.0
    wait_hi: float = 0.0
    yard_lo: float = 0.0
    yard_hi: float = 0.0


@dataclass
class ForecastResult:
    zone_code: str
    zone_name: str
    points: list[ForecastPoint] = field(default_factory=list)
    current: dict = field(default_factory=dict)
    peak: dict = field(default_factory=dict)
    avg_index: float = 0.0
    drivers: list[dict] = field(default_factory=list)
    model: dict = field(default_factory=dict)
    validation: dict = field(default_factory=dict)
    capacity: dict = field(default_factory=dict)
    # --- W2 confidence / provenance / weather (additive) ---
    confidence: float = 1.0
    confidence_by_horizon: dict = field(default_factory=dict)
    horizons: dict = field(default_factory=dict)
    weather_used: bool = False
    data_version: str = ""


# ------------------------------------------------------------------ features
def _feature_matrix(idx, q, w, yard, ms_of, arrival6, load_factor, t):
    m = lambda a, f, to: float(np.mean(a[max(0, f): to + 1]))  # noqa: E731
    d = datetime.fromtimestamp(ms_of(t) / 1000.0, tz=timezone.utc)
    hod = d.hour + d.minute / 60.0
    return [
        idx[t] / 100.0,
        (idx[t] - idx[t - 1]) / 20.0,
        idx[t - 24] / 100.0,
        (idx[t] - idx[t - 24]) / 20.0,
        m(idx, t - 5, t) / 100.0,
        m(idx, t - 23, t) / 100.0,
        q[t] / 10.0,
        w[t] / 24.0,
        yard[t] / 100.0,
        np.sin(2 * np.pi * hod / 24.0),
        np.cos(2 * np.pi * hod / 24.0),
        np.sin(2 * np.pi * d.weekday() / 7.0),
        np.cos(2 * np.pi * d.weekday() / 7.0),
        arrival6 / 3.0,
        load_factor,
    ]


def _arrival_schedule(vessels, horizon: int) -> np.ndarray:
    """Ready-to-berth arrivals per hour ahead (INBOUND only; anchored vessels are the current queue)."""
    sched = np.zeros(horizon + 1)
    for v in vessels:
        if v.status != "INBOUND":
            continue
        h = int(max(1, min(horizon, round(v.eta_hours))))
        sched[h] += 1
    return sched


def _pressure6(sched: np.ndarray, hours_ahead: int) -> float:
    lo = max(1, hours_ahead - 5)
    hi = min(len(sched) - 1, hours_ahead)
    return float(sched[lo:hi + 1].sum())


# ------------------------------------------------------- W2 confidence / weather
def _clip(x, lo, hi):
    return max(lo, min(hi, x))


def _feature_flags() -> dict:
    """Feature flags attached to every forecast run (Phase-0 frozen ForecastRun.feature_flags)."""
    s = get_settings()
    return {"weather": s.feature_weather, "quality": s.feature_quality, "upload": s.feature_upload,
            "tidal": s.feature_tidal, "incremental": s.feature_incremental,
            "scenarios_ext": s.feature_scenarios_ext}


def load_weather_series(db, t0: datetime | None = None, horizon: int = HORIZON) -> list[dict]:
    """W2 consumes W1's weather (WeatherObservation) — the pipeline itself stays W1's.

    Returns forecast-horizon points (``hours_ago`` <= 0) keyed by hours ahead. Never
    raises: an empty list means "weather unavailable" and forecasting still works.
    """
    if db is None:
        return []
    try:
        rows = db.execute(
            select(WeatherObservation)
            .where(WeatherObservation.hours_ago <= 0)
            .where(WeatherObservation.hours_ago >= -horizon)
            .order_by(WeatherObservation.hours_ago.desc())
        ).scalars().all()
    except Exception:  # noqa: BLE001 - weather must never break forecasting
        return []
    return [{
        "hours_ahead": max(1, -int(r.hours_ago)),
        "hours_ago": int(r.hours_ago),
        "wind_kn": r.wind_kn,
        "gust_kn": r.gust_kn,
        "wave_m": r.wave_m,
        "visibility_km": r.visibility_km,
    } for r in rows]


def _weather_severity(w: dict) -> float:
    """0..1 adverse-weather severity from the frozen schema (gust/wind, wave, visibility)."""
    gust = w.get("gust_kn") if w.get("gust_kn") is not None else w.get("wind_kn")
    wave = w.get("wave_m")
    vis = w.get("visibility_km")
    sev = 0.0
    if gust is not None:
        sev += 0.6 * _clip((float(gust) - 25.0) / 25.0, 0.0, 1.0)
    if wave is not None:
        sev += 0.3 * _clip((float(wave) - 2.5) / 2.5, 0.0, 1.0)
    if vis is not None:
        sev += 0.1 * _clip((5.0 - float(vis)) / 5.0, 0.0, 1.0)
    return _clip(sev, 0.0, 1.0)


def _compute_confidence(history, mean_sigma: float, holdout_index: dict, weather_used: bool,
                        weather_requested: bool) -> float:
    """Logical confidence 0..1 built from data support, forecast uncertainty and skill.

    Never constant: sparse history, wide bands or a model that does not beat persistence
    all pull it down; it is capped below 1.0 on purpose.
    """
    n = len(history)
    hist_support = _clip(n / EXPECTED_HISTORY, 0.0, 1.0)
    unc_support = _clip(1.0 - (Z_80 * float(mean_sigma)) / BAND_REFERENCE, 0.0, 1.0)
    skill = float((holdout_index or {}).get("skill_pct", 0.0) or 0.0)
    skill_support = _clip(0.5 + skill / 100.0, 0.0, 1.0)
    r2 = float((holdout_index or {}).get("r2", 0.0) or 0.0)
    r2_support = _clip(0.5 + r2, 0.0, 1.0)
    conf = 0.35 * hist_support + 0.30 * unc_support + 0.20 * skill_support + 0.15 * r2_support
    if weather_requested and not weather_used:
        conf *= 0.95  # flag on but no usable weather -> slightly less certain
    return round(_clip(conf, 0.05, 0.98), 3)


def _confidence_by_horizon(buckets, history, holdout_index, weather_requested) -> dict:
    groups = {"h24": ("1-12h", "13-24h"), "h48": ("25-48h",), "h72": ("49-72h",)}
    out = {}
    for label, keys in groups.items():
        sigmas = [b["sigma"] for b in buckets if b["label"] in keys and b.get("sigma") is not None]
        mean_sigma = float(np.mean(sigmas)) if sigmas else 8.0
        out[label] = _compute_confidence(history, mean_sigma, holdout_index, False, weather_requested)
    return out


def _horizon_summary(points) -> dict:
    out = {}
    for label, last in (("h24", 24), ("h48", 48), ("h72", 72)):
        window = [p for p in points if p.hour <= last]
        if not window:
            continue
        pk = max(window, key=lambda p: p.index)
        out[label] = {"peak_index": pk.index, "peak_hour": pk.hour, "queue": pk.queue,
                      "wait": pk.wait, "yard_util": pk.yard_util}
    return out


def _coverage(resid, sigma) -> float:
    """Empirical coverage of the 80% band over the multi-origin residuals (calibration check)."""
    tot = hit = 0
    for i, errs in enumerate(resid):
        for e in errs:
            tot += 1
            if abs(e) <= Z_80 * sigma[i]:
                hit += 1
    return (hit / tot) if tot else 0.0


def apply_weather_adjustment(fc: ForecastResult, weather: list[dict]) -> bool:
    """Exogenous weather adjustment — W2 consumes W1 weather, it never rebuilds the pipeline.

    Applied only when ``FEATURE_WEATHER`` is on and >= MIN_WEATHER_ROWS usable weather hours
    exist. Raises the index/queue/wait under adverse conditions, widens the bands and flips
    ``weather_used``. Returns True iff weather was actually used.
    """
    settings = get_settings()
    if not settings.feature_weather or fc.weather_used or not weather:
        return False
    by_ahead = {int(w["hours_ahead"]): w for w in weather if w.get("hours_ahead")}
    if len(by_ahead) < MIN_WEATHER_ROWS:
        return False
    sev = {h: _weather_severity(w) for h, w in by_ahead.items()}
    max_sev = max(sev.values(), default=0.0)
    if max_sev <= 0.0:
        return False
    nearest = sorted(by_ahead)
    for p in fc.points:
        s = sev.get(p.hour)
        if s is None:
            near = min(nearest, key=lambda h: abs(h - p.hour))
            s = sev.get(near, 0.0)
        if s <= 0:
            continue
        p.index = round(_clip(p.index + WEATHER_INDEX_LIFT * s, 0.0, 100.0), 1)
        p.queue = round(p.queue * (1.0 + 0.15 * s), 1)
        p.wait = round(p.wait * (1.0 + 0.20 * s), 1)
        extra = WEATHER_BAND_LIFT * s
        p.lo = round(max(0.0, p.lo - extra), 1)
        p.hi = round(min(100.0, p.hi + extra), 1)
        # widen the per-target intervals too
        p.queue_lo = round(max(0.0, p.queue_lo - 0.3 * extra), 1)
        p.queue_hi = round(p.queue_hi + 0.3 * extra, 1)
        p.wait_lo = round(max(1.0, p.wait_lo - 0.5 * extra), 1)
        p.wait_hi = round(p.wait_hi + 0.5 * extra, 1)
        p.yard_lo = round(max(0.0, p.yard_lo - 0.3 * extra), 1)
        p.yard_hi = round(min(100.0, p.yard_hi + 0.3 * extra), 1)
    peak = max(fc.points, key=lambda p: p.index)
    fc.peak = {"hour": peak.hour, "index": peak.index}
    fc.avg_index = round(sum(p.index for p in fc.points) / len(fc.points), 1)
    fc.drivers = list(fc.drivers) + [{
        "label": "Adverse weather",
        "detail": f"Weather signal applied (peak severity {max_sev:.2f}) to index/queue/wait; bands widened."}]
    fc.weather_used = True
    fc.horizons = _horizon_summary(fc.points)
    if isinstance(fc.model, dict):
        fc.model["weather_used"] = True
    return True


def _baseline_forecast(zone_code, zone_name, history, vessels, capacity, t0, source) -> ForecastResult:
    """Moving-average + arrival-pressure fallback for terminals with too little history.

    Doc 3 risk table: "fall back to a simpler baseline ... with explicit low-confidence
    labelling" instead of crashing or pretending certainty.
    """
    H = len(history)
    idx = np.array([h.index for h in history], dtype=float) if H else np.array([50.0])
    q = np.array([h.queue_count for h in history], dtype=float) if H else np.array([10.0])
    w = np.array([h.avg_wait_hours for h in history], dtype=float) if H else np.array([24.0])
    yard = np.array([(h.yard_util_pct or 0.0) for h in history], dtype=float) if H else np.array([60.0])
    sched = _arrival_schedule(vessels, HORIZON)
    base_idx = float(np.mean(idx[-24:]))
    base_q = float(np.mean(q[-24:]))
    base_w = float(np.mean(w[-24:]))
    base_yard = float(np.mean(yard[-24:]))
    slope = float((idx[-1] - idx[-6]) / 5.0) if H >= 6 else 0.0

    points = []
    for i in range(HORIZON):
        h = i + 1
        press = _pressure6(sched, h)
        decay = 0.85 ** (h / 6.0)
        pidx = _clip(base_idx + slope * h * decay + 1.2 * press, 0.0, 100.0)
        band = Z_80 * (8.0 + 0.05 * h)
        qv = round(max(0.0, base_q + 0.4 * press), 1)
        wv = round(max(1.0, base_w + 1.0 * press), 1)
        yv = round(_clip(base_yard, 0.0, 100.0), 1)
        points.append(ForecastPoint(
            hour=h, ts=t0 + timedelta(hours=h), index=round(pidx, 1),
            queue=qv, wait=wv, yard_util=yv,
            lo=round(max(0.0, pidx - band), 1), hi=round(min(100.0, pidx + band), 1),
            queue_lo=round(max(0.0, qv - Z_80 * (2.0 + 0.02 * h)), 1),
            queue_hi=round(qv + Z_80 * (2.0 + 0.02 * h), 1),
            wait_lo=round(max(1.0, wv - Z_80 * (4.0 + 0.03 * h)), 1),
            wait_hi=round(wv + Z_80 * (4.0 + 0.03 * h), 1),
            yard_lo=round(_clip(yv - Z_80 * (3.0 + 0.02 * h), 0.0, 100.0), 1),
            yard_hi=round(_clip(yv + Z_80 * (3.0 + 0.02 * h), 0.0, 100.0), 1),
        ))
    peak = max(points, key=lambda p: p.index)
    buckets = [
        {"label": "1-12h", "mae": None, "sigma": 8.5, "bias": None, "n": 0},
        {"label": "13-24h", "mae": None, "sigma": 9.0, "bias": None, "n": 0},
        {"label": "25-48h", "mae": None, "sigma": 10.0, "bias": None, "n": 0},
        {"label": "49-72h", "mae": None, "sigma": 11.5, "bias": None, "n": 0},
    ]
    data_version = f"{source}:{H}obs@{t0.strftime('%Y%m%dT%H%M')}"
    conf = _compute_confidence(history, 10.0, {}, False, get_settings().feature_weather)
    return ForecastResult(
        zone_code=zone_code, zone_name=zone_name, points=points,
        current={"index": round(base_idx, 1), "queue": int(base_q), "wait": round(base_w, 1),
                 "yard_util": round(base_yard, 1)},
        peak={"hour": peak.hour, "index": peak.index},
        avg_index=round(sum(p.index for p in points) / len(points), 1),
        drivers=[{"label": "Sparse history",
                  "detail": f"only {H}h of history (<{MIN_TRAIN_ROWS}h) — moving-average + arrival-pressure "
                            f"baseline; confidence explicitly low."}],
        model={"algorithm": "moving-average baseline (sparse history)",
               "model_version": f"baseline-ma-{H}obs", "features": ["index_mean_24h", "queue_mean_24h",
               "wait_mean_24h", "arrival_pressure_6h"], "feature_importance": {}, "top_features": [],
               "training_rows": 0, "holdout_hours": 0, "mae24": None, "mae72": None, "r2": 0.0,
               "skill_pct": 0.0, "trained_at": datetime.now(timezone.utc).isoformat(),
               "data_version": data_version, "feature_flags": _feature_flags(),
               "weather_used": False, "confidence": conf,
               "calibration": {"coverage_80": 0.0, "origins": 0}},
        validation={"buckets": buckets, "origins": 0,
                    "holdout": {"index": {"mae": None, "r2": 0.0, "skill_pct": 0.0}},
                    "method": "baseline (insufficient history)"},
        capacity=capacity, confidence=conf,
        confidence_by_horizon=_confidence_by_horizon(buckets, history, {}, get_settings().feature_weather),
        horizons=_horizon_summary(points), weather_used=False, data_version=data_version,
    )


# ------------------------------------------------------------------ main
def forecast_zone(zone_code, zone_name, history, vessels, capacity, t0: datetime,
                  weather: list[dict] | None = None, source: str = "DEMO_AIS") -> ForecastResult:
    H = len(history)
    # Sparse history: never crash, never pretend certainty (doc 3 risk table / Module F).
    if H < MIN_TRAIN_ROWS or H - 1 <= 24:
        result = _baseline_forecast(zone_code, zone_name, history, vessels, capacity, t0, source)
        if weather:
            apply_weather_adjustment(result, weather)
        return result
    load_factor = min(1.0, capacity["cranes"] / 18.0)
    sched = _arrival_schedule(vessels, HORIZON)

    idx = np.array([h.index for h in history], dtype=float)
    q = np.array([h.queue_count for h in history], dtype=float)
    w = np.array([h.avg_wait_hours for h in history], dtype=float)
    yard = np.array([(h.yard_util_pct or 0.0) for h in history], dtype=float)
    arr_rate = capacity["berths"] / ref.BERTH_TURNAROUND_HOURS  # historical inflow proxy (vessels/h)

    target = {"index": idx, "queue": q, "wait": w, "yard": yard}
    ms_of = lambda p: t0.timestamp() * 1000 - (H - 1 - p) * 3_600_000  # noqa: E731

    # training rows (1-step): predict t+1 from data <= t
    X_tr, y_tr, X_ho, y_ho = [], {k: [] for k in TARGETS}, [], {k: [] for k in TARGETS}
    for t in range(24, H - 1):
        # historical inflow pressure from queue deltas + service outflow
        inflow6 = sum(max(0.0, q[k] - q[k - 1]) + arr_rate for k in range(max(1, t - 5), t + 1))
        f = _feature_matrix(idx, q, w, yard, ms_of, inflow6, load_factor, t)
        nxt = {k: target[k][t + 1] for k in TARGETS}
        if t >= H - HOLDOUT_HOURS:
            X_ho.append(f)
            for k in TARGETS:
                y_ho[k].append(nxt[k])
        else:
            X_tr.append(f)
            for k in TARGETS:
                y_tr[k].append(nxt[k])

    X_tr = np.array(X_tr)
    X_ho = np.array(X_ho) if X_ho else np.empty((0, len(FEATURES)))

    models: dict[str, lgb.LGBMRegressor] = {}
    qlo: dict[str, lgb.LGBMRegressor] = {}
    qhi: dict[str, lgb.LGBMRegressor] = {}
    holdout: dict[str, dict] = {}
    importances: dict[str, float] = {}

    for k in TARGETS:
        m = lgb.LGBMRegressor(**LGB_PARAMS)
        m.fit(X_tr, np.array(y_tr[k]))
        models[k] = m
        if k == "index":
            importances = dict(zip(FEATURES, (m.feature_importances_ / max(1, m.feature_importances_.sum())).round(4).tolist()))
            for tag, alpha, store in (("lo", QUANTILE_LO, qlo), ("hi", QUANTILE_HI, qhi)):
                qm = lgb.LGBMRegressor(**{**LGB_PARAMS, "objective": "quantile", "alpha": alpha})
                qm.fit(X_tr, np.array(y_tr[k]))
                store[k] = qm
        # 1-step holdout metrics
        if len(X_ho):
            pred = m.predict(X_ho)
            actual = np.array(y_ho[k])
            err = actual - pred
            sse = float(np.sum(err ** 2))
            sst = float(np.sum((actual - actual.mean()) ** 2))
            pers = np.array([target[k][H - HOLDOUT_HOURS - 1]] * len(actual))
            pmae = float(np.mean(np.abs(actual - pers)))
            mae = float(np.mean(np.abs(err)))
            holdout[k] = {
                "mae": round(mae, 2),
                "r2": round(1 - sse / sst, 3) if sst > 0 else 0.0,
                "skill_pct": round((pmae - mae) / pmae * 100, 1) if pmae > 0 else 0.0,
            }

    # ---------------- recursive rollout
    def rollout(from_pos: int, horizon: int, use_schedule: bool):
        wi, wq, ww, wy = idx.copy(), q.copy(), w.copy(), yard.copy()
        out = {"index": [], "queue": [], "wait": [], "yard": [], "lo": [], "hi": []}
        for h in range(1, horizon + 1):
            t = from_pos + h
            ahead = t - (H - 1)
            if use_schedule and ahead > 0:
                ap6 = _pressure6(sched, ahead)
            else:
                ap6 = sum(max(0.0, wq[k] - wq[k - 1]) + arr_rate for k in range(max(1, t - 1 - 5), t))
            f = np.array([_feature_matrix(wi, wq, ww, wy, ms_of, ap6, load_factor, t - 1)])
            step = {k: float(models[k].predict(f)[0]) for k in TARGETS}
            step["index"] = float(np.clip(step["index"], 0, 100))
            step["queue"] = max(0.0, step["queue"])
            step["wait"] = max(1.0, step["wait"])
            step["yard"] = float(np.clip(step["yard"], 0, 100))
            lo = float(np.clip(qlo["index"].predict(f)[0], 0, 100)) if "index" in qlo else max(0.0, step["index"] - 8)
            hi = float(np.clip(qhi["index"].predict(f)[0], 0, 100)) if "index" in qhi else min(100.0, step["index"] + 8)
            wi = np.append(wi, step["index"]); wq = np.append(wq, step["queue"])
            ww = np.append(ww, step["wait"]); wy = np.append(wy, step["yard"])
            out["index"].append(step["index"]); out["queue"].append(step["queue"])
            out["wait"].append(step["wait"]); out["yard"].append(step["yard"])
            out["lo"].append(lo); out["hi"].append(hi)
        return out

    # ---------------- per-horizon sigma from multi-origin rollouts (per target)
    resid = {k: [[] for _ in range(HORIZON)] for k in TARGETS}
    actuals = {"index": idx, "queue": q, "wait": w, "yard": yard}
    first = max(30, H - 1 - HOLDOUT_HOURS - 120)
    span = max(1, H - 1 - HOLDOUT_HOURS - first)
    for o in range(ROLLOUT_ORIGINS):
        origin = first + int(o * span / ROLLOUT_ORIGINS)
        r = rollout(origin, HORIZON, use_schedule=False)
        for h in range(1, HORIZON + 1):
            pos = origin + h
            if pos < H:
                for k in TARGETS:
                    resid[k][h - 1].append(float(actuals[k][pos] - r[k][h - 1]))
    sigma = {k: np.array([max(1.5, float(np.std(a)) if len(a) > 1 else 6.0) for a in resid[k]])
             for k in TARGETS}

    mae24 = mae72 = 0.0
    n24 = n72 = 0
    for hI, a in enumerate(resid["index"]):
        for e in a:
            ae = abs(e)
            if hI + 1 <= 24:
                mae24 += ae; n24 += 1
            mae72 += ae; n72 += 1

    # ---------------- production rollout from now
    fc = rollout(H - 1, HORIZON, use_schedule=True)
    points = []
    for i in range(HORIZON):
        band = Z_80 * sigma["index"][i]
        lo = max(fc["lo"][i], fc["index"][i] - band)
        hi = min(100.0, max(fc["hi"][i], fc["index"][i] + band))
        qb, wb, yb = Z_80 * sigma["queue"][i], Z_80 * sigma["wait"][i], Z_80 * sigma["yard"][i]
        points.append(ForecastPoint(
            hour=i + 1, ts=t0 + timedelta(hours=i + 1),
            index=round(fc["index"][i], 1), queue=round(fc["queue"][i], 1),
            wait=round(fc["wait"][i], 1), yard_util=round(fc["yard"][i], 1),
            lo=round(lo, 1), hi=round(hi, 1),
            queue_lo=round(max(0.0, fc["queue"][i] - qb), 1), queue_hi=round(fc["queue"][i] + qb, 1),
            wait_lo=round(max(1.0, fc["wait"][i] - wb), 1), wait_hi=round(fc["wait"][i] + wb, 1),
            yard_lo=round(float(_clip(fc["yard"][i] - yb, 0.0, 100.0)), 1),
            yard_hi=round(float(_clip(fc["yard"][i] + yb, 0.0, 100.0)), 1),
        ))
    peak = max(points, key=lambda p: p.index)
    avg_index = sum(p.index for p in points) / len(points)

    # ---------------- drivers (heuristic, documented)
    drivers: list[dict] = []
    peak_pressure = _pressure6(sched, peak.hour)
    avg_window = float(sched.sum()) / HORIZON * 6
    if peak_pressure > max(1.5, avg_window * 1.4):
        drivers.append({"label": "Arrival surge (bunching)",
                        "detail": f"{peak_pressure:.0f} vessels ready-to-berth in the 6h before the +{peak.hour}h peak."})
    if idx[-1] > 55:
        drivers.append({"label": "Sustained queue pressure",
                        "detail": f"Current index {idx[-1]:.0f}/100 with {q[-1]:.0f} vessels waiting carried forward."})
    peak_hod = peak.ts.hour
    if 4 <= peak_hod <= 11:
        drivers.append({"label": "Diurnal peak window",
                        "detail": f"Peak lands in the {peak_hod:02d}:00Z morning arrival bank."})
    if not drivers:
        drivers.append({"label": "Service catch-up regime",
                        "detail": "Arrival pressure near average; berth capacity can absorb the queue if crane productivity holds."})

    top_features = sorted(importances.items(), key=lambda kv: kv[1], reverse=True)[:6]
    model_version = f"lgbm-{lgb.__version__}-{'/'.join(f'{t}' for t in TARGETS)}-{len(FEATURES)}f"
    buckets = _buckets(resid["index"], sigma["index"])
    mean_sigma = float(np.mean(sigma["index"]))
    holdout_index = holdout.get("index", {})
    weather_requested = get_settings().feature_weather
    data_version = f"{source}:{H}obs@{t0.strftime('%Y%m%dT%H%M')}"
    confidence = _compute_confidence(history, mean_sigma, holdout_index, False, weather_requested)
    conf_by_horizon = _confidence_by_horizon(buckets, history, holdout_index, weather_requested)
    result = ForecastResult(
        zone_code=zone_code, zone_name=zone_name, points=points,
        current={"index": round(float(idx[-1]), 1), "queue": int(q[-1]), "wait": round(float(w[-1]), 1),
                 "yard_util": round(float(yard[-1]), 1)},
        peak={"hour": peak.hour, "index": peak.index},
        avg_index=round(avg_index, 1),
        drivers=drivers,
        model={
            "algorithm": "LightGBM (quantile regression bands)",
            "model_version": model_version,
            "features": FEATURES,
            "feature_importance": importances,
            "top_features": [{"feature": f, "gain": g} for f, g in top_features],
            "training_rows": int(X_tr.shape[0]),
            "holdout_hours": HOLDOUT_HOURS,
            "mae24": round(mae24 / n24, 2) if n24 else 0.0,
            "mae72": round(mae72 / n72, 2) if n72 else 0.0,
            "r2": holdout_index.get("r2", 0.0),
            "skill_pct": holdout_index.get("skill_pct", 0.0),
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "data_version": data_version,
            "feature_flags": _feature_flags(),
            "weather_used": False,
            "confidence": confidence,
            "calibration": {"coverage_80": round(_coverage(resid["index"], sigma["index"]), 3), "origins": ROLLOUT_ORIGINS},
        },
        validation={
            "buckets": buckets,
            "origins": ROLLOUT_ORIGINS,
            "holdout": holdout,
            "confidence_by_horizon": conf_by_horizon,
        },
        capacity=capacity,
        confidence=confidence,
        confidence_by_horizon=conf_by_horizon,
        horizons=_horizon_summary(points),
        weather_used=False,
        data_version=data_version,
    )
    if weather:
        apply_weather_adjustment(result, weather)
    return result


def _buckets(resid, sigma) -> list[dict]:
    defs = [("1-12h", 1, 12), ("13-24h", 13, 24), ("25-48h", 25, 48), ("49-72h", 49, 72)]
    out = []
    for label, lo, hi in defs:
        errs = [e for h in range(lo, hi + 1) for e in resid[h - 1]]
        n = len(errs)
        out.append({
            "label": label,
            "mae": round(float(np.mean([abs(e) for e in errs])), 2) if n else 0.0,
            "sigma": round(float(np.mean(sigma[lo - 1:hi])), 2),
            "bias": round(float(np.mean(errs)), 2) if n else 0.0,
            "n": n,
        })
    return out
