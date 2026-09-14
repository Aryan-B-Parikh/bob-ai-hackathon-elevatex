"""Engine smoke tests — prove the plan-aligned stack actually runs end-to-end."""

from __future__ import annotations

from .conftest import requires_db


@requires_db
def test_full_pipeline_runs():
    """seed → build_full must produce forecast, CP-SAT assignment, routing and a 72h plan."""
    from app.db import SessionLocal
    from app.services import pipeline

    db = SessionLocal()
    try:
        full = pipeline.build_full(db, persist=False)
    finally:
        db.close()

    fc = full["forecasts"]["Z-PORT"]
    assert len(fc.points) == 72
    assert fc.model["model_version"].startswith("lgbm")

    opt = full["optimiser"]
    assert opt["solver"] == "ortools-cp-sat"
    assert opt["status"] in ("OPTIMAL", "FEASIBLE")
    assert opt["metrics"]["serviced"] >= 1
    # hard-constraint sanity: nothing assigned past a berth's physical limits
    assert all(a["end_hour"] >= a["start_hour"] for a in opt["assignments"])

    assert isinstance(full["routing"], list)
    assert len(full["plan"]["shifts"]) == 12


@requires_db
def test_forecast_is_uncertainty_banded():
    from app.db import SessionLocal
    from app.services import pipeline

    db = SessionLocal()
    try:
        fc = pipeline.build_full(db, persist=False)["forecasts"]["Z-PORT"]
    finally:
        db.close()
    assert all(p.lo <= p.index <= p.hi for p in fc.points), "80% band must contain the point forecast"


@requires_db
def test_scenario_impairs_and_is_feasible():
    from app.db import SessionLocal
    from app.services import pipeline

    db = SessionLocal()
    try:
        ctx = pipeline.load_context(db)
        forecasts = pipeline.run_forecasts(ctx)
        base = pipeline.run_optimiser(ctx, forecasts, {})
        impaired = pipeline.run_optimiser(ctx, forecasts, {"crane_factor": 0.75, "move_rate_per_crane_hour": 24})
    finally:
        db.close()
    assert impaired["metrics"]["serviced"] <= base["metrics"]["serviced"]
    assert impaired["solver"] == "ortools-cp-sat"
