"""Tidal windows — time-varying berth depth (Module J hard constraint, W3).

San Pedro Bay has a semidiurnal tide (~12.42 h period, ~5–6 ft range). A vessel
whose draft exceeds a berth's charted depth can only **enter/leave at high water**,
so its berthing START must fall inside a tidal window.

Primary source — NOAA CO-OPS (non-fatal):
    fetch_noaa_tides() calls the NOAA Tides & Currents API for station 9410660
    (Los Angeles, San Pedro Bay) and writes observed + predicted water-level rows
    into the TidalWindow table labelled ``noaa-coops``.  Requires no API key.
    Endpoint: https://api.tidesandcurrents.noaa.gov/api/prod/datagetter

Fallback — harmonic model:
    depth_ft(berth, t) = design_depth_ft + A·cos(2π (t − phase) / 12.42)
    A     = TIDE_AMPLITUDE_FT (2.8 ft, mid-range for the bay)
    phase = deterministic per berth (spreads the windows along the waterfront)
    margin= UNDER_KEEL_MARGIN_FT (1.0 ft) required to transit a berth

Persisted ``TidalWindow`` rows, when present, **override** the harmonic model for
that berth (so the table frozen in Phase 0 is load-bearing, not decorative).
``ensure_windows()`` materialises the harmonic curve into that table so the DB path
is exercised end-to-end; the rows are labelled ``harmonic-model`` in ``note`` to keep
the data-honesty rule (modelled values are never passed off as observed soundings).

Frozen-column note: ``TidalWindow.hours_ago`` is an INTEGER offset column (frozen in
Phase 0). We use it as the **hour offset from the plan origin t0** — i.e. hours *ahead*
in the 0..horizon planning window, not a look-back. The name is kept for schema
stability; the meaning is documented here and everywhere the column is read/written.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import httpx
from sqlalchemy import select

LOGGER = logging.getLogger(__name__)

TIDE_PERIOD_H = 12.42
TIDE_AMPLITUDE_FT = 2.8
UNDER_KEEL_MARGIN_FT = 1.0
HARMONIC_NOTE = "harmonic-model"   # marks a modelled (not observed) tide row
NOAA_NOTE = "noaa-coops"           # marks a row sourced from NOAA CO-OPS API

# NOAA CO-OPS station 9410660 — Los Angeles / San Pedro Bay
# Charted depth at design datum (MLLW); tidal amplitude converts water level
# above/below MLLW into effective depth for a given berth.
NOAA_STATION_ID = "9410660"
NOAA_API_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
# MLLW datum depth correction: design_depth_ft is given at MLLW, so water level
# above MLLW directly adds to passable depth.
NOAA_PRODUCT_PREDICTIONS = "predictions"
NOAA_DATUM = "MLLW"
NOAA_UNITS = "english"   # feet
NOAA_TIME_ZONE = "GMT"


def _phase_hours(berth_id: int) -> float:
    """Deterministic per-berth phase offset so windows differ across the port."""
    return (berth_id % 12) * 0.5


def depth_ft(design_depth_ft: float, hour: float, berth_id: int = 0) -> float:
    """Water depth at a berth at a given hour ahead (harmonic approximation)."""
    return design_depth_ft + TIDE_AMPLITUDE_FT * math.cos(
        2 * math.pi * (hour - _phase_hours(berth_id)) / TIDE_PERIOD_H
    )


def needs_tide(design_depth_ft: float, draft_ft: float) -> bool:
    """True when the vessel cannot berth at low water (draft > charted depth)."""
    return draft_ft + UNDER_KEEL_MARGIN_FT > design_depth_ft


@lru_cache(maxsize=1)
def _db_overrides() -> dict[int, dict[int, float]]:
    """Persisted TidalWindow rows → {berth_id: {hour_offset: min_depth_ft}} (cached).

    ``hour_offset`` is the frozen ``hours_ago`` column reused as an hour ahead of t0
    (see module docstring). Cached for the process; call ``invalidate_cache()`` after
    writing rows so a freshly-seeded table is picked up without a restart.
    """
    try:
        from ..db import SessionLocal
        from ..models import TidalWindow

        db = SessionLocal()
        try:
            out: dict[int, dict[int, float]] = {}
            for row in db.execute(select(TidalWindow)).scalars().all():
                out.setdefault(row.berth_id, {})[row.hours_ago] = row.min_depth_ft
            return out
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001  (no DB / table missing → harmonic only)
        print(f"[tides] no persisted windows ({exc.__class__.__name__}) — harmonic model only")
        return {}


def invalidate_cache() -> None:
    """Drop the cached override map (call after ensure_windows / any TidalWindow write)."""
    _db_overrides.cache_clear()


def fetch_noaa_tides(db, horizon_hours: int = 96, t0: datetime | None = None) -> int:
    """Fetch NOAA CO-OPS tidal predictions for San Pedro Bay and persist as TidalWindow rows.

    Calls the NOAA Tides & Currents API (station 9410660, no API key required) for the
    next ``horizon_hours`` of hourly water-level predictions referenced to MLLW datum.
    Each row's ``min_depth_ft`` = design_depth_ft + water_level_ft (the effective passable
    depth at that hour for a berth whose chart depth is at MLLW).

    Rows are labelled ``NOAA_NOTE`` and replace any existing ``noaa-coops`` rows for the
    same berths and hours.  The harmonic model rows remain untouched as a fallback.

    Returns the number of TidalWindow rows written, or 0 on any API failure (non-fatal).
    """
    from ..models import Berth, TidalWindow

    base_ts = (t0 or datetime.now(timezone.utc)).replace(minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    end_ts = base_ts + timedelta(hours=horizon_hours)

    try:
        resp = httpx.get(
            NOAA_API_BASE,
            params={
                "station": NOAA_STATION_ID,
                "product": NOAA_PRODUCT_PREDICTIONS,
                "begin_date": base_ts.strftime("%Y%m%d %H:%M"),
                "end_date": end_ts.strftime("%Y%m%d %H:%M"),
                "datum": NOAA_DATUM,
                "time_zone": NOAA_TIME_ZONE,
                "interval": "h",
                "units": NOAA_UNITS,
                "application": "PortFlowSBX",
                "format": "json",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 — non-fatal; harmonic model stays
        LOGGER.warning("NOAA CO-OPS fetch failed (non-fatal, harmonic model used): %s", exc)
        return 0

    predictions = data.get("predictions", [])
    if not predictions:
        LOGGER.warning("NOAA CO-OPS returned no predictions for station %s", NOAA_STATION_ID)
        return 0

    # Build hour → water_level_ft lookup
    wl: dict[int, float] = {}
    for p in predictions:
        try:
            ts = datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            hour_offset = int(round((ts - base_ts).total_seconds() / 3600.0))
            if 0 <= hour_offset <= horizon_hours:
                wl[hour_offset] = float(p["v"])
        except (KeyError, ValueError):
            continue

    if not wl:
        LOGGER.warning("NOAA CO-OPS: could not parse any prediction rows")
        return 0

    berths = db.execute(select(Berth)).scalars().all()
    # Remove stale noaa-coops rows for these berths
    try:
        from sqlalchemy import delete as sa_delete
        from ..models import TidalWindow as TW
        db.execute(sa_delete(TW).where(TW.note == NOAA_NOTE))
    except Exception:  # noqa: BLE001
        pass

    written = 0
    for b in berths:
        for hour, water_level_ft in wl.items():
            # effective depth = design depth (at MLLW) + water level above MLLW
            effective_depth = round(b.depth_ft + water_level_ft, 3)
            db.add(TidalWindow(
                berth_id=b.id,
                ts=base_ts + timedelta(hours=hour),
                hours_ago=hour,
                min_depth_ft=effective_depth,
                note=NOAA_NOTE,
            ))
            written += 1

    try:
        db.commit()
        invalidate_cache()
        LOGGER.info("NOAA CO-OPS: wrote %d TidalWindow rows (%d hours × %d berths)",
                    written, len(wl), len(berths))
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("NOAA CO-OPS: DB write failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return 0

    return written


def ensure_windows(db, horizon_hours: int = 96, t0: datetime | None = None,
                   force: bool = False) -> int:
    """Materialise the harmonic model into the ``tidal_window`` table (idempotent).

    Writes one row per (berth, hour) for ``hour`` in ``0..horizon_hours`` using the
    harmonic depth curve, so the DB override path is real instead of an empty table.
    Rows are labelled ``HARMONIC_NOTE`` (modelled, not observed). Returns the number of
    rows written (0 when the table is already populated and ``force`` is False).

    W1's ``seed.py`` may later replace these with observed/predicted soundings on the
    same schema; until then this keeps the frozen ``TidalWindow`` table load-bearing.
    """
    from ..models import Berth, TidalWindow

    existing = db.execute(select(TidalWindow.id).limit(1)).first()
    if existing is not None and not force:
        return 0
    if force:
        db.query(TidalWindow).delete()

    base_ts = (t0 or datetime.now(timezone.utc)).astimezone(timezone.utc)
    berths = db.execute(select(Berth)).scalars().all()
    written = 0
    for b in berths:
        for hour in range(0, horizon_hours + 1):
            db.add(TidalWindow(
                berth_id=b.id,
                ts=base_ts + timedelta(hours=hour),
                hours_ago=hour,                       # frozen column = hour offset from t0
                min_depth_ft=round(depth_ft(b.depth_ft, hour, b.id), 3),
                note=HARMONIC_NOTE,
            ))
            written += 1
    db.commit()
    invalidate_cache()
    return written


def depth_at(berth_id: int, design_depth_ft: float, hour: int) -> float:
    """Depth at an integer hour, preferring persisted TidalWindow rows."""
    over = _db_overrides().get(berth_id)
    if over and hour in over:
        return over[hour]
    return depth_ft(design_depth_ft, hour, berth_id)


def is_open(berth_id: int, design_depth_ft: float, draft_ft: float, hour: int) -> bool:
    """Can a vessel of this draft berth at this hour?"""
    return depth_at(berth_id, design_depth_ft, hour) >= draft_ft + UNDER_KEEL_MARGIN_FT


def allowed_start_hours(berth_id: int, design_depth_ft: float, draft_ft: float,
                        horizon_hours: int = 96) -> list[int]:
    """All integer hours in [0, horizon] where the tide lets this vessel berth.

    Empty list ⇒ the vessel can never enter this berth (must be excluded).
    A full list ⇒ no tidal restriction applies (shallow-draft vessel).
    """
    return [h for h in range(0, horizon_hours + 1) if is_open(berth_id, design_depth_ft, draft_ft, h)]


def snapshot(berth_id: int, design_depth_ft: float, hours: int = 72) -> list[dict]:
    """Depth curve for the UI / diagnostics."""
    return [{"hour": h, "depth_ft": round(depth_at(berth_id, design_depth_ft, h), 2)} for h in range(hours + 1)]
