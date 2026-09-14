"""Data-quality + weather capability (W1).

Phase 0 stub: the response SHAPES are frozen here; W1 fills the logic.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Terminal

router = APIRouter(prefix="/api", tags=["quality"])


@router.get("/quality")
def quality(db: Session = Depends(get_db)):
    """Per-terminal data-completeness score (Module D). FROZEN SHAPE:
    {terminals:[{code, name, completeness_pct, missing:[]}], rules_version, stub}"""
    terminals = db.execute(select(Terminal).order_by(Terminal.code)).scalars().all()
    return {
        "terminals": [{"code": t.code, "name": t.name, "completeness_pct": None, "missing": []} for t in terminals],
        "rules_version": "v1",
        "stub": True,  # W1: compute from TerminalQuality
    }


@router.get("/weather")
def weather(db: Session = Depends(get_db), hours: int = Query(72, ge=1, le=336)):
    """Wind/wave/visibility series for San Pedro Bay. FROZEN SHAPE:
    {points:[{hour, ts, wind_kn, wave_m}], source, stub}"""
    return {"points": [], "source": "OPEN_METEO", "hours": hours, "stub": True}  # W1: read WeatherObservation
