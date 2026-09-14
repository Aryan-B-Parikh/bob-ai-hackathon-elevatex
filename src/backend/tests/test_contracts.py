"""Contract tests — the merge gate.

`test_frozen_paths_present` needs no database and catches route removals/renames.
The shape tests run only when PostgreSQL is reachable.
"""

from __future__ import annotations

from app.main import app

from .conftest import requires_db

FROZEN_PATHS = [
    "/health",
    "/api/overview",
    "/api/forecast",
    "/api/optimise",
    "/api/optimise/latest",
    "/api/scenarios",
    "/api/scenarios/extended",
    "/api/scenarios/{scenario_id}/rollback",
    "/api/routing",
    "/api/plan",
    "/api/terminals",
    "/api/vessels",
    "/api/vessels/upload",
    "/api/anomalies",
    "/api/hotspots",
    "/api/quality",
    "/api/weather",
    "/api/export",
    "/api/bob",
]


def test_frozen_paths_present():
    """Every frozen path must exist in the OpenAPI schema (no DB needed)."""
    paths = app.openapi()["paths"]
    missing = [p for p in FROZEN_PATHS if p not in paths]
    assert not missing, f"frozen API paths missing: {missing}"


def test_no_path_removed_from_contract():
    """Guard against accidental renames: the documented methods must be present."""
    paths = app.openapi()["paths"]
    expected_methods = {
        "/api/quality": {"get"},
        "/api/weather": {"get"},
        "/api/vessels/upload": {"post"},
        "/api/anomalies": {"get"},
        "/api/scenarios/extended": {"post"},
        "/api/scenarios/{scenario_id}/rollback": {"post"},
    }
    for path, methods in expected_methods.items():
        got = set(paths.get(path, {}).keys())
        assert methods <= got, f"{path} must expose {methods}, got {got}"


@requires_db
def test_quality_shape(client):
    r = client.get("/api/quality")
    assert r.status_code == 200
    body = r.json()
    assert {"terminals", "rules_version"} <= set(body)
    assert isinstance(body["terminals"], list)
    for t in body["terminals"]:
        assert {"code", "name", "completeness_pct", "missing"} <= set(t)


@requires_db
def test_weather_shape(client):
    body = client.get("/api/weather?hours=72").json()
    assert {"points", "source", "hours"} <= set(body)
    assert isinstance(body["points"], list)


@requires_db
def test_forecast_frozen_keys(client):
    body = client.get("/api/forecast?zone=Z-PORT").json()
    assert {"t0", "dataset_source", "summary", "selected", "weather_used", "confidence"} <= set(body)
    assert len(body["selected"]["points"]) == 72


@requires_db
def test_optimise_frozen_keys(client):
    body = client.post("/api/optimise", json={"crane_factor": 1.0, "move_rate_per_crane_hour": 28}).json()
    assert {"solver", "status", "assignments", "metrics", "baseline", "deltas", "tidal_feasible",
            "incremental"} <= set(body)
    assert body["solver"] == "ortools-cp-sat"


@requires_db
def test_plan_frozen_keys(client):
    body = client.get("/api/plan").json()
    assert {"summary", "shifts", "text"} <= set(body)
    assert "confidence_by_bucket" in body["summary"]
    assert len(body["shifts"]) == 12


@requires_db
def test_anomalies_moved_to_own_router(client):
    body = client.get("/api/anomalies").json()
    assert "anomalies" in body


@requires_db
def test_upload_stub_shape(client):
    body = client.post("/api/vessels/upload", files={"file": ("schedule.csv", "a,b\n1,2\n", "text/csv")}).json()
    assert {"accepted", "rejected", "errors", "revisions_created"} <= set(body)


@requires_db
def test_scenario_extended_shape(client):
    body = client.post("/api/scenarios/extended", json={"kind": "CRANE_OUTAGE"}).json()
    assert {"baseline", "scenario", "impact", "feasible"} <= set(body)
    assert {"serviced", "moves", "avg_wait", "makespan"} <= set(body["impact"])


@requires_db
def test_scenario_extended_validates_contradictions(client):
    # L requirement: contradictory parameters must not be applied silently
    r = client.post("/api/scenarios/extended", json={"kind": "BERTH_REMOVED", "terminal_code": "PCT"})
    assert r.status_code == 400
