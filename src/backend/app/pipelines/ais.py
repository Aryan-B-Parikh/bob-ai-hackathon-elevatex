"""NOAA AccessAIS → per-zone hourly congestion series → PostgreSQL.

The real-data path (plan §3: "batch-load a real AIS window"). Two steps:

    # 1) AccessAIS CSV  ->  congestion series CSV
    uv run python -m app.pipelines.ais build <ais_export.csv> congestion-series.csv [--min-anchor-min 0] [--sog-max 1.0]

    # 2) congestion series CSV  ->  CongestionObservation table (source="AIS")
    uv run python -m app.pipelines.ais import congestion-series.csv

Source: NOAA Office for Coastal Management — AccessAIS (Marine Cadastre),
https://marinecadastre.gov/accessais/  ("clip and ship" a San Pedro Bay window).

Method & documented approximations
----------------------------------
1. bounding box  : lat 33.55–33.85, lon −118.45…−118.05
2. at-anchor     : SOG < sog_max  AND inside one of the documented anchorage rectangles
3. per-MMSI dwell: last anchored timestamp − first anchored timestamp (interval approximation,
                   no interpolation across AIS gaps; a vessel counts toward every hour in between)
4. zone          : nearest terminal anchor point from the vessel's mean anchored position
5. hourly index  : identical formula to the engine  clamp(60·(queue/20) + 40·(wait/72), 0, 100)
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from .. import reference as ref

# ---------------------------------------------------------------- geography
BBOX = {"lat_min": 33.55, "lat_max": 33.85, "lon_min": -118.45, "lon_max": -118.05}
ANCHORAGE_RECTS = [  # documented approximations, not official chart polygons
    {"name": "San Pedro Anchorage A/B (approx.)", "lat_min": 33.60, "lat_max": 33.72, "lon_min": -118.30, "lon_max": -118.18},
    {"name": "Long Beach Anchorage C (approx.)", "lat_min": 33.68, "lat_max": 33.76, "lon_min": -118.15, "lon_max": -118.05},
]
TERMINAL_ANCHORS = {t["zone_code"]: (t["lat"], t["lon"]) for t in ref.TERMINALS}

REQUIRED = ("mmsi", "basedatetime", "lat", "lon", "sog")


def _in_rect(lat: float, lon: float, r: dict) -> bool:
    return r["lat_min"] <= lat <= r["lat_max"] and r["lon_min"] <= lon <= r["lon_max"]


def _in_bbox(lat: float, lon: float) -> bool:
    return _in_rect(lat, lon, BBOX)


def _zone_for(lat: float, lon: float) -> str:
    best, best_d = ref.TERMINAL_ZONES[0], float("inf")
    for zone, (tlat, tlon) in TERMINAL_ANCHORS.items():
        if tlat is None or tlon is None:
            continue
        d = (lat - tlat) ** 2 + (lon - tlon) ** 2
        if d < best_d:
            best, best_d = zone, d
    return best


def _parse_dt(s: str) -> datetime:
    s = s.strip().replace(" UTC", "")
    dt = datetime.fromisoformat(s)
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _header_map(fieldnames: list[str]) -> dict[str, str]:
    return {name.lower(): name for name in fieldnames}


def build(ais_csv: str, out_csv: str, min_anchor_min: float = 0.0, sog_max: float = 1.0) -> dict:
    """Convert an AccessAIS export into the per-zone hourly congestion series."""
    first: dict[str, datetime] = {}
    last: dict[str, datetime] = {}
    pos_sum: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0])
    rows = skipped = 0

    with open(ais_csv, newline="", encoding="utf-8", errors="replace") as fh:
        reader = csv.DictReader(fh)
        cols = _header_map(reader.fieldnames or [])
        missing = [c for c in REQUIRED if c not in cols]
        if missing:
            raise SystemExit(f"missing required columns {missing}; found {reader.fieldnames}")
        for row in reader:
            rows += 1
            try:
                lat = float(row[cols["lat"]]); lon = float(row[cols["lon"]]); sog = float(row[cols["sog"]])
                mmsi = str(row[cols["mmsi"]]).strip()
                ts = _parse_dt(row[cols["basedatetime"]])
            except (KeyError, ValueError, TypeError):
                skipped += 1
                continue
            if not _in_bbox(lat, lon) or sog >= sog_max:
                continue
            if not any(_in_rect(lat, lon, r) for r in ANCHORAGE_RECTS):
                continue
            if mmsi not in first or ts < first[mmsi]:
                first[mmsi] = ts
            if mmsi not in last or ts > last[mmsi]:
                last[mmsi] = ts
            agg = pos_sum[mmsi]
            agg[0] += lat; agg[1] += lon; agg[2] += 1

    # per-vessel interval + zone
    vessels: list[tuple[str, datetime, datetime, float, str]] = []
    for mmsi, t0 in first.items():
        t1 = last[mmsi]
        span_min = (t1 - t0).total_seconds() / 60.0
        if span_min < min_anchor_min:
            continue
        agg = pos_sum[mmsi]
        zone = _zone_for(agg[0] / agg[2], agg[1] / agg[2])
        vessels.append((mmsi, t0, t1, (t1 - t0).total_seconds() / 3600.0, zone))

    if not vessels:
        raise SystemExit("no anchored vessels found — check the bbox / SOG threshold / columns")

    start = min(v[1] for v in vessels).replace(minute=0, second=0, microsecond=0)
    end = max(v[2] for v in vessels).replace(minute=0, second=0, microsecond=0)

    series: list[dict] = []
    hour = start
    while hour <= end:
        per_zone: dict[str, list[float]] = {z: [] for z in ref.TERMINAL_ZONES}
        for _mmsi, t0, t1, dwell, zone in vessels:
            # vessel counts toward hour bucket [hour, hour+1) if its anchored interval overlaps it
            if t0 < hour + timedelta(hours=1) and t1 >= hour:
                per_zone[zone].append(dwell)
        port_q = 0
        port_wsum = 0.0
        for zone, dwells in per_zone.items():
            q = len(dwells)
            wait = sum(dwells) / q if q else 0.0
            series.append({"zoneCode": zone, "ts": hour, "queueCount": q,
                           "avgWaitHrs": round(wait, 2),
                           "index": round(_index(q, wait), 2)})
            port_q += q
            port_wsum += wait * q
        port_wait = port_wsum / port_q if port_q else 0.0
        series.append({"zoneCode": "Z-PORT", "ts": hour, "queueCount": port_q,
                       "avgWaitHrs": round(port_wait, 2), "index": round(_index(port_q, port_wait), 2)})
        hour += timedelta(hours=1)

    with open(out_csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["zoneCode", "ts", "queueCount", "avgWaitHrs", "index"])
        for r in series:
            w.writerow([r["zoneCode"], r["ts"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                        r["queueCount"], r["avgWaitHrs"], r["index"]])

    return {"rows_scanned": rows, "skipped": skipped, "vessels": len(vessels),
            "hours": (end - start).total_seconds() / 3600 + 1, "output_rows": len(series)}


def _index(queue: float, wait_hours: float) -> float:
    return max(0.0, min(100.0, 60 * (queue / ref.CONGESTION_QUEUE_CAP) + 40 * (wait_hours / ref.CONGESTION_WAIT_CAP)))


def import_series(series_csv: str) -> dict:
    """Replace the congestion history with an AIS-derived series (source="AIS")."""
    from sqlalchemy import delete

    from ..db import SessionLocal, init_db
    from ..models import CongestionObservation

    with open(series_csv, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
    if not rows:
        raise SystemExit("series CSV is empty")
    newest = max(_parse_dt(r["ts"]) for r in rows)

    init_db()
    db = SessionLocal()
    try:
        db.execute(delete(CongestionObservation))
        seen: set[tuple[str, int]] = set()
        count = 0
        for r in rows:
            ts = _parse_dt(r["ts"])
            hours_ago = int(round((newest - ts).total_seconds() / 3600))
            key = (r["zoneCode"], hours_ago)
            if key in seen:
                continue
            seen.add(key)
            db.add(CongestionObservation(
                zone_code=r["zoneCode"], ts=ts, hours_ago=hours_ago,
                queue_count=int(float(r["queueCount"])), avg_wait_hours=float(r["avgWaitHrs"]),
                index=float(r["index"]), yard_util_pct=None,
                source="AIS", is_measured=True, confidence=0.85,
            ))
            count += 1
        db.commit()
        return {"inserted": count, "zones": len({r["zoneCode"] for r in rows}), "newest_ts": newest.isoformat()}
    finally:
        db.close()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="app.pipelines.ais", description="NOAA AccessAIS → congestion series → PostgreSQL")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="AccessAIS CSV → congestion-series CSV")
    b.add_argument("ais_csv"); b.add_argument("out_csv")
    b.add_argument("--min-anchor-min", type=float, default=0.0)
    b.add_argument("--sog-max", type=float, default=1.0)
    i = sub.add_parser("import", help="congestion-series CSV → database (source=AIS)")
    i.add_argument("series_csv")
    args = p.parse_args(argv)

    if args.cmd == "build":
        print(build(args.ais_csv, args.out_csv, args.min_anchor_min, args.sog_max))
    else:
        print(import_series(args.series_csv))


if __name__ == "__main__":
    main(sys.argv[1:])
