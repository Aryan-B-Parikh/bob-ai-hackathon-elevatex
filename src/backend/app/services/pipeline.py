"""Orchestration pipeline + persistence.

Runs the services in dependency order (forecast -> anomaly -> hotspot ->
optimiser -> routing -> plan), caches the forecast by model time, and persists
every run so outputs are reproducible and auditable.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import reference as ref
from ..models import (
    AnomalyFlag,
    Assignment,
    CongestionObservation,
    ForecastPoint,
    ForecastRun,
    HotspotFlag,
    ImpactAssessment,
    OperationsPlan,
    OptimiserRun,
    RoutingRecommendation,
    Scenario,
    VesselCall,
)
from . import anomaly as anomaly_svc
from . import forecasting as fc_svc
from . import hotspot as hotspot_svc
from . import llm as llm_svc
from . import optimiser as opt_svc
from . import plan as plan_svc
from . import routing as routing_svc
from .context import EngineContext, load_context, zone_capacity

DATASET_NOTE = (
    "Terminal capacity = real Port of Long Beach fact-sheet figures. Vessel queue + 14-day congestion "
    "history = labelled DEMO_AIS synthetic operations layer (SimPy); the AIS pipeline can replace it."
)
DAILY_OP_COST_USD = ref.DAILY_OP_COST_USD

_fc_cache: dict = {"key": None, "forecasts": None, "run_id": None}
_fc_cache_at: float = 0.0
_opt_cache: dict = {"key": None, "out": None}
_opt_cache_at: float = 0.0
CACHE_TTL = 120.0
# single-flight guards: FastAPI runs `def` endpoints in a threadpool, so concurrent
# requests must not duplicate the heavy forecast/CP-SAT work (audit B4).
_fc_lock = threading.Lock()
_opt_lock = threading.Lock()


def all_zone_codes() -> list[str]:
    return list(ref.ALL_ZONES)


def run_forecasts(ctx: EngineContext, db: Session | None = None, force: bool = False) -> dict:
    """Train + roll out the LightGBM forecast per zone (cached by model time)."""
    global _fc_cache, _fc_cache_at
    key = ctx.t0.isoformat()
    with _fc_lock:
        if not force and _fc_cache["key"] == key and _fc_cache["forecasts"] and (time.time() - _fc_cache_at) < CACHE_TTL:
            return _fc_cache["forecasts"]

        forecasts = {}
        for zone in all_zone_codes():
            zone_vessels = ctx.vessels if zone == "Z-PORT" else [v for v in ctx.vessels if v.dest_zone_code == zone]
            forecasts[zone] = fc_svc.forecast_zone(
                zone_code=zone, zone_name=ref.ZONE_LABELS[zone], history=ctx.history.get(zone, []),
                vessels=zone_vessels, capacity=zone_capacity(ctx, zone), t0=ctx.t0,
            )
        # provenance: keep the persisted run id so the plan can cite it (audit B1)
        run_id = _fc_cache.get("run_id") if _fc_cache.get("key") == key else None
        if db is not None:
            run_id = persist_forecast_run(db, forecasts, ctx)
        _fc_cache = {"key": key, "forecasts": forecasts, "run_id": run_id}
        _fc_cache_at = time.time()
        return forecasts


def persist_forecast_run(db: Session, forecasts: dict, ctx: EngineContext) -> int:
    port = forecasts["Z-PORT"]
    run = ForecastRun(
        model_version=port.model["model_version"], algorithm="LightGBM",
        horizon_hours=fc_svc.HORIZON,
        metrics={z: {k: f.model.get(k) for k in ("mae24", "mae72", "r2", "skill_pct", "training_rows")}
                 for z, f in forecasts.items()},
    )
    db.add(run)
    db.flush()
    for z, fc in forecasts.items():
        for p in fc.points:
            db.add(ForecastPoint(run_id=run.id, zone_code=z, hour=p.hour, ts=p.ts, index=p.index,
                                 queue=p.queue, wait=p.wait, yard_util_pct=p.yard_util, lo=p.lo, hi=p.hi))
    db.commit()
    return run.id


def run_anomalies(ctx: EngineContext, db: Session | None = None) -> list[dict]:
    flags = anomaly_svc.detect_anomalies(ctx)
    if db is not None:
        db.execute(delete(AnomalyFlag))
        for f in flags:
            db.add(AnomalyFlag(zone_code=f["zone_code"], kind=f["kind"], method=f["method"],
                               score=f["score"], is_anomaly=f["is_anomaly"], sample_size=f["sample_size"],
                               detail=f["detail"], features=f["features"]))
        db.commit()
    return flags


def run_hotspots(ctx: EngineContext, forecasts: dict, anomalies: list[dict], db: Session | None = None) -> dict:
    return hotspot_svc.compute_hotspots(ctx, forecasts, anomalies)


def run_optimiser(ctx: EngineContext, forecasts: dict, scenario: dict | None = None, db: Session | None = None) -> dict:
    global _opt_cache, _opt_cache_at
    scenario = scenario or {}
    # W3 fix: the cache key MUST include a context fingerprint — scenario runs mutate the
    # context (berths/vessels) in memory, so keying on t0+scenario alone returned stale results.
    ctx_sig = (len(ctx.vessels), len(ctx.berths),
               sum(v.id for v in ctx.vessels) % 10_000_019,
               sum(b.id for b in ctx.berths) % 1_000_003)
    ckey = f"{ctx.t0.isoformat()}|{ctx_sig}|{sorted(scenario.items())}"
    if db is None and _opt_cache["key"] == ckey and _opt_cache["out"] and (time.time() - _opt_cache_at) < CACHE_TTL:
        return _opt_cache["out"]
    if db is None:
        with _opt_lock:  # single-flight: don't run two CP-SAT solves for the same key
            if _opt_cache["key"] == ckey and _opt_cache["out"] and (time.time() - _opt_cache_at) < CACHE_TTL:
                return _opt_cache["out"]
            out = opt_svc.optimise(ctx, {}, scenario)
            _opt_cache = {"key": ckey, "out": out}
            _opt_cache_at = time.time()
            return out
    out = opt_svc.optimise(ctx, {}, scenario)
    if db is not None:
        run = OptimiserRun(
            solver=out["solver"], status=out["status"], objective=out["objective"], solve_ms=out["solve_ms"],
            params=out["params"], metrics=out["metrics"], baseline=out["baseline"], deltas=out["deltas"],
            deferred=out["deferred"], weights=out["weights"],
        )
        db.add(run)
        db.flush()
        for i, a in enumerate(out["assignments"]):
            db.add(Assignment(run_id=run.id, vessel_call_id=a["vessel_id"], berth_id=a["berth_id"],
                              start_hour=a["start_hour"], end_hour=a["end_hour"], cranes=a["cranes"],
                              wait_hours=a["wait_hours"], priority_score=a["priority_score"], sequence=i))
        db.commit()
        out["run_id"] = run.id
    return out


def run_routing(ctx: EngineContext, forecasts: dict, optimiser_out: dict, db: Session | None = None) -> list[dict]:
    recs = routing_svc.recommend_routing(ctx, forecasts, optimiser_out)
    if db is not None:
        db.execute(delete(RoutingRecommendation))
        for r in recs:
            db.add(RoutingRecommendation(
                vessel_call_id=r["vessel_id"], option=r["option"], target_port=r.get("target_port"),
                eta_shift_hours=r.get("eta_shift_hours", 0), predicted_wait_hours=r["predicted_wait_hours"],
                est_savings_usd=r["est_savings_usd"], confidence=r["confidence"], tier=r["tier"],
                rationale=r.get("rationale"), sustained=bool(r.get("sustained")),
                option_detail=r.get("option_detail"),   # W3: in-port alternates + berthing window
            ))
        db.commit()
    return recs


def build_plan_output(ctx, forecasts, optimiser_out, routing, forecast_run_id=None, model_version=None) -> dict:
    return plan_svc.build_plan(ctx, forecasts, optimiser_out, routing,
                               forecast_run_id=forecast_run_id,
                               optimiser_run_id=optimiser_out.get("run_id"),
                               model_version=model_version)


def persist_plan(db: Session, plan_out: dict) -> int:
    narrative, source = llm_svc.narrate(plan_out["text"], plan_out["summary"])
    row = OperationsPlan(
        horizon_hours=72,
        forecast_run_id=plan_out["summary"].get("forecast_run_id"),
        optimiser_run_id=plan_out["summary"].get("optimiser_run_id"),
        summary=plan_out["summary"], shifts=plan_out["shifts"], text_plan=plan_out["text"],
        narrative_source=source,
    )
    db.add(row)
    db.commit()
    plan_out["narrative"] = narrative
    plan_out["narrative_source"] = source
    return row.id


# ------------------------------------------------------------------ overview
def build_overview(ctx: EngineContext, forecasts: dict, hotspots: dict, anomalies: list[dict],
                   optimiser_out: dict) -> dict:
    port = forecasts["Z-PORT"]
    waiting = [v for v in ctx.vessels if v.status != "INBOUND"]
    avg_wait = sum(v.anchored_hours for v in waiting) / len(waiting) if waiting else 0.0
    sched = fc_svc._arrival_schedule(ctx.vessels, 72)  # noqa: SLF001
    arrivals_next24 = int(sched[1:25].sum())

    zones = []
    for z in ref.ALL_ZONES:
        fc = forecasts[z]
        hist = ctx.history.get(z, [])
        trend = (fc.points[5].index - fc.current["index"]) if len(fc.points) > 5 else 0.0
        zones.append({
            "zone_code": z, "label": fc.zone_name, "current_index": fc.current["index"],
            "peak_index": fc.peak["index"], "peak_hour": fc.peak["hour"],
            "queue_now": fc.current["queue"], "wait_now": fc.current["wait"],
            "yard_util_pct": fc.current.get("yard_util", 0.0),
            "trend": "rising" if trend > 2 else "falling" if trend < -2 else "flat",
            "level": "CRIT" if fc.peak["index"] >= 75 else "HIGH" if fc.peak["index"] >= 60
            else "ELEVATED" if fc.peak["index"] >= 45 else "LOW",
            "berths": fc.capacity["berths"], "cranes": fc.capacity["cranes"],
            "recent_index": [round(h.index, 1) for h in hist[-48:]],
        })

    alerts = []
    for z in zones:
        if z["level"] in ("CRIT", "HIGH"):
            alerts.append({"severity": "crit" if z["level"] == "CRIT" else "warn",
                           "title": f"{z['label']} congestion peak {z['peak_index']:.0f} at +{z['peak_hour']}h",
                           "detail": f"Queue now {z['queue_now']} / {z['wait_now']:.0f}h avg wait; trend {z['trend']}.",
                           "hour": z["peak_hour"]})
    long_waiters = sorted([v for v in ctx.vessels if v.anchored_hours >= 72], key=lambda v: -v.anchored_hours)
    if long_waiters:
        alerts.append({"severity": "warn", "title": f"{len(long_waiters)} vessel(s) anchored 72h+",
                       "detail": f"Longest: {long_waiters[0].name} ({long_waiters[0].anchored_hours:.0f}h, {long_waiters[0].carrier})."})
    for a in anomalies:
        if a["is_anomaly"]:
            alerts.append({"severity": "warn", "title": f"Anomaly ({a['kind']}) at {a['zone_code']}",
                           "detail": a["detail"]})

    opt = optimiser_out
    kpis = {
        "vessels_at_anchor": len(waiting),
        "vessels_inbound": len(ctx.vessels) - len(waiting),
        "avg_anchorage_wait": round(avg_wait, 1),
        "max_anchored_hours": round(max((v.anchored_hours for v in ctx.vessels), default=0)),
        "arrivals_next24": arrivals_next24,
        "port_index_now": port.current["index"],
        "peak_forecast_index": port.peak["index"],
        "peak_forecast_hour": port.peak["hour"],
        "moves_pending": sum(v.total_moves for v in ctx.vessels),
        "daily_fleet_burn_usd": len(waiting) * DAILY_OP_COST_USD,
        "berth_util_pct": opt["metrics"]["berth_util_pct"],
        "crane_util_pct": opt["metrics"]["crane_util_pct"],
    }
    return {
        "t0": ctx.t0.isoformat(),
        "dataset": {"source": ctx.dataset_source, "note": DATASET_NOTE},
        "kpis": kpis,
        "zones": zones,
        "alerts": alerts,
        "hotspots": hotspots,
        "anomalies": anomalies,
        "arrivals_timeline": [{"hour": i + 1, "count": int(sched[i + 1])} for i in range(72)],
        "last_updated": datetime.utcnow().isoformat(),
    }


def build_full(db: Session, scenario: dict | None = None, persist: bool = True) -> dict:
    ctx = load_context(db)
    forecasts = run_forecasts(ctx, db if persist else None)
    anomalies = run_anomalies(ctx, db if persist else None)
    hotspots = run_hotspots(ctx, forecasts, anomalies)
    optimiser_out = run_optimiser(ctx, forecasts, scenario, db if persist else None)
    routing = run_routing(ctx, forecasts, optimiser_out, db if persist else None)
    model_version = forecasts["Z-PORT"].model["model_version"]
    # provenance fallback: cite the latest persisted forecast run on read paths (audit B1)
    forecast_run_id = _fc_cache.get("run_id")
    if forecast_run_id is None:
        forecast_run_id = db.execute(select(ForecastRun.id).order_by(ForecastRun.id.desc())).scalars().first()
    if optimiser_out.get("run_id") is None:
        optimiser_out["run_id"] = db.execute(select(OptimiserRun.id).order_by(OptimiserRun.id.desc())).scalars().first()
    plan_out = build_plan_output(ctx, forecasts, optimiser_out, routing,
                                 forecast_run_id=forecast_run_id, model_version=model_version)
    return {"ctx": ctx, "forecasts": forecasts, "anomalies": anomalies, "hotspots": hotspots,
            "optimiser": optimiser_out, "routing": routing, "plan": plan_out}
