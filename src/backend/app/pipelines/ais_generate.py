"""Realistic AIS position record generator for San Pedro Bay.

Produces a CSV in the exact NOAA AccessAIS "clip and ship" column format:
  MMSI, BaseDateTime, LAT, LON, SOG, COG, Heading, VesselName, IMO,
  CallSign, VesselType, Status, Length, Width, Draft, Cargo

Each synthetic vessel:
  - Has a realistic MMSI (9-digit, range 300-500M for cargo/tanker classes)
  - Broadcasts every 2-6 minutes while underway, every 3-10 minutes at anchor
    (mirrors real Class-A transponder rates)
  - Follows a 3-segment track: approach → slow-down → anchor
  - Lingers in one of the two documented San Pedro anchorage rectangles
  - Departs after a dwell time drawn from the SimPy congestion distribution

The resulting CSV is processed identically to a real NOAA download through
``app.pipelines.ais build`` + ``app.pipelines.ais import``.

Usage (standalone):
    python -m app.pipelines.ais_generate [--days 14] [--seed 20240817] [--out ais_export.csv]

Usage (via API endpoint):
    POST /api/ais/generate?days=14&seed=20240817
    → runs build + import automatically, returns {"inserted": N, ...}
"""

from __future__ import annotations

import argparse
import csv
import math
import random
import sys
from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path

# ── NOAA AccessAIS output columns ──────────────────────────────────────────────
_COLUMNS = ["MMSI", "BaseDateTime", "LAT", "LON", "SOG", "COG", "Heading",
            "VesselName", "IMO", "CallSign", "VesselType", "Status",
            "Length", "Width", "Draft", "Cargo"]

# ── San Pedro Bay bounding box (matches ais.py BBOX) ──────────────────────────
_BBOX_LAT = (33.55, 33.85)
_BBOX_LON = (-118.45, -118.05)

# ── Anchorage rectangles (matches ais.py ANCHORAGE_RECTS) ─────────────────────
_ANCHORAGES = [
    # name, lat_ctr, lon_ctr, lat_spread, lon_spread
    ("San Pedro A/B", 33.66, -118.24, 0.06, 0.06),
    ("Long Beach C",  33.72, -118.10, 0.04, 0.05),
]

# ── Approach waypoints (outside the bbox, 30-50 nm out) ───────────────────────
_APPROACH_WAYPOINTS = [
    (33.20, -118.35),   # SW approach (from Hawaii/Asia transits)
    (33.10, -118.10),   # S approach (from Panama)
    (33.40, -117.90),   # SE approach (Ensenada)
]

# ── Vessel class templates (mirrors simulation.py CLASSES) ───────────────────
_CLASSES = [
    {"cls": "ULCV",        "loa": 1312, "beam": 200, "draft": 50.5, "type": 70, "w": 3},
    {"cls": "POST_PANAMAX","loa": 1148, "beam": 158, "draft": 49.0, "type": 70, "w": 5},
    {"cls": "NEO_PANAMAX", "loa": 1200, "beam": 168, "draft": 50.0, "type": 70, "w": 4},
    {"cls": "PANAMAX",     "loa":  964, "beam": 124, "draft": 45.0, "type": 70, "w": 6},
    {"cls": "FEEDER",      "loa":  636, "beam": 106, "draft": 36.0, "type": 70, "w": 4},
]

_NAME_A = ["Pacific", "Meridian", "Osprey", "Golden", "Harbour", "Coral",
           "Trade", "Marlin", "Albatross", "Cobalt", "Sierra", "Aurora"]
_NAME_B = ["Star", "Voyager", "Trader", "Pioneer", "Guardian", "Runner",
           "Banner", "Comet", "Pilot", "Crest"]

# Dwell time distribution (hours) — log-normal, mu/sigma tuned to typical POLB
# anchorage waits (median ~18h, long tail to ~120h)
_DWELL_MU    = 2.9    # ln(18)
_DWELL_SIGMA = 0.7


def _pick_class(rng: random.Random) -> dict:
    total = sum(c["w"] for c in _CLASSES)
    r = rng.random() * total
    for c in _CLASSES:
        r -= c["w"]
        if r <= 0:
            return c
    return _CLASSES[3]


def _fmt_dt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing in degrees (0=N, 90=E)."""
    d_lon = math.radians(lon2 - lon1)
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    x = math.sin(d_lon) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(d_lon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _interp(lat1: float, lon1: float, lat2: float, lon2: float, frac: float):
    return lat1 + frac * (lat2 - lat1), lon1 + frac * (lon2 - lon1)


def _generate_vessel_track(
    rng: random.Random,
    arrival_dt: datetime,
    dwell_hours: float,
    vessel_class: dict,
) -> list[dict]:
    """Generate AIS position records for one vessel:
      1. Approach (outside bbox → anchorage, SOG ~14-16 kn, every 2-4 min)
      2. Slowing (anchorage approach zone, SOG ~3-6 kn, every 3-5 min)
      3. At anchor (SOG 0-0.4 kn, every 3-10 min for dwell_hours)
      4. Departure (brief burst of underway records, SOG 8-14 kn)
    """
    records: list[dict] = []
    anch_name, anch_lat, anch_lon, anch_dlat, anch_dlon = rng.choice(_ANCHORAGES)
    # final anchor position with jitter
    anch_lat += rng.uniform(-anch_dlat * 0.8, anch_dlat * 0.8)
    anch_lon += rng.uniform(-anch_dlon * 0.8, anch_dlon * 0.8)

    approach_lat, approach_lon = rng.choice(_APPROACH_WAYPOINTS)
    approach_lat += rng.uniform(-0.05, 0.05)
    approach_lon += rng.uniform(-0.05, 0.05)

    mmsi = str(rng.randint(300_000_000, 500_000_000))
    imo  = f"IMO{rng.randint(7_000_000, 9_999_999)}"
    name = f"M/V {rng.choice(_NAME_A)} {rng.choice(_NAME_B)}"
    call = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4)) + str(rng.randint(10, 99))

    loa   = int(vessel_class["loa"] + rng.gauss(0, 20))
    beam  = vessel_class["beam"]
    draft = round(vessel_class["draft"] + rng.gauss(0, 0.4), 1)
    vtype = vessel_class["type"]

    def add(dt: datetime, lat: float, lon: float, sog: float, cog: float, status: int):
        records.append({
            "MMSI": mmsi, "BaseDateTime": _fmt_dt(dt),
            "LAT": round(lat, 5), "LON": round(lon, 5),
            "SOG": round(max(0.0, sog + rng.gauss(0, 0.1)), 1),
            "COG": round((cog + rng.gauss(0, 2)) % 360, 1),
            "Heading": round((cog + rng.gauss(0, 5)) % 360, 0),
            "VesselName": name, "IMO": imo, "CallSign": call,
            "VesselType": vtype, "Status": status,
            "Length": loa, "Width": beam, "Draft": draft, "Cargo": 71,
        })

    # ── Phase 1: approach (status 0 = underway) ───────────────────────────────
    approach_hours = rng.uniform(3.0, 8.0)
    t = arrival_dt - timedelta(hours=approach_hours + dwell_hours)
    sog = rng.uniform(13.0, 16.0)
    interval_min = rng.uniform(2, 4)
    mid_lat, mid_lon = _interp(approach_lat, approach_lon, anch_lat, anch_lon, 0.6)
    phase1_steps = max(3, int(approach_hours * 60 / interval_min * 0.6))
    for i in range(phase1_steps):
        frac = i / max(1, phase1_steps - 1)
        lat, lon = _interp(approach_lat, approach_lon, mid_lat, mid_lon, frac)
        cog = _bearing(approach_lat, approach_lon, anch_lat, anch_lon)
        add(t, lat, lon, sog, cog, 0)
        t += timedelta(minutes=interval_min + rng.gauss(0, 0.5))

    # ── Phase 2: slow-down / approach (status 3 = restricted manoeuvrability) ─
    sog = rng.uniform(3.0, 6.0)
    interval_min = rng.uniform(3, 5)
    phase2_steps = max(2, int(approach_hours * 60 / interval_min * 0.4))
    for i in range(phase2_steps):
        frac = i / max(1, phase2_steps - 1)
        lat, lon = _interp(mid_lat, mid_lon, anch_lat, anch_lon, frac)
        cog = _bearing(mid_lat, mid_lon, anch_lat, anch_lon)
        add(t, lat, lon, sog * (1 - frac * 0.7), cog, 3)
        t += timedelta(minutes=interval_min + rng.gauss(0, 0.5))

    # ── Phase 3: at anchor (status 1 = at anchor, SOG ~0) ────────────────────
    # Broadcast every 3-10 minutes — standard for Class-A at anchor
    t = arrival_dt  # snap to declared arrival
    depart_dt = arrival_dt + timedelta(hours=dwell_hours)
    while t < depart_dt:
        lat = anch_lat + rng.gauss(0, 0.001)  # slight position drift (current + GPS noise)
        lon = anch_lon + rng.gauss(0, 0.001)
        sog_anch = max(0.0, rng.gauss(0.1, 0.08))  # ~0 but noisy
        cog_anch = rng.uniform(0, 360)
        add(t, lat, lon, sog_anch, cog_anch, 1)
        interval_min = rng.uniform(3, 10)
        t += timedelta(minutes=interval_min)

    # ── Phase 4: departure (status 0 = underway) ─────────────────────────────
    depart_dest_lat = approach_lat + rng.uniform(-0.1, 0.1)
    depart_dest_lon = approach_lon + rng.uniform(-0.1, 0.1)
    sog = rng.uniform(8.0, 14.0)
    depart_steps = rng.randint(4, 8)
    for i in range(depart_steps):
        frac = (i + 1) / depart_steps
        lat, lon = _interp(anch_lat, anch_lon, depart_dest_lat, depart_dest_lon, frac)
        cog = _bearing(anch_lat, anch_lon, depart_dest_lat, depart_dest_lon)
        add(t, lat, lon, sog, cog, 0)
        t += timedelta(minutes=rng.uniform(2, 5))

    return records


def generate_ais_csv(
    days: int = 14,
    seed: int = 20240817,
    arrivals_per_day: float = 5.2,   # tuned to POLB typical throughput (~1,900 vessels/year)
) -> str:
    """Generate a full NOAA AccessAIS-format CSV string for San Pedro Bay.

    Parameters
    ----------
    days : number of history days to generate (14 = LightGBM training window)
    seed : RNG seed for reproducibility
    arrivals_per_day : mean vessel arrivals per day across all zones

    Returns
    -------
    CSV string (UTF-8) with NOAA AccessAIS column headers
    """
    rng = random.Random(seed)
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    start_dt = now - timedelta(days=days)

    all_records: list[dict] = []
    t = start_dt

    # Poisson arrivals over the history window
    mean_gap_hours = 24.0 / arrivals_per_day
    while t < now:
        gap = rng.expovariate(1.0 / mean_gap_hours)
        t += timedelta(hours=gap)
        if t >= now:
            break
        dwell = math.exp(_DWELL_MU + _DWELL_SIGMA * rng.gauss(0, 1))
        dwell = max(2.0, min(dwell, 120.0))
        vc = _pick_class(rng)
        records = _generate_vessel_track(rng, t, dwell, vc)
        all_records.extend(records)

    # Add a past bunching event ~144h before now (mirrors simulation.py)
    for k in range(3):
        bunch_t = now - timedelta(hours=144 - k * 4)
        vc_ulcv = next(c for c in _CLASSES if c["cls"] == "ULCV")
        records = _generate_vessel_track(rng, bunch_t, rng.uniform(24, 48), vc_ulcv)
        all_records.extend(records)

    # Sort by timestamp
    all_records.sort(key=lambda r: r["BaseDateTime"])

    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=_COLUMNS)
    writer.writeheader()
    writer.writerows(all_records)
    return buf.getvalue()


def generate_and_load(days: int = 14, seed: int = 20240817) -> dict:
    """Generate AIS CSV, run ais.build, run ais.import_series — all in one call.

    Returns the import stats dict from ais.import_series.
    """
    import tempfile

    from . import ais as ais_pipeline

    csv_content = generate_ais_csv(days=days, seed=seed)

    # Write to temp files (ais.build / import_series expect file paths)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as raw_f:
        raw_f.write(csv_content)
        raw_path = raw_f.name

    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as series_f:
        series_path = series_f.name

    try:
        build_stats = ais_pipeline.build(raw_path, series_path, min_anchor_min=5.0, sog_max=1.0)
        import_stats = ais_pipeline.import_series(series_path)
    finally:
        Path(raw_path).unlink(missing_ok=True)
        Path(series_path).unlink(missing_ok=True)

    return {**build_stats, **import_stats, "days": days, "seed": seed}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="app.pipelines.ais_generate",
        description="Generate realistic San Pedro Bay AIS CSV and load into DB",
    )
    p.add_argument("--days",   type=int,   default=14,       help="history window in days")
    p.add_argument("--seed",   type=int,   default=20240817, help="RNG seed")
    p.add_argument("--out",    type=str,   default="",       help="write AIS CSV here instead of loading DB")
    p.add_argument("--no-load",action="store_true",          help="generate CSV only, skip DB import")
    args = p.parse_args(argv)

    if args.out:
        csv_content = generate_ais_csv(days=args.days, seed=args.seed)
        Path(args.out).write_text(csv_content, encoding="utf-8")
        rows = csv_content.count("\n") - 1
        print(f"Written {rows} records to {args.out}")
        return

    if args.no_load:
        csv_content = generate_ais_csv(days=args.days, seed=args.seed)
        rows = csv_content.count("\n") - 1
        print(f"Generated {rows} AIS records (not loaded)")
        return

    stats = generate_and_load(days=args.days, seed=args.seed)
    print(stats)


if __name__ == "__main__":
    main(sys.argv[1:])
