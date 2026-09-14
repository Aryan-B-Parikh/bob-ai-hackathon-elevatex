"""Optimisation capability: OR-Tools CP-SAT BAP/QCAP runs + what-if scenarios."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import reference as ref
from ..db import get_db
from ..models import Assignment, Berth, ImpactAssessment, OptimiserRun, Scenario, VesselCall
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["optimise"])


class ScenarioBody(BaseModel):
    crane_factor: float = Field(1.0, ge=0.5, le=1.0, description="crane availability multiplier")
    move_rate_per_crane_hour: float = Field(28.0, ge=20.0, le=35.0)


@router.get("/optimise/latest")
def latest(db: Session = Depends(get_db)):
    run = db.execute(select(OptimiserRun).order_by(OptimiserRun.id.desc())).scalars().first()
    if run is None:
        out = pipeline.build_full(db, persist=True)["optimiser"]
        return out
    rows = db.execute(select(Assignment).where(Assignment.run_id == run.id).order_by(Assignment.sequence)).scalars().all()
    berths = {b.id: b for b in db.execute(select(Berth)).scalars().all()}
    vessels = {v.id: v for v in db.execute(select(VesselCall)).scalars().all()}
    assignments = []
    for a in rows:
        b, v = berths[a.berth_id], vessels[a.vessel_call_id]
        assignments.append({"vessel_id": v.id, "vessel_name": v.name, "carrier": v.carrier,
                            "vessel_class": v.vessel_class, "berth_id": b.id, "berth_name": b.name,
                            "terminal_id": b.terminal_id, "start_hour": a.start_hour,
                            "end_hour": a.end_hour, "cranes": a.cranes, "wait_hours": a.wait_hours,
                            "priority_score": a.priority_score})
    return {"run_id": run.id, "solver": run.solver, "status": run.status, "objective": run.objective,
            "solve_ms": run.solve_ms, "assignments": assignments, "metrics": run.metrics,
            "baseline": run.baseline, "deltas": run.deltas, "deferred": run.deferred, "weights": run.weights}


@router.post("/optimise")
def run_optimise(body: ScenarioBody, db: Session = Depends(get_db)):
    scenario = {"crane_factor": body.crane_factor, "move_rate_per_crane_hour": body.move_rate_per_crane_hour}
    full = pipeline.build_full(db, scenario=scenario, persist=True)
    return full["optimiser"]


@router.post("/scenarios")
def scenario(body: ScenarioBody, db: Session = Depends(get_db)):
    """Baseline vs scenario side-by-side + persisted ImpactAssessment (L req.)."""
    scenario_params = {"crane_factor": body.crane_factor,
                       "move_rate_per_crane_hour": body.move_rate_per_crane_hour,
                       "kind": "CRANE_OUTAGE" if body.crane_factor < 1 else "PRODUCTIVITY"}
    base = pipeline.run_optimiser(pipeline.load_context(db), pipeline.run_forecasts(pipeline.load_context(db)), {})
    scen = pipeline.run_optimiser(pipeline.load_context(db), pipeline.run_forecasts(pipeline.load_context(db)), scenario_params)
    row = Scenario(name=f"{scenario_params['kind']} crane={body.crane_factor} rate={body.move_rate_per_crane_hour}",
                   params=scenario_params, kind=scenario_params["kind"])
    db.add(row); db.flush()
    impact = ImpactAssessment(scenario_id=row.id, baseline=base["metrics"], scenario=scen["metrics"],
                              deltas={"serviced": scen["metrics"]["serviced"] - base["metrics"]["serviced"],
                                      "moves": scen["metrics"]["total_moves"] - base["metrics"]["total_moves"],
                                      "avg_wait": round(scen["metrics"]["avg_wait_hours"] - base["metrics"]["avg_wait_hours"], 1)},
                              feasible=True)
    db.add(impact); db.commit()
    return {"scenario_id": row.id, "params": scenario_params, "baseline": base["metrics"],
            "scenario": scen["metrics"], "impact": impact.deltas,
            "weights": ref.OBJECTIVE_WEIGHTS, "solver": {"baseline": base["solver"], "scenario": scen["solver"]}}
