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
from datetime import datetime, timedelta

import lightgbm as lgb
import numpy as np

from .. import reference as ref

HORIZON = 72
HOLDOUT_HOURS = 48
ROLLOUT_ORIGINS = 8
QUANTILE_LO, QUANTILE_HI = 0.10, 0.90
Z_80 = 1.2816  # 80% band

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


# ------------------------------------------------------------------ features
def _feature_matrix(idx, q, w, yard, ms_of, arrival6, load_factor, t):
    m = lambda a, f, to: float(np.mean(a[max(0, f): to + 1]))  # noqa: E731
    d = datetime.utcfromtimestamp(ms_of(t) / 1000.0)
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


# ------------------------------------------------------------------ main
def forecast_zone(zone_code, zone_name, history, vessels, capacity, t0: datetime) -> ForecastResult:
    H = len(history)
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

    # ---------------- per-horizon sigma from multi-origin rollouts
    resid = [[] for _ in range(HORIZON)]
    first = max(30, H - 1 - HOLDOUT_HOURS - 120)
    span = max(1, H - 1 - HOLDOUT_HOURS - first)
    for o in range(ROLLOUT_ORIGINS):
        origin = first + int(o * span / ROLLOUT_ORIGINS)
        r = rollout(origin, HORIZON, use_schedule=False)
        for h in range(1, HORIZON + 1):
            actual = idx[origin + h] if origin + h < H else None
            if actual is not None:
                resid[h - 1].append(actual - r["index"][h - 1])
    sigma = [max(1.5, float(np.std(a)) if len(a) > 1 else 6.0) for a in resid]

    mae24 = mae72 = 0.0
    n24 = n72 = 0
    for hI, a in enumerate(resid):
        for e in a:
            ae = abs(e)
            if hI + 1 <= 24:
                mae24 += ae; n24 += 1
            mae72 += ae; n72 += 1

    # ---------------- production rollout from now
    fc = rollout(H - 1, HORIZON, use_schedule=True)
    points = []
    for i in range(HORIZON):
        band = Z_80 * sigma[i]
        lo = max(fc["lo"][i], fc["index"][i] - band)
        hi = min(100.0, max(fc["hi"][i], fc["index"][i] + band))
        points.append(ForecastPoint(
            hour=i + 1, ts=t0 + timedelta(hours=i + 1),
            index=round(fc["index"][i], 1), queue=round(fc["queue"][i], 1),
            wait=round(fc["wait"][i], 1), yard_util=round(fc["yard"][i], 1),
            lo=round(lo, 1), hi=round(hi, 1),
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
    return ForecastResult(
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
            "r2": holdout.get("index", {}).get("r2", 0.0),
            "skill_pct": holdout.get("index", {}).get("skill_pct", 0.0),
            "trained_at": datetime.utcnow().isoformat(),
        },
        validation={
            "buckets": _buckets(resid, sigma),
            "origins": ROLLOUT_ORIGINS,
            "holdout": holdout,
        },
        capacity=capacity,
    )


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
