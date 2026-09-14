"""W3 unit tests — tidal model, scenario validation/modifiers, optimiser flags.

No network, no credits. DB-backed tests are marked via conftest.requires_db.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace as NS

import pytest

from app.services import scenarios as S
from app.services import tides
from app.services.context import BerthCtx, EngineContext, TerminalCtx, VesselCtx

from .conftest import requires_db


# ------------------------------------------------------------------ fixtures
def _terminal(code="PCT", zone="Z-PCT") -> TerminalCtx:
    return TerminalCtx(id=1, code=code, name=code, pier="Pier J", lat=None, lon=None,
                       berth_length_ft=5902, deepsea_berths=4, gantry_cranes=14,
                       capacity_teu_m=None, zone_code=zone, note=None)


def _berths(n=4, code="PCT", zone="Z-PCT", depth=52.0) -> list[BerthCtx]:
    return [BerthCtx(id=i + 1, name=f"J-{i+1}", seq=i + 1, length_ft=1475, depth_ft=depth,
                     cranes_max=4, terminal_code=code, terminal_name=code, pier="Pier J", zone_code=zone)
            for i in range(n)]


def _vessel(i: int, status="ANCHORAGE", loa=1000, draft=45.0, eta=0.0) -> VesselCtx:
    return VesselCtx(id=i, mmsi=f"36700000{i}", imo=f"IMO{i}", name=f"M/V T{i}", carrier="C",
                     vessel_class="PANAMAX", loa_ft=loa, beam_ft=124, draft_ft=draft,
                     teu_capacity=5000, import_moves=3000, export_moves=2500, origin_port="Busan",
                     reefer_units=100, status=status, anchorage_zone="A", declared_eta_hours=eta,
                     ais_eta_hours=None, anchored_hours=10.0, dest_zone_code="Z-PCT",
                     data_confidence=1.0, unresolved=False)


def _ctx(berths=None, vessels=None) -> EngineContext:
    return EngineContext(t0=datetime(2026, 1, 1, tzinfo=timezone.utc), terminals=[_terminal()],
                         berths=berths or _berths(), vessels=vessels or [_vessel(1), _vessel(2)])


def _body(**kw) -> NS:
    base = dict(kind="CRANE_OUTAGE", crane_factor=1.0, move_rate_per_crane_hour=28.0,
                terminal_code=None, berth_count_delta=0, bunching_vessels=0, schedule_shift_hours=-6.0)
    return NS(**{**base, **kw})


# ------------------------------------------------------------------ tides
def test_tide_depth_oscillates_within_amplitude():
    vals = [tides.depth_ft(50.0, h, 1) for h in range(0, 25)]
    assert max(vals) - min(vals) == pytest.approx(2 * tides.TIDE_AMPLITUDE_FT, abs=0.05)
    assert min(vals) > 50.0 - tides.TIDE_AMPLITUDE_FT - 0.01


def test_needs_tide_only_for_deep_draft():
    assert tides.needs_tide(50.0, 50.5) is True     # draft + margin > charted depth
    assert tides.needs_tide(52.0, 50.5) is False


def test_allowed_hours_are_a_strict_subset_for_deep_vessels():
    shallow = tides.allowed_start_hours(1, 52.0, 45.0, 72)
    deep = tides.allowed_start_hours(1, 50.0, 50.5, 72)
    assert len(shallow) == 73                        # never constrained
    assert 0 < len(deep) < 73                        # only at high water
    assert all(tides.is_open(1, 50.0, 50.5, h) for h in deep)
    assert not any(tides.is_open(1, 50.0, 50.5, h) for h in range(73) if h not in deep)


# ------------------------------------------------------------------ scenarios
def test_scenario_berth_removed_and_added_change_the_context():
    ctx = _ctx()
    removed, desc_r = S.modify_context(ctx, _body(kind="BERTH_REMOVED", terminal_code="PCT", berth_count_delta=2))
    added, desc_a = S.modify_context(ctx, _body(kind="BERTH_ADDED", terminal_code="PCT", berth_count_delta=2))
    assert len(removed.berths) == 2 and len(added.berths) == 6
    assert "removed" in desc_r and "added" in desc_a
    assert len(ctx.berths) == 4                       # original untouched


def test_scenario_bunching_adds_inbound_vessels():
    ctx = _ctx()
    out, desc = S.modify_context(ctx, _body(kind="BUNCHING", bunching_vessels=5))
    assert len(out.vessels) == len(ctx.vessels) + 5
    assert all(v.status == "INBOUND" for v in out.vessels[2:])
    assert "bunched" in desc


def test_scenario_schedule_change_shifts_inbound_etas():
    ctx = _ctx(vessels=[_vessel(1, status="INBOUND", eta=20.0)])
    out, _ = S.modify_context(ctx, _body(kind="SCHEDULE_CHANGE", schedule_shift_hours=-12.0))
    assert out.vessels[0].declared_eta_hours == 8.0


def test_scenario_rejects_contradictory_parameters():
    ctx = _ctx()
    with pytest.raises(S.ScenarioError):
        S.modify_context(ctx, _body(kind="BERTH_REMOVED", terminal_code="PCT", berth_count_delta=99))
    with pytest.raises(S.ScenarioError):
        S.modify_context(ctx, _body(kind="BERTH_REMOVED"))            # no terminal
    with pytest.raises(S.ScenarioError):
        S.modify_context(ctx, _body(kind="BUNCHING", bunching_vessels=0))
    with pytest.raises(S.ScenarioError):
        S.modify_context(ctx, _body(kind="NOT_A_KIND"))


def test_scenario_compare_is_scenario_minus_baseline():
    base = {"serviced": 10, "total_moves": 100, "avg_wait_hours": 5.0, "weighted_wait_hours": 9.0,
            "makespan_hours": 50.0, "berth_util_pct": 60.0, "crane_util_pct": 55.0, "deferred": 2}
    scen = {**base, "serviced": 8, "avg_wait_hours": 7.5}
    d = S.compare(base, scen)
    assert d["serviced"] == -2 and d["avg_wait"] == 2.5


# ------------------------------------------------------------------ optimiser
@requires_db
def test_optimiser_reports_tidal_incremental_and_gap():
    from app.db import SessionLocal
    from app.services import optimiser, pipeline

    db = SessionLocal()
    try:
        ctx = pipeline.load_context(db)
        base = optimiser.optimise(ctx, {}, {})
        tidal = optimiser.optimise(ctx, {}, {"tidal": True})
        inc = optimiser.optimise(ctx, {}, {"incremental": True})
    finally:
        db.close()

    assert base["tidal_feasible"] is True and tidal["tidal_feasible"] is True
    assert base["incremental"] is False and inc["incremental"] is True
    for out in (base, tidal, inc):
        assert out["gap_pct"] is None or out["gap_pct"] >= 0


@requires_db
def test_tidal_deep_vessels_start_only_at_high_water():
    """Every assignment of a tide-constrained vessel must start in an allowed hour."""
    from app.db import SessionLocal
    from app.services import optimiser, pipeline, tides

    db = SessionLocal()
    try:
        ctx = pipeline.load_context(db)
        out = optimiser.optimise(ctx, {}, {"tidal": True})
        berths = {b.id: b for b in ctx.berths}
        drafts = {v.id: v.draft_ft for v in ctx.vessels}
    finally:
        db.close()

    for a in out["assignments"]:
        b = berths[a["berth_id"]]
        draft = drafts[a["vessel_id"]]
        if tides.needs_tide(b.depth_ft, draft):
            assert tides.is_open(b.id, b.depth_ft, draft, int(round(a["start_hour"]))), a


@requires_db
def test_scenario_cache_key_includes_context():
    """Regression: a scenario that changes the context must NOT return the cached baseline.

    With the old key (t0 + scenario only) the second call returned the baseline solution,
    whose assignments could reference berths that the scenario had removed.
    """
    from app.db import SessionLocal
    from app.services import pipeline, scenarios as S

    db = SessionLocal()
    try:
        ctx = pipeline.load_context(db)
        fc = pipeline.run_forecasts(ctx)
        pipeline.run_optimiser(ctx, fc, {})                     # warm the baseline into the cache
        small, _ = S.modify_context(ctx, _body(kind="BERTH_REMOVED", terminal_code="PCT", berth_count_delta=2))
        scen = pipeline.run_optimiser(small, fc, {})             # same scenario dict as baseline
        allowed = {b.id for b in small.berths}
    finally:
        db.close()

    assert len(small.berths) < len(ctx.berths)
    assert scen["assignments"], "scenario must still schedule something"
    assert all(a["berth_id"] in allowed for a in scen["assignments"]), \
        "stale cache: assignment references a berth that the scenario removed"
