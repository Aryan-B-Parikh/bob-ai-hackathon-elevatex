"""Scenario engine (Module L, W3) — modifies an EngineContext and compares outcomes.

Supported kinds (frozen in the Phase-0 API contract as ``POST /api/scenarios/extended``):

| kind | effect |
|---|---|
| `CRANE_OUTAGE` / `PRODUCTIVITY` | crane availability + STS productivity (handled by the optimiser scenario params) |
| `BERTH_REMOVED` | drop the last `berth_count_delta` berths of `terminal_code` from the plan |
| `BERTH_ADDED` | add `berth_count_delta` working berths to `terminal_code` |
| `BUNCHING` | add `bunching_vessels` extra inbound calls in the next few hours |
| `SCHEDULE_CHANGE` | shift every inbound ETA by `schedule_shift_hours` |

No DB writes here: the context is modified in memory, so a scenario never corrupts
the shipped dataset. Contradictory parameters are rejected (L req.).
"""

from __future__ import annotations

from dataclasses import replace

from ..services.context import EngineContext

VALID_KINDS = {"CRANE_OUTAGE", "PRODUCTIVITY", "BERTH_REMOVED", "BERTH_ADDED", "BUNCHING", "SCHEDULE_CHANGE"}


class ScenarioError(ValueError):
    """Raised for contradictory or invalid scenario parameters."""


def _validate(body) -> None:
    kind = (getattr(body, "kind", "") or "").upper()
    if kind not in VALID_KINDS:
        raise ScenarioError(f"unknown scenario kind {kind!r}; expected one of {sorted(VALID_KINDS)}")
    if kind in ("BERTH_REMOVED", "BERTH_ADDED"):
        if not getattr(body, "terminal_code", None):
            raise ScenarioError(f"{kind} requires terminal_code")
        if int(getattr(body, "berth_count_delta", 0) or 0) <= 0:
            raise ScenarioError(f"{kind} requires berth_count_delta > 0")
    if kind == "BUNCHING" and int(getattr(body, "bunching_vessels", 0) or 0) <= 0:
        raise ScenarioError("BUNCHING requires bunching_vessels > 0")


def modify_context(ctx: EngineContext, body) -> tuple[EngineContext, str]:
    """Return (scenario context, human-readable description)."""
    _validate(body)
    kind = (body.kind or "").upper()
    terminal = (getattr(body, "terminal_code", None) or "").upper() or None

    if kind in ("CRANE_OUTAGE", "PRODUCTIVITY"):
        return ctx, (f"crane availability {int(body.crane_factor * 100)}% at "
                     f"{body.move_rate_per_crane_hour} moves/crane-hour")

    if kind in ("BERTH_REMOVED", "BERTH_ADDED"):
        term = next((t for t in ctx.terminals if t.code == terminal), None)
        if term is None:
            raise ScenarioError(f"unknown terminal_code {terminal!r}")

        target = [b for b in ctx.berths if b.terminal_code == terminal]
        others = [b for b in ctx.berths if b.terminal_code != terminal]
        n = int(body.berth_count_delta)

        if kind == "BERTH_REMOVED":
            if n >= len(target):
                raise ScenarioError(f"cannot remove {n} berths — {terminal} only has {len(target)}")
            kept = target[:-n]
            desc = f"{n} berth(s) removed at {terminal} ({len(target)} → {len(kept)} working berths)"
        else:
            if n > len(target):
                raise ScenarioError(f"cannot add {n} berths from a pool of {len(target)} at {terminal}")
            next_id = max((b.id for b in ctx.berths), default=0) + 1
            added = [replace(b, id=next_id + i, name=f"{b.name}+{i + 1}", seq=b.seq + 100 + i)
                     for i, b in enumerate(target[:n])]
            kept = target + added
            desc = f"{n} berth(s) added at {terminal} ({len(target)} → {len(kept)} working berths)"

        return replace(ctx, berths=kept + others), desc

    if kind == "BUNCHING":
        n = int(body.bunching_vessels)
        pool = [v for v in ctx.vessels if v.status != "INBOUND"] or ctx.vessels
        next_id = max((v.id for v in ctx.vessels), default=0) + 1
        extra = []
        for i in range(n):
            src = pool[i % len(pool)]
            extra.append(replace(
                src, id=next_id + i, name=f"{src.name} [bunch]", status="INBOUND",
                declared_eta_hours=float(4 + (i * 3) % 20), ais_eta_hours=None, anchored_hours=0.0,
                anchorage_zone="En route — San Pedro Approach",
            ))
        return replace(ctx, vessels=list(ctx.vessels) + extra), \
            f"{n} extra inbound call(s) bunched into the next ~24h"

    # SCHEDULE_CHANGE
    shift = float(getattr(body, "schedule_shift_hours", -6.0) or -6.0)
    moved = [replace(v, declared_eta_hours=max(0.5, v.declared_eta_hours + shift),
                     ais_eta_hours=(None if v.ais_eta_hours is None else max(0.5, v.ais_eta_hours + shift)))
             if v.status == "INBOUND" else v for v in ctx.vessels]
    return replace(ctx, vessels=moved), f"all inbound ETAs shifted by {shift:+.1f}h"


def compare(baseline: dict, scenario: dict) -> dict:
    """Scenario-minus-baseline deltas (negative average wait = better)."""
    return {
        "serviced": scenario["serviced"] - baseline["serviced"],
        "moves": scenario["total_moves"] - baseline["total_moves"],
        "avg_wait": round(scenario["avg_wait_hours"] - baseline["avg_wait_hours"], 1),
        "weighted_wait": round(scenario["weighted_wait_hours"] - baseline["weighted_wait_hours"], 1),
        "makespan": round(scenario["makespan_hours"] - baseline["makespan_hours"], 1),
        "berth_util": round(scenario["berth_util_pct"] - baseline["berth_util_pct"], 1),
        "crane_util": round(scenario["crane_util_pct"] - baseline["crane_util_pct"], 1),
        "deferred": scenario["deferred"] - baseline["deferred"],
    }
