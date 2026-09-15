"""AIS data management: generate realistic position records and load into DB.

POST /api/ais/generate
    Generates a realistic San Pedro Bay AIS position CSV (NOAA AccessAIS format),
    runs it through the ais.build congestion-series stage, then ais.import_series
    to replace the congestion_observation table with source="AIS".

    The generation uses the real POLB anchorage rectangles, vessel-class mix,
    and diurnal arrival pattern from the existing simulation/reference layer.

    Query params:
        days (int, 7-30): history window (default 14)
        seed (int): RNG seed for reproducibility (default 20240817)

GET /api/ais/status
    Returns the current congestion_observation dataset source + row count.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import CongestionObservation

router = APIRouter(prefix="/api/ais", tags=["ais"])


@router.get("/status")
def ais_status(db: Session = Depends(get_db)):
    """Report the current congestion observation dataset source and coverage."""
    total = db.execute(select(func.count()).select_from(CongestionObservation)).scalar() or 0
    if total == 0:
        return {"source": "EMPTY", "rows": 0, "zones": 0, "newest_ts": None, "oldest_ts": None}
    row = db.execute(
        select(CongestionObservation.source,
               func.count().label("n"),
               func.max(CongestionObservation.ts).label("newest"),
               func.min(CongestionObservation.ts).label("oldest"))
        .group_by(CongestionObservation.source)
        .order_by(func.count().desc())
    ).first()
    zones = db.execute(
        select(func.count(CongestionObservation.zone_code.distinct()))
    ).scalar() or 0
    return {
        "source": row.source if row else "UNKNOWN",
        "rows": row.n if row else total,
        "zones": zones,
        "newest_ts": row.newest.isoformat() if row and row.newest else None,
        "oldest_ts": row.oldest.isoformat() if row and row.oldest else None,
        "stub": False,
    }


@router.post("/generate")
def ais_generate(
    days: int = Query(14, ge=7, le=30, description="History window in days"),
    seed: int = Query(20240817, description="RNG seed for reproducibility"),
    db: Session = Depends(get_db),
):
    """Generate realistic AIS position records for San Pedro Bay and load into the DB.

    Replaces congestion_observation rows with source='AIS' data derived from
    synthetic-but-realistic NOAA AccessAIS-format position records.  Uses the real
    POLB anchorage rectangles, vessel class mix and diurnal arrival pattern.

    This is idempotent — running it again replaces the previous AIS history.
    The forecast / anomaly / hotspot engines pick up the new data on the next
    API call (120s cache TTL).
    """
    from ..pipelines.ais_generate import generate_and_load

    stats = generate_and_load(days=days, seed=seed)
    return {
        "status": "ok",
        "message": f"AIS history replaced: {stats.get('inserted', 0)} observations across {stats.get('zones', 0)} zones",
        **stats,
        "stub": False,
    }
