"""Forecast capability: LightGBM forecast, hotspots, model card, validation."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import reference as ref
from ..db import get_db
from ..serialize import forecast_to_dict
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["forecast"])


@router.get("/forecast")
def forecast(db: Session = Depends(get_db), zone: str = Query("Z-PORT")):
    if zone not in ref.ALL_ZONES:
        raise HTTPException(400, f"unknown zone {zone}; expected one of {ref.ALL_ZONES}")
    full = pipeline.build_full(db, persist=False)
    return {
        "t0": full["ctx"].t0.isoformat(),
        "dataset_source": full["ctx"].dataset_source,
        "summary": {z: {"zone_name": f.zone_name, "current": f.current, "peak": f.peak,
                        "avg_index": f.avg_index} for z, f in full["forecasts"].items()},
        "selected": forecast_to_dict(full["forecasts"][zone]),
        "hotspots": full["hotspots"],
        "anomalies": full["anomalies"],
        # --- Phase 0 freeze (W2 fills these) ---
        "weather_used": False,
        "confidence": 1.0,
    }
