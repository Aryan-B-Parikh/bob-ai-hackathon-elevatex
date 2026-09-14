"""Optimisation capability: OR-Tools CP-SAT BAP/QCAP runs (W3).

Scenario endpoints live in routers/scenarios.py (moved in Phase 0).
FROZEN SHAPE for POST /api/optimise: existing keys + `tidal_feasible`, `incremental`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Assignment, Berth, OptimiserRun, VesselCall
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["optimise"])


class ScenarioBody(BaseModel):
    crane_factor: float = Field(1.0, ge=0.5, le=1.0, description="crane availability multiplier")
    move_rate_per_crane_hour: float = Field(28.0, ge=20.0, le=35.0)
    incremental: bool = Field(False, description="warm-start from the previous CP-SAT solution (W3)")


@router.get("/optimise/latest")
def latest(db: Session = Depends(get_db)):
    run = db.execute(select(OptimiserRun).order_by(OptimiserRun.id.desc())).scalars().first()
    if run is None:
        return pipeline.build_full(db, persist=True)["optimiser"]
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
            "baseline": run.baseline, "deltas": run.deltas, "deferred": run.deferred, "weights": run.weights,
            "tidal_feasible": True, "incremental": False}  # W3 fills these


@router.post("/optimise")
def run_optimise(body: ScenarioBody, db: Session = Depends(get_db)):
    scenario = {"crane_factor": body.crane_factor, "move_rate_per_crane_hour": body.move_rate_per_crane_hour,
                "incremental": body.incremental}
    out = pipeline.build_full(db, scenario=scenario, persist=True)["optimiser"]
    out["tidal_feasible"] = True   # W3: verify against TidalWindow
    out["incremental"] = bool(body.incremental)
    return out
