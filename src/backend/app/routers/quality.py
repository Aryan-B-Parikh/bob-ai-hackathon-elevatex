"""Data-quality + weather capability (W1).

Phase 0 stub: the response SHAPES are frozen here; W1 fills the logic.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Terminal, WeatherObservation

router = APIRouter(prefix="/api", tags=["quality"])


@router.get("/quality")
def quality(db: Session = Depends(get_db)):
    """Per-terminal data-completeness score (Module D)."""
    from ..services.dataquality import compute_terminal_quality
    compute_terminal_quality(db)
    from ..models import TerminalQuality
    stmt = select(Terminal.code, Terminal.name, TerminalQuality.completeness_pct, TerminalQuality.missing, TerminalQuality.rules_version).join(TerminalQuality, Terminal.id == TerminalQuality.terminal_id)
    rows = db.execute(stmt).all()
    terminals = []
    for code, name, pct, missing, version in rows:
        terminals.append({"code": code, "name": name, "completeness_pct": pct, "missing": missing or []})
    rules_version = rows[0][4] if rows else "v1"
    return {"terminals": terminals, "rules_version": rules_version, "stub": False}


@router.get("/weather")
def weather(db: Session = Depends(get_db), hours: int = Query(72, ge=1, le=336)):
    """Wind/wave/visibility series for San Pedro Bay."""
    from ..models import WeatherObservation
    stmt = select(WeatherObservation).where(
        WeatherObservation.hours_ago >= 0,
        WeatherObservation.hours_ago <= hours,
    ).order_by(WeatherObservation.hours_ago)
    obs = db.execute(stmt).scalars().all()
    points = [
        {
            "hour": o.hours_ago,
            "ts": o.ts.isoformat(),
            "wind_kn": o.wind_kn,
            "gust_kn": o.gust_kn,
            "wave_m": o.wave_m,
            "visibility_km": o.visibility_km,
        }
        for o in obs
    ]
    return {"points": points, "source": "OPEN_METEO", "hours": hours, "stub": False}
