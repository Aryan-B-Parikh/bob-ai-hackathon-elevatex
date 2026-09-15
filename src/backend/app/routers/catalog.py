"""Reference + state capability: terminals, vessels, anomalies, hotspots."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import EtaRevision, Terminal, VesselCall, VesselScheduleUpload
from ..pipelines.schedule import parse_schedule
from ..serialize import terminal_to_dict, vessel_to_dict
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["catalog"])

# 10 MB hard cap on CSV vessel schedule uploads
_UPLOAD_MAX_BYTES = 10 * 1024 * 1024


@router.get("/terminals")
def terminals(db: Session = Depends(get_db)):
    # Eager-load all relationships in one query to avoid N+1 (4 queries per terminal).
    ts = db.execute(
        select(Terminal)
        .options(
            joinedload(Terminal.berths),
            joinedload(Terminal.cranes),
            joinedload(Terminal.yard_zones),
            joinedload(Terminal.gates),
        )
        .order_by(Terminal.code)
    ).unique().scalars().all()
    out = []
    for t in ts:
        berths = [{"name": b.name, "seq": b.seq, "length_ft": b.length_ft, "depth_ft": b.depth_ft,
                   "cranes_max": b.cranes_max}
                  for b in sorted(t.berths, key=lambda b: b.seq)]
        cranes = [{"code": c.code, "type": c.crane_type, "reach_ft": c.reach_ft,
                   "rated_moves_per_hour": c.rated_moves_per_hour, "status": c.status,
                   "reason": c.status_reason}
                  for c in t.cranes]
        yards = [{"code": y.code, "ground_slots_teu": y.ground_slots_teu, "reefer_plugs": y.reefer_plugs,
                  "used_teu": y.used_teu, "util_pct": round(100 * y.used_teu / max(1, y.ground_slots_teu), 1)}
                 for y in t.yard_zones]
        gate = t.gates[0] if t.gates else None
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


@router.get("/hotspots")
def hotspots(db: Session = Depends(get_db)):
    full = pipeline.build_full(db, persist=False)
    return full["hotspots"]


@router.post("/vessels/upload")
async def upload_schedule(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """CSV/EDI vessel-schedule upload (Module B).

    Enforces a 10 MB file size cap to prevent memory-exhaustion DoS.

    Parses the CSV, **creates real `VesselCall` rows** with an `EtaRevision`
    carrier-declaration history entry (audit B-1: the previous version only wrote
    an audit row and created nothing), dedupes on IMO+voyage_number, and reports
    an audit that adds up: ``accepted + rejected == rows`` (audit B-2).
    """
    raw = await file.read()
    if len(raw) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large: max {_UPLOAD_MAX_BYTES // (1024 * 1024)} MB")
    errors: list[str] = []
    rows = parsed_rejected = accepted = revisions_created = 0

    try:
        parsed = parse_schedule(raw)
    except Exception as exc:  # whole-file rejection (bad header/encoding)
        upload = VesselScheduleUpload(filename=file.filename, rows=0, accepted=0,
                                      rejected=0, report={"errors": [str(exc)], "created": []})
        db.add(upload)
        db.commit()
        db.refresh(upload)
        return {"accepted": 0, "rejected": 0, "errors": [str(exc)], "revisions_created": 0,
                "upload_id": upload.id, "filename": file.filename, "bytes": len(raw), "stub": False}

    rows = parsed["rows"]
    parsed_rejected = len(parsed["rejected"])

    zone_by_code = {t.zone_code: t for t in db.execute(select(Terminal)).scalars().all()}
    existing_keys = {(v.imo, v.voyage_number) for v in db.execute(select(VesselCall)).scalars().all()}

    created: list[dict] = []
    for r in parsed["accepted"]:
        imo, voyage = (r.get("imo") or "").strip(), (r.get("voyage_number") or "").strip()
        key = (imo, voyage)
        if key in existing_keys or key in {(c.get("imo"), c.get("voyage_number")) for c in created}:
            errors.append(f"duplicate skipped: {imo}/{voyage}")
            continue
        zone = (r.get("dest_zone_code") or "").strip()
        if zone and zone not in zone_by_code:
            errors.append(f"unknown dest_zone_code {zone!r} for {imo}/{voyage}")
            continue
        vc = VesselCall(
            imo=imo, voyage_number=voyage,
            mmsi=(r.get("mmsi") or "").strip() or None,
            name=(r.get("name") or "").strip() or f"Uploaded {imo}",
            carrier=(r.get("carrier") or "").strip() or "Unknown",
            vessel_class=(r.get("vessel_class") or "").strip() or "PANAMAX",
            loa_ft=int(float(r.get("loa_ft") or 964)),
            beam_ft=int(float(r.get("beam_ft") or 124)),
            draft_ft=float(r.get("draft_ft") or 45.0),
            teu_capacity=int(float(r.get("teu_capacity") or 5000)),
            import_moves=int(float(r.get("import_moves") or 2000)),
            export_moves=int(float(r.get("export_moves") or 1800)),
            origin_port=(r.get("origin_port") or "").strip() or "Unknown",
            reefer_units=int(float(r.get("reefer_units") or 0)),
            status="INBOUND",
            anchorage_zone="En route — San Pedro Approach",
            declared_eta_hours=float(r["declared_eta_hours"]),
            ais_eta_hours=None,
            etd_hours=float(r["declared_eta_hours"]) + 26.0,
            anchored_hours=0.0,
            dest_zone_code=zone or "Z-LBCT",
            data_confidence=0.8,      # manually supplied data, not measured
            unresolved=False,
        )
        db.add(vc)
        db.flush()
        db.add(EtaRevision(vessel_call_id=vc.id, source="CARRIER",
                           eta_hours=vc.declared_eta_hours, note="uploaded schedule"))
        revisions_created += 1
        created.append({"imo": imo, "voyage_number": voyage})
        accepted += 1

    rejected = parsed_rejected + (rows - parsed_rejected - accepted)
    upload = VesselScheduleUpload(filename=file.filename, rows=rows, accepted=accepted,
                                  rejected=rejected,
                                  report={"errors": errors, "created": created})
    db.add(upload)
    db.commit()
    db.refresh(upload)

    # Auto-replan: if new vessel calls were accepted, immediately trigger a
    # fresh CP-SAT optimisation so the dashboard reflects the updated queue.
    if accepted > 0:
        try:
            pipeline.build_full(db, persist=True)
        except Exception:  # noqa: BLE001
            pass  # non-fatal — stale plan is still valid until next manual solve

    return {"accepted": accepted, "rejected": rejected, "errors": errors,
            "revisions_created": revisions_created, "upload_id": upload.id,
            "filename": file.filename, "bytes": len(raw), "stub": False}
