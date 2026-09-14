"""Engine context — loads the DB into plain dataclasses shared by every service.

One shared model time ``t0`` (the newest congestion observation) so forecasting,
optimisation, routing and planning all reason about the same "now".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import reference as ref
from ..models import Berth, CongestionObservation, Crane, Gate, Terminal, VesselCall, YardZone


@dataclass
class TerminalCtx:
    id: int
    code: str
    name: str
    pier: str
    lat: float | None
    lon: float | None
    berth_length_ft: int
    deepsea_berths: int
    gantry_cranes: int
    capacity_teu_m: float | None
    zone_code: str
    note: str | None


@dataclass
class BerthCtx:
    id: int
    name: str
    seq: int
    length_ft: int
    depth_ft: float
    cranes_max: int
    terminal_code: str
    terminal_name: str
    pier: str
    zone_code: str


@dataclass
class VesselCtx:
    id: int
    mmsi: str | None
    imo: str | None
    name: str
    carrier: str
    vessel_class: str
    loa_ft: int
    beam_ft: int
    draft_ft: float
    teu_capacity: int
    import_moves: int
    export_moves: int
    origin_port: str
    reefer_units: int
    status: str
    anchorage_zone: str | None
    declared_eta_hours: float
    ais_eta_hours: float | None
    anchored_hours: float
    dest_zone_code: str
    data_confidence: float
    unresolved: bool

    @property
    def eta_hours(self) -> float:
        return self.ais_eta_hours if self.ais_eta_hours is not None else self.declared_eta_hours

    @property
    def total_moves(self) -> int:
        return self.import_moves + self.export_moves


@dataclass
class HistoryPoint:
    ts: datetime
    hours_ago: int
    queue_count: int
    avg_wait_hours: float
    index: float
    yard_util_pct: float | None


@dataclass
class EngineContext:
    t0: datetime
    terminals: list[TerminalCtx]
    berths: list[BerthCtx]
    vessels: list[VesselCtx]
    history: dict[str, list[HistoryPoint]] = field(default_factory=dict)
    cranes: dict[str, int] = field(default_factory=dict)          # terminal_code -> available cranes
    yard_util: dict[str, float] = field(default_factory=dict)     # terminal_code -> current %
    gate_queue: dict[str, int] = field(default_factory=dict)      # terminal_code -> trucks queued
    dataset_source: str = "DEMO_AIS"


def zone_capacity(ctx: EngineContext, zone_code: str) -> dict:
    if zone_code == "Z-PORT":
        term_berths = [b for b in ctx.berths]
        return {
            "berths": len(ctx.berths),
            "cranes": sum(t.gantry_cranes for t in ctx.terminals),
            "berth_length_ft": sum(t.berth_length_ft for t in ctx.terminals),
        }
    term_berths = [b for b in ctx.berths if b.zone_code == zone_code]
    term = next((t for t in ctx.terminals if t.zone_code == zone_code), None)
    return {
        "berths": len(term_berths),
        "cranes": sum(b.cranes_max for b in term_berths),
        "berth_length_ft": term.berth_length_ft if term else 0,
    }


def load_context(db: Session) -> EngineContext:
    terminals = db.execute(select(Terminal).order_by(Terminal.code)).scalars().all()
    berths = db.execute(select(Berth).order_by(Berth.seq)).scalars().all()
    vessels = db.execute(select(VesselCall).order_by(VesselCall.anchored_hours.desc())).scalars().all()
    observations = db.execute(
        select(CongestionObservation).order_by(CongestionObservation.hours_ago.desc())
    ).scalars().all()
    cranes = db.execute(select(Crane)).scalars().all()
    yards = db.execute(select(YardZone)).scalars().all()
    gates = db.execute(select(Gate)).scalars().all()

    term_by_id = {t.id: t for t in terminals}
    berth_ctx = [
        BerthCtx(
            id=b.id, name=b.name, seq=b.seq, length_ft=b.length_ft, depth_ft=b.depth_ft,
            cranes_max=b.cranes_max, terminal_code=term_by_id[b.terminal_id].code,
            terminal_name=term_by_id[b.terminal_id].name, pier=term_by_id[b.terminal_id].pier,
            zone_code=term_by_id[b.terminal_id].zone_code,
        )
        for b in berths
    ]
    vessel_ctx = [
        VesselCtx(
            id=v.id, mmsi=v.mmsi, imo=v.imo, name=v.name, carrier=v.carrier,
            vessel_class=v.vessel_class, loa_ft=v.loa_ft, beam_ft=v.beam_ft, draft_ft=v.draft_ft,
            teu_capacity=v.teu_capacity, import_moves=v.import_moves, export_moves=v.export_moves,
            origin_port=v.origin_port, reefer_units=v.reefer_units, status=v.status,
            anchorage_zone=v.anchorage_zone, declared_eta_hours=v.declared_eta_hours,
            ais_eta_hours=v.ais_eta_hours, anchored_hours=v.anchored_hours,
            dest_zone_code=v.dest_zone_code, data_confidence=v.data_confidence, unresolved=v.unresolved,
        )
        for v in vessels
    ]

    history: dict[str, list[HistoryPoint]] = {}
    for o in observations:
        history.setdefault(o.zone_code, []).append(
            HistoryPoint(o.ts, o.hours_ago, o.queue_count, o.avg_wait_hours, o.index, o.yard_util_pct)
        )

    latest = max((o.ts for o in observations), default=datetime.utcnow())
    avail = {}
    for c in cranes:
        code = term_by_id[c.terminal_id].code
        if c.status == "AVAILABLE":
            avail[code] = avail.get(code, 0) + 1
    yard_util = {}
    for term in terminals:
        zs = [y for y in yards if y.terminal_id == term.id]
        cap = sum(y.ground_slots_teu for y in zs) or 1
        used = sum(y.used_teu for y in zs)
        yard_util[term.code] = round(100.0 * used / cap, 1)
    gate_queue = {term_by_id[g.terminal_id].code: g.queue_len for g in gates}

    source = observations[0].source if observations else "DEMO_AIS"
    return EngineContext(
        t0=latest, terminals=terminals, berths=berth_ctx, vessels=vessel_ctx, history=history,
        cranes=avail, yard_util=yard_util, gate_queue=gate_queue, dataset_source=source,
    )


__all__ = [
    "EngineContext", "TerminalCtx", "BerthCtx", "VesselCtx", "HistoryPoint",
    "load_context", "zone_capacity", "ref",
]
