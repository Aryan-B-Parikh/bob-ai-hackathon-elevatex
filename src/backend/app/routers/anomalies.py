"""Anomaly detection capability (W2) — moved out of catalog.py in Phase 0.

FROZEN SHAPE: {anomalies:[{zone_code, kind, method, score, is_anomaly, sample_size, detail, features}]}
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..services import pipeline

router = APIRouter(prefix="/api", tags=["anomalies"])


@router.get("/anomalies")
def anomalies(db: Session = Depends(get_db)):
    full = pipeline.build_full(db, persist=False)
    return {"anomalies": full["anomalies"]}
