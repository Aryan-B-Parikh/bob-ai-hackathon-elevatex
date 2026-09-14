"""Weather pipeline (W1).

Fetches historical + forecast data from Open-Meteo for the reference location
defined in settings (REFERENCE_LAT/LON). Inserts rows into ``WeatherObservation``
with a simple cache fallback (if the HTTP request fails, no rows are inserted).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

import httpx  # std dep (replaces requests: identical call signature, already in pyproject)
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import WeatherObservation

LOGGER = logging.getLogger(__name__)


def _fetch_open_meteo(params: Dict[str, Any]) -> Dict[str, Any]:
    settings = get_settings()
    url = f"{settings.open_meteo_base}/v1/forecast"
    response = httpx.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json()


def _build_params(hours_ahead: int) -> Dict[str, Any]:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    start = now.isoformat()
    end = (now + timedelta(hours=hours_ahead)).isoformat()
    return {
        "latitude": settings.reference_lat,
        "longitude": settings.reference_lon,
        "hourly": "windspeed_10m,gusts_10m,wave_height,visibility",
        "start": start,
        "end": end,
        "timezone": "UTC",
    }


def run_weather_pipeline(db: Session, hours: int = 72) -> None:
    """Fetch weather data and persist ``WeatherObservation`` rows.

    The Open‑Meteo API returns arrays keyed by hour. For each hour we create a
    ``WeatherObservation`` entry with ``hours_ago`` relative to the current hour
    (0 = now, positive = future forecast, negative = past history – but we only
    store future values here).
    """
    try:
        params = _build_params(hours)
        data = _fetch_open_meteo(params)
        hourly = data.get("hourly", {})
        timestamps: List[str] = hourly.get("time", [])
        wind: List[float] = hourly.get("windspeed_10m", [])
        gust: List[float] = hourly.get("gusts_10m", [])
        wave: List[float] = hourly.get("wave_height", [])
        visibility: List[float] = hourly.get("visibility", [])
        now = datetime.now(timezone.utc)
        for idx, ts_str in enumerate(timestamps):
            ts = datetime.fromisoformat(ts_str).replace(tzinfo=timezone.utc)
            hours_ago = int((ts - now).total_seconds() // 3600)
            obs = WeatherObservation(
                ts=ts,
                hours_ago=hours_ago,
                wind_kn=wind[idx] if idx < len(wind) else None,
                gust_kn=gust[idx] if idx < len(gust) else None,
                wave_m=wave[idx] if idx < len(wave) else None,
                visibility_km=visibility[idx] if idx < len(visibility) else None,
                source="OPEN_METEO",
                confidence=0.9,
            )
            db.add(obs)
        db.commit()
        LOGGER.info("Weather pipeline inserted %d rows", len(timestamps))
    except Exception as exc:
        LOGGER.error("Weather pipeline failed: %s", exc)
        # Cache fallback: do nothing – the endpoint can signal ``weather_used=False``
        db.rollback()
