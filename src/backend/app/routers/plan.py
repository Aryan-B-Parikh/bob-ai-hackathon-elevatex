"""Plan capability: 72h operations plan (+ Claude narrative) and CSV exports."""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import OperationsPlan
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["plan"])


@router.get("/plan")
def get_plan(db: Session = Depends(get_db), text: int = Query(0), persist: int = Query(0)):
    """Latest persisted plan when one exists (audit B-4: the read path must cite real
    run ids, not `#None`); otherwise a fresh build. `persist=1` also saves it."""
    from ..models import OperationsPlan
    from sqlalchemy import select

    latest = db.execute(select(OperationsPlan).order_by(OperationsPlan.id.desc())).scalars().first()
    if latest is not None and not persist:
        summary = dict(latest.summary or {})
        summary.setdefault("confidence_by_bucket", {})
        out = {"summary": summary, "shifts": latest.shifts or [], "text": latest.text_plan,
               "narrative_source": latest.narrative_source}
        if text:
            return PlainTextResponse(out["text"])
        return out

    full = pipeline.build_full(db, persist=bool(persist))
    out = full["plan"]
    out["summary"].setdefault("confidence_by_bucket", {})
    if persist:
        pipeline.persist_plan(db, out)
    if text:
        return PlainTextResponse(out["text"])
    return out


@router.post("/plan")
def regenerate(db: Session = Depends(get_db)):
    full = pipeline.build_full(db, persist=True)
    full["plan"]["summary"].setdefault("confidence_by_bucket", {})  # Phase 0 freeze (W3 fills)
    plan_id = pipeline.persist_plan(db, full["plan"])
    return {**full["plan"], "plan_id": plan_id}


@router.get("/export")
def export(db: Session = Depends(get_db), type: str = Query("assignments")):
    full = pipeline.build_full(db, persist=False)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    if type == "assignments":
        w.writerow(["vessel", "carrier", "berth", "terminal", "start_hour", "end_hour", "cranes", "wait_hours"])
        for a in full["optimiser"]["assignments"]:
            w.writerow([a["vessel_name"], a["carrier"], a["berth_name"], a["terminal_code"],
                        a["start_hour"], a["end_hour"], a["cranes"], a["wait_hours"]])
    elif type == "routing":
        w.writerow(["vessel", "option", "target_port", "predicted_wait_h", "eta_shift_h", "savings_usd", "tier"])
        for r in full["routing"]:
            w.writerow([r["vessel_name"], r["option"], r.get("target_port") or "", r["predicted_wait_hours"],
                        r.get("eta_shift_hours", 0), r["est_savings_usd"], r["tier"]])
    elif type == "vessels":
        w.writerow(["name", "mmsi", "carrier", "class", "loa_ft", "draft_ft", "moves", "reefers", "status", "anchored_h", "eta_h"])
        for v in full["ctx"].vessels:
            w.writerow([v.name, v.mmsi, v.carrier, v.vessel_class, v.loa_ft, v.draft_ft, v.total_moves,
                        v.reefer_units, v.status, v.anchored_hours, v.eta_hours])
    elif type == "forecast":
        w.writerow(["zone", "hour", "ts", "index", "queue", "wait", "yard_util", "lo", "hi"])
        for z, fc in full["forecasts"].items():
            for p in fc.points:
                w.writerow([z, p.hour, p.ts.isoformat(), p.index, p.queue, p.wait, p.yard_util, p.lo, p.hi])
    else:
        w.writerow(["error"]); w.writerow([f"unknown type {type}"])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{type}.csv"'})
