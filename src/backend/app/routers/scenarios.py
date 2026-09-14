"""Scenario / what-if capability (W3) — absorbs POST /api/scenarios from optimise.py.

FROZEN SHAPES (see docs/api-contract.md):
  POST /api/scenarios                  -> {scenario_id, params, baseline, scenario, impact, weights, solver}
  POST /api/scenarios/extended         -> {baseline, scenario, impact, feasible, stub}
  POST /api/scenarios/{id}/rollback    -> {restored, stub}
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import reference as ref
from ..db import get_db
from ..models import ImpactAssessment, Scenario
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["scenarios"])


class ScenarioBody(BaseModel):
    crane_factor: float = Field(1.0, ge=0.5, le=1.0)
    move_rate_per_crane_hour: float = Field(28.0, ge=20.0, le=35.0)


class ExtendedScenarioBody(BaseModel):
    """W3 implements: berth add/remove, crane outage, bunching event, schedule change."""
    kind: str = Field("CRANE_OUTAGE", description="CRANE_OUTAGE | BERTH_REMOVED | BERTH_ADDED | BUNCHING | SCHEDULE_CHANGE")
    crane_factor: float = Field(1.0, ge=0.5, le=1.0)
    move_rate_per_crane_hour: float = Field(28.0, ge=20.0, le=35.0)
    terminal_code: str | None = None
    berth_count_delta: int = 0
    bunching_vessels: int = 0
    parent_scenario_id: int | None = None


@router.post("/scenarios")
def scenario(body: ScenarioBody, db: Session = Depends(get_db)):
    scenario_params = {"crane_factor": body.crane_factor,
                       "move_rate_per_crane_hour": body.move_rate_per_crane_hour,
                       "kind": "CRANE_OUTAGE" if body.crane_factor < 1 else "PRODUCTIVITY"}
    base = pipeline.run_optimiser(pipeline.load_context(db), pipeline.run_forecasts(pipeline.load_context(db)), {})
    scen = pipeline.run_optimiser(pipeline.load_context(db), pipeline.run_forecasts(pipeline.load_context(db)), scenario_params)
    row = Scenario(name=f"{scenario_params['kind']} crane={body.crane_factor} rate={body.move_rate_per_crane_hour}",
                   params=scenario_params, kind=scenario_params["kind"], status="APPLIED")
    db.add(row)
    db.flush()
    impact = ImpactAssessment(scenario_id=row.id, baseline=base["metrics"], scenario=scen["metrics"],
                              deltas={"serviced": scen["metrics"]["serviced"] - base["metrics"]["serviced"],
                                      "moves": scen["metrics"]["total_moves"] - base["metrics"]["total_moves"],
                                      "avg_wait": round(scen["metrics"]["avg_wait_hours"] - base["metrics"]["avg_wait_hours"], 1)},
                              feasible=True)
    db.add(impact)
    db.commit()
    return {"scenario_id": row.id, "params": scenario_params, "baseline": base["metrics"],
            "scenario": scen["metrics"], "impact": impact.deltas,
            "weights": ref.OBJECTIVE_WEIGHTS, "solver": {"baseline": base["solver"], "scenario": scen["solver"]}}


@router.post("/scenarios/extended")
def scenario_extended(body: ExtendedScenarioBody, db: Session = Depends(get_db)):
    """W3 implements berth add/remove, bunching and schedule-change scenarios."""
    return {"baseline": {}, "scenario": {}, "impact": {}, "feasible": True,
            "kind": body.kind, "parent_scenario_id": body.parent_scenario_id, "stub": True}


@router.post("/scenarios/{scenario_id}/rollback")
def scenario_rollback(scenario_id: int, db: Session = Depends(get_db)):
    """W3 sets Scenario.status=ROLLED_BACK and restores the baseline run."""
    return {"restored": False, "scenario_id": scenario_id, "stub": True}
