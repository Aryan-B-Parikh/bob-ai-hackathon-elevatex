"""Reference + state capability: terminals, vessels, anomalies, hotspots."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Berth, Crane, Gate, Terminal, YardZone
from ..serialize import terminal_to_dict, vessel_to_dict
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/terminals")
def terminals(db: Session = Depends(get_db)):
    ts = db.execute(select(Terminal).order_by(Terminal.code)).scalars().all()
    out = []
    for t in ts:
        berths = [{"name": b.name, "seq": b.seq, "length_ft": b.length_ft, "depth_ft": b.depth_ft,
                   "cranes_max": b.cranes_max}
                  for b in db.execute(select(Berth).where(Berth.terminal_id == t.id)).scalars().all()]
        cranes = [{"code": c.code, "type": c.crane_type, "reach_ft": c.reach_ft,
                   "rated_moves_per_hour": c.rated_moves_per_hour, "status": c.status,
                   "reason": c.status_reason}
                  for c in db.execute(select(Crane).where(Crane.terminal_id == t.id)).scalars().all()]
        yards = [{"code": y.code, "ground_slots_teu": y.ground_slots_teu, "reefer_plugs": y.reefer_plugs,
                  "used_teu": y.used_teu, "util_pct": round(100 * y.used_teu / max(1, y.ground_slots_teu), 1)}
                 for y in db.execute(select(YardZone).where(YardZone.terminal_id == t.id)).scalars().all()]
        gate = db.execute(select(Gate).where(Gate.terminal_id == t.id)).scalars().first()
        gate_d = ({"lanes": gate.lanes, "trucks_per_hour": gate.trucks_per_hour, "queue_len": gate.queue_len,
                   "open_hours": gate.open_hours} if gate else None)
        out.append(terminal_to_dict(t, berths, cranes, yards, gate_d))
    return {"terminals": out,
            "source": "Port of Long Beach terminal fact sheets (real berth/crane capacity); "
                      "yard/gate figures are documented demo values."}


@router.get("/vessels")
def vessels(db: Session = Depends(get_db)):
    full = pipeline.build_full(db, persist=False)
    assignment = {a["vessel_id"]: a for a in full["optimiser"]["assignments"]}
    rows = []
    for v in full["ctx"].vessels:
        d = vessel_to_dict(v)
        a = assignment.get(v.id)
        d["assignment"] = ({"berth_name": a["berth_name"], "terminal_code": a["terminal_code"],
                            "start_hour": a["start_hour"], "cranes": a["cranes"],
                            "wait_hours": a["wait_hours"]} if a else None)
        d["deferred"] = a is None and v.status != "INBOUND"
        rows.append(d)
    return {"vessels": rows}


@router.get("/anomalies")
def anomalies(db: Session = Depends(get_db)):
    full = pipeline.build_full(db, persist=False)
    return {"anomalies": full["anomalies"]}


@router.get("/hotspots")
def hotspots(db: Session = Depends(get_db)):
    full = pipeline.build_full(db, persist=False)
    return full["hotspots"]
