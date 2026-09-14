# Setup Guide — PortFlow SBX

Tested end-to-end with Bun + Next.js 16 + Prisma/PostgreSQL. Everything below runs on a stock machine with a local PostgreSQL server (all runtime data is local afterwards).

## 1. Prerequisites

- **Bun** ≥ 1.1 (`curl -fsSL https://bun.sh/install | bash`)
- **PostgreSQL** running locally (tested on PostgreSQL 18, default port `5432`), with a superuser/login you know. This guide assumes the default superuser `postgres` on `localhost`.

## 2. Step-by-step

```bash
# 0. get the repo and enter the app root (the Next.js app lives in src/)
git clone <your-repo-url> && cd <repo>/src

# 1. create the database (once)
createdb -U postgres portflow_sbx          # or: psql -U postgres -c "CREATE DATABASE portflow_sbx;"

# 2. install dependencies
bun install

# 3. environment — create src/.env from the template (it is gitignored):
cp .env.example .env
#    then edit DATABASE_URL in src/.env with your PostgreSQL user + password
#    (format: postgresql://USER:PASSWORD@HOST:PORT/portflow_sbx?schema=public)

# 4. create the PostgreSQL schema
bun run db:push

# 5. seed: real POLB terminal capacities + labelled demo vessels/history
bun run db:seed

# 6. run
bun run dev        # → http://localhost:3000
```

**Verify (30 seconds):** open http://localhost:3000 — the Overview tab should show port-wide KPIs and 5 zone cards. Then: `curl http://localhost:3000/api/overview | head -c 400`, click **Berth & Cranes → Run optimiser**, **72-Hr Plan → Regenerate plan**, and ask Bob *"what's the congestion outlook for the next 72 hours?"*.

## 3. Environment variables

| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:YOUR_PASSWORD@localhost:5432/portflow_sbx?schema=public` | PostgreSQL connection string. Format: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public` — replace `YOUR_PASSWORD` with your login. The database (`portflow_sbx`) must exist before `bun run db:push`. Template: `src/.env.example`. |

No API keys are required to run the app. Bob's LLM mode uses the `z-ai-web-dev-sdk` server-side; without SDK access Bob still answers in deterministic mode (see troubleshooting).

## 4. Reseeding / resetting

```bash
bun run db:seed      # wipes + reseeds vessels/history/terminals (deterministic seed 20240817)
bun run db:push      # re-applies the schema after schema edits (--accept-data-loss is in the script)
bunx prisma db push --force-reset && bun run db:seed   # full reset (drop + recreate tables, then reseed)
```

The seed is deterministic (mulberry32 PRNG, seed `20240817`): every fresh seed produces the same 4 terminals / 13 berths / 62 cranes, 38 vessels (28 at anchor or drifting, 10 inbound) and 336 h × 5 zones of history including a wind-delay incident 144 h ago and a PCT crane outage 72–36 h ago.

## 5. Swapping in REAL AIS data (NOAA AccessAIS)

The shipped history/vessels are labelled `DEMO_AIS`. To train the forecast on real AIS-derived congestion:

1. **Download a real export.** Use the AccessAIS "clip and ship" tool — **NOAA Office for Coastal Management, AccessAIS, https://marinecadastre.gov/accessais/** — draw a bounding box around San Pedro Bay (the approach + anchorage area of the Ports of LA/Long Beach), pick a 1–2 month window, and download the zipped CSV (a few hundred MB zipped is typical; keep the export under the ~2 GB order limit). Unzip it; the CSV has columns `MMSI, BaseDateTime, LAT, LON, SOG, COG, Heading, Status, …, VesselName, …`.
2. **Build the congestion series:**

   ```bash
   bun scripts/ais/build-congestion.ts path/to/ais-export.csv congestion-series.csv --help
   # (drop --help once you've seen the options)
   bun scripts/ais/build-congestion.ts path/to/ais-export.csv congestion-series.csv
   ```

   The script filters to the San Pedro Bay bounding box, classifies at-anchor positions (SOG < 1 kn) inside documented anchorage rectangles, computes per-vessel anchorage dwell, assigns each vessel to the nearest terminal zone, and aggregates hourly `queueCount` / `avgWaitHrs` / `index` (the index formula is identical to the engine's). Details and the rectangle definitions: `src/scripts/ais/README.md`.
3. **Inspect the output:** `head congestion-series.csv` → header `zoneCode,ts,queueCount,avgWaitHrs,index`, rows for `Z-LBCT, Z-ITS, Z-PCT, Z-TTI, Z-PORT`.
4. **Load it into the database:**

   ```bash
   bun scripts/ais/import-series.ts congestion-series.csv
   ```

   This writes the rows into `CongestionReading` with `source="AIS"` and `hoursAgo` computed from the timestamps (0 = most recent). It **replaces the congestion history** so the series stays coherent — say so to anyone using the DB.
5. **Restart / reload.** Hit `/api/overview` again (or restart `bun run dev`): the forecast now trains on the AIS-derived series, and the Overview `dataset.note` reflects the AIS source. The vessel queue itself remains the labelled demo set — deriving a real queue (MMSI-level) is the same pipeline's next step and is documented as a limitation.

**Data source citations (required):** AIS/congestion series — NOAA Office for Coastal Management, AccessAIS (Marine Cadastre), https://marinecadastre.gov/accessais/. Terminal berth/crane capacities — Port of Long Beach terminal fact sheets (polb.com): LBCT Pier E 4,200 ft / 3 deepsea berths / 18 STS cranes, 3.5M+ TEU annual capacity; ITS Pier G 4,250 ft / 14; PCT Pier J 5,902 ft / 14; TTI Pier T 5,000 ft / 16; port-wide 80 berths, 10 piers, 71 post-Panamax gantry cranes.

## 6. Useful commands

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server on port 3000 (logs tee'd to `dev.log`) |
| `bun run lint` | ESLint over the repo |
| `bun run db:push` | Apply `src/prisma/schema.prisma` to PostgreSQL |
| `bun run db:seed` | Wipe + reseed demo data (deterministic) |
| `bun scripts/ais/build-congestion.ts <ais.csv> <out.csv>` | Real AIS CSV → congestion series |
| `bun scripts/ais/import-series.ts <series.csv>` | Load a congestion series into the DB (`source="AIS"`) |

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `EADDRINUSE` / port 3000 already busy | another process holds port 3000 (e.g. a previous dev server) | kill it (`lsof -i :3000`, then kill the PID) or start on another port: `PORT=3001 bun run dev` (URL becomes http://localhost:3001) |
| Prisma error: *Environment variable not found: DATABASE_URL* | `.env` missing from the app root (`src/`) | create it (from `src/`): `cp .env.example .env`, then re-run `bun run db:push` |
| Prisma error: *Can't reach database server* / `ECONNREFUSED` | PostgreSQL is not running (or is on another port) | start the service (`pg_ctl start`, or the Windows "postgresql-x64-*" service) and confirm the port/host in `DATABASE_URL` |
| Prisma error: *Authentication failed for user "postgres"* | wrong password/user in `DATABASE_URL` | fix the credentials in `src/.env` (use your PostgreSQL user + password) |
| Prisma error: *database "portflow_sbx" does not exist* | the database was never created | `createdb -U postgres portflow_sbx` (or `CREATE DATABASE portflow_sbx;` in psql), then `bun run db:push` |
| Charts empty / zone cards show 0 / "no data" | schema was pushed but never seeded | run `bun run db:seed`, then reload the page — the engines need the 14-day history and the vessel queue |
| `POST /api/optimise` or `POST /api/plan` returns 500 | DB empty, stale, or corrupted (e.g. killed mid-seed) | `bunx prisma db push --force-reset && bun run db:seed`; check `dev.log` for the stack trace |
| Bob replies marked `deterministic` instead of LLM mode | the backend LLM (z-ai-web-dev-sdk) is unreachable/without quota — the **engines still ran** (see the `actions` metadata on the message) | this is the designed fallback: answers stay engine-grounded; restore SDK/network access and Bob switches back to `mode: "llm"` automatically |
| ESLint errors on `bun run lint` | style/type issues (unused vars, `any`, hooks deps) | fix the reported files; config is `eslint.config.mjs` (eslint-config-next). Do not merge with a red lint — see `CONTRIBUTING.md` |
| Forecast looks flat/implausible after an AIS import | the imported series is short or gappy (short export window) | re-run `build-congestion.ts` over a 1–2 month export; or `bun run db:seed` to restore the labelled demo series |

## 8. What "running" should look like

- Overview: 5 zone cards (port-wide + 4 terminals) with index/queue/wait, trend and level badges; alerts (e.g. long-waiting vessels, heavy reefer loads).
- Forecast: 72 h curve with shaded 80 % band, hotspot ranking by forecast peak, model card with MAE₂₄/MAE₇₂/R²/skill.
- Berth & Cranes: after **Run optimiser**, assignments + FIFO vs optimised metrics with deltas.
- Routing: per-vessel divert / slow-steam / priority-window recommendations with $ savings.
- 72-Hr Plan: 12 shift cards + printable text (`GET /api/plan?text=1`).
- Bob AI: answers cite engine-run actions; fallback answers are visibly marked deterministic.
