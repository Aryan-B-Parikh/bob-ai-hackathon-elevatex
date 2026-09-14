"""Scenario / what-if capability (W3).

Frozen shapes (docs/api-contract.md):
  POST /api/scenarios                -> {scenario_id, params, baseline, scenario, impact, weights, solver}
  POST /api/scenarios/extended       -> {baseline, scenario, impact, feasible, kind, parent_scenario_id, scenario_id, description}
  POST /api/scenarios/{id}/rollback  -> {restored, scenario_id, status}
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import reference as ref
from ..db import get_db
from ..models import ImpactAssessment, Scenario
from ..services import pipeline, scenarios as scen_svc

router = APIRouter(prefix="/api", tags=["scenarios"])


class ScenarioBody(BaseModel):
    crane_factor: float = Field(1.0, ge=0.5, le=1.0)
    move_rate_per_crane_hour: float = Field(28.0, ge=20.0, le=35.0)


class ExtendedScenarioBody(BaseModel):
    """W3: berth add/remove, crane outage, vessel bunching, schedule change."""
    kind: str = Field("CRANE_OUTAGE",
                      description="CRANE_OUTAGE | PRODUCTIVITY | BERTH_REMOVED | BERTH_ADDED | BUNCHING | SCHEDULE_CHANGE")
    crane_factor: float = Field(1.0, ge=0.5, le=1.0)
    move_rate_per_crane_hour: float = Field(28.0, ge=20.0, le=35.0)
    terminal_code: str | None = None
    berth_count_delta: int = Field(0, ge=0, le=8)
    bunching_vessels: int = Field(0, ge=0, le=20)
    schedule_shift_hours: float = Field(-6.0, ge=-48.0, le=48.0)
    parent_scenario_id: int | None = None          # clone lineage


def _params(body: ExtendedScenarioBody) -> dict:
    return {"kind": body.kind, "crane_factor": body.crane_factor,
            "move_rate_per_crane_hour": body.move_rate_per_crane_hour,
            "terminal_code": body.terminal_code, "berth_count_delta": body.berth_count_delta,
            "bunching_vessels": body.bunching_vessels, "schedule_shift_hours": body.schedule_shift_hours}


@router.post("/scenarios")
def scenario(body: ScenarioBody, db: Session = Depends(get_db)):
    scenario_params = {"crane_factor": body.crane_factor,
                       "move_rate_per_crane_hour": body.move_rate_per_crane_hour,
                       "kind": "CRANE_OUTAGE" if body.crane_factor < 1 else "PRODUCTIVITY"}
    ctx = pipeline.load_context(db)
    forecasts = pipeline.run_forecasts(ctx)
    base = pipeline.run_optimiser(ctx, forecasts, {})
    scen = pipeline.run_optimiser(ctx, forecasts, scenario_params)
    row = Scenario(name=f"{scenario_params['kind']} crane={body.crane_factor} rate={body.move_rate_per_crane_hour}",
                   params=scenario_params, kind=scenario_params["kind"], status="APPLIED")
    db.add(row)
    db.flush()
    impact = ImpactAssessment(scenario_id=row.id, baseline=base["metrics"], scenario=scen["metrics"],
                              deltas=scen_svc.compare(base["metrics"], scen["metrics"]), feasible=True)
    db.add(impact)
    db.commit()
    return {"scenario_id": row.id, "params": scenario_params, "baseline": base["metrics"],
            "scenario": scen["metrics"], "impact": impact.deltas,
            "weights": ref.OBJECTIVE_WEIGHTS, "solver": {"baseline": base["solver"], "scenario": scen["solver"]}}


@router.post("/scenarios/extended")
def scenario_extended(body: ExtendedScenarioBody, db: Session = Depends(get_db)):
    """W3: berth add/remove, crane outage, bunching, schedule change — baseline vs scenario."""
    ctx = pipeline.load_context(db)
    try:
        scen_ctx, description = scen_svc.modify_context(ctx, body)
    except scen_svc.ScenarioError as exc:
        raise HTTPException(400, str(exc)) from exc

    forecasts = pipeline.run_forecasts(ctx)      # the optimiser is forecast-independent; reuse the cached run
    params = {"crane_factor": body.crane_factor, "move_rate_per_crane_hour": body.move_rate_per_crane_hour}
    baseline = pipeline.run_optimiser(ctx, forecasts, {})
    scenario_out = pipeline.run_optimiser(scen_ctx, forecasts, params)
    impact = scen_svc.compare(baseline["metrics"], scenario_out["metrics"])

    row = Scenario(name=body.kind, params=_params(body), kind=body.kind, status="APPLIED",
                   parent_scenario_id=body.parent_scenario_id)
    db.add(row)
    db.flush()
    db.add(ImpactAssessment(scenario_id=row.id, baseline=baseline["metrics"],
                            scenario=scenario_out["metrics"], deltas=impact,
                            feasible=bool(scenario_out["tidal_feasible"])))
    db.commit()

    return {
        "baseline": baseline["metrics"], "scenario": scenario_out["metrics"], "impact": impact,
        "feasible": bool(scenario_out["tidal_feasible"]),
        "kind": body.kind, "parent_scenario_id": body.parent_scenario_id,
        "scenario_id": row.id, "description": description,
        "solver": {"baseline": baseline["solver"], "scenario": scenario_out["solver"],
                   "scenario_status": scenario_out["status"]},
        "weights": ref.OBJECTIVE_WEIGHTS,
    }


@router.post("/scenarios/{scenario_id}/rollback")
def scenario_rollback(scenario_id: int, db: Session = Depends(get_db)):
    """W3: mark the scenario rolled back (the shipped dataset is never mutated, so the
    baseline is always intact — this records the decision for audit)."""
    row = db.get(Scenario, scenario_id)
    if row is None:
        raise HTTPException(404, f"scenario {scenario_id} not found")
    row.status = "ROLLED_BACK"
    db.commit()
    return {"restored": True, "scenario_id": scenario_id, "status": row.status}
