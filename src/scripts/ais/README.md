# scripts/ais — Real AIS → Congestion-Series Pipeline

This folder is the **real-data path** for PortFlow SBX. The app ships with a clearly-labelled demo dataset (`source: "DEMO_AIS"` in the database). These two scripts convert a **real NOAA AccessAIS export** into the exact per-zone hourly congestion series the forecasting engine consumes, and load it into the database with `source: "AIS"`.

**Data source:** NOAA Office for Coastal Management — **AccessAIS** (Marine Cadastre), https://marinecadastre.gov/accessais/. Use the "clip and ship" tool to draw a bounding box around San Pedro Bay (Ports of LA / Long Beach approach + anchorage area) for a 1–2 month window and download the zipped CSV.

Both scripts are self-contained Bun/TypeScript programs using **only** `node:fs` (+ `@prisma/client` for the importer) — no extra packages.

## Files

| File | Purpose |
|---|---|
| `build-congestion.ts` | AccessAIS CSV → `congestion-series.csv` (`zoneCode,ts,queueCount,avgWaitHrs,index`) |
| `import-series.ts` | `congestion-series.csv` → Prisma `CongestionReading` table (`source="AIS"`) |

## Usage

```bash
# 1) build the series from a real AccessAIS export
bun scripts/ais/build-congestion.ts <ais-export.csv> congestion-series.csv

# options
bun scripts/ais/build-congestion.ts --help
#   --min-anchor-min <m>   minimum span (minutes) between first and last anchored
#                          sighting for a vessel to count as a queue member (default 0 =
#                          pure spec: every SOG<1 in-rect sighting pair counts; raise it,
#                          e.g. 60, to suppress passing-traffic noise)
#   --sog-max <kn>         SOG threshold for "at anchor" (default 1.0)

# 2) load into the database (replaces the congestion history — see below)
bun scripts/ais/import-series.ts congestion-series.csv

# 3) restart/reload the app; the forecast now trains on the AIS-derived series
```

## Input format (AccessAIS export)

Standard MarineCadastre zone CSV, one AIS position report per row, UTF-8, header row first:

```
MMSI,BaseDateTime,LAT,LON,SOG,COG,Heading,Status,Length,Width,Draft,Cargo,TransceiverClass
367123456,2021-01-05T14:12:00,33.7197,-118.2652,0.1,123.0,127.0,Moored,294.0,32.0,10.5,70,SOTDMA
```

- Column matching is **case-insensitive by name**; only `MMSI`, `BaseDateTime`, `LAT`, `LON`, `SOG` are required (`VesselName` is used when present).
- `BaseDateTime` is UTC (`2021-01-01T00:00:00`); a trailing space-separated `UTC` is tolerated.
- `LAT`/`LON` are signed decimal degrees (negative longitude = western hemisphere).
- Quoted fields (e.g. vessel names containing commas) are handled.

## Method (and where it is an approximation — read this)

1. **Bounding box.** Only rows inside the San Pedro Bay box are kept:
   `lat 33.55–33.85, lon −118.45…−118.05`.
2. **At-anchor classification.** A row counts as *anchored* when `SOG < sogMax` (default 1 kn) **and** the position falls inside one of these anchorage rectangles — **documented approximations**, not official chart polygons:
   - *San Pedro Anchorage A/B (approx.)* — lat 33.60–33.72, lon −118.30…−118.18
   - *Long Beach Anchorage C (approx.)* — lat 33.68–33.76, lon −118.15…−118.05
3. **Per-vessel dwell.** For each MMSI: `dwell = last anchored timestamp − first anchored timestamp`. This is an **interval approximation** — no interpolation across AIS gaps, and a vessel counts toward every hour between its first and last anchored sighting (bucket flooring to the hour).
4. **Zone assignment.** Each vessel is assigned to the nearest of the four terminal anchor points (documented approximations of the terminal positions):
   `Z-LBCT` (LBCT · Pier E ≈ 33.750, −118.217), `Z-ITS` (ITS · Pier G ≈ 33.746, −118.203), `Z-PCT` (PCT · Pier J ≈ 33.741, −118.181), `Z-TTI` (TTI · Pier T ≈ 33.736, −118.210) — assigned by nearest-distance from the vessel's mean anchored position.
5. **Hourly aggregation.** Per zone and hour: `queueCount` = vessels whose anchored interval overlaps the hour; `avgWaitHrs` = mean dwell of those vessels; `index` = **identical formula to the engine** (`src/lib/engine/forecast.ts`):
   `index = clamp(60·(queue/20) + 40·(wait/72), 0, 100)`.
   A port-wide `Z-PORT` row is emitted per hour (queue = sum of zones; wait = queue-weighted mean), matching the seed's aggregate definition.

## Output format

```csv
zoneCode,ts,queueCount,avgWaitHrs,index
Z-LBCT,2021-01-05T14:00:00Z,3,41.2,43.7
...
Z-PORT,2021-01-05T14:00:00Z,11,38.9,46.9
```

- One row per zone per hour over the full observed window (hours with no anchored vessels → `queueCount 0, avgWaitHrs 0, index 0`).
- `ts` is UTC ISO-8601 on the hour.

## Import behaviour (`import-series.ts`)

- Computes `hoursAgo` per row from the newest timestamp in the file (0 = most recent), matching the `CongestionReading` schema.
- **Replaces the entire `CongestionReading` table** before inserting, and prints what it did. Rationale: mixing an AIS series with the demo series would create a discontinuous history and corrupt training. The demo seed remains available (`bun run db:seed` restores it).
- The vessel queue (`Vessel` rows) is **not** touched by the importer — it stays the labelled demo set. Deriving a real MMSI-level queue from the same AIS export is future work (see Known Limitations in the root README).

## Honest notes

- The anchorage rectangles, terminal anchor coordinates and the 1 kn / interval-overlap approximations are **documented engineering choices**, not survey data. They are the same level of fidelity the master guide prescribes (anchorage wait-time as the congestion proxy, no berth-level AIS clustering).
- AccessAIS files are large (hundreds of MB uncompressed). `build-congestion.ts` streams the file in fixed-size chunks, so memory stays flat regardless of file size; expect a run time of roughly 1–3 minutes per month of data on a laptop.
