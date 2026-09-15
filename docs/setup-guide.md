# Setup Guide — PortFlow SBX

Tested end-to-end with **Python 3.11 (uv) + FastAPI + PostgreSQL + React/Vite**. The stack matches
`3_Technical_Architecture_and_Build_Plan.md` §1.

## 1. Prerequisites

- **uv** (Python toolchain) — `curl -LsSf https://astral.sh/uv/install.sh | sh` (Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`). uv fetches Python **3.11** automatically.
- **PostgreSQL** running locally (tested on PostgreSQL 18, port `5432`). TimescaleDB is *not* required — the plan allows plain tables.
- **Node.js ≥ 20** + npm (for the Vite frontend).

## 2. Step-by-step

```bash
# 0. get the repo
git clone <your-repo-url> && cd <repo>

# 1. create the PostgreSQL database (once)
createdb -U postgres portflow        # or: psql -U postgres -c "CREATE DATABASE portflow;"

# 2. BACKEND
cd src/backend
uv sync --python 3.11                # creates .venv and installs FastAPI, LightGBM, OR-Tools, SimPy, sklearn, anthropic…
cp .env.example .env                 # then edit DATABASE_URL with your PostgreSQL user + password
uv run python -m app.seed            # REAL POLB terminals + SimPy synthetic operations layer

uv run uvicorn app.main:app --reload --port 8000
#   → API docs: http://localhost:8000/docs   (health: http://localhost:8000/health)

# 3. FRONTEND (second terminal)
cd ../frontend
npm install
npm run dev                          # → http://localhost:5173  (proxies /api → :8000)
```

**Verify (30 s):** open http://localhost:5173 — the **Overview** tab shows KPIs, zone cards, hotspot
risk and anomaly flags. Then: `curl http://localhost:8000/api/overview | head -c 300`, click
**Berth & Cranes → Run scenario**, **72-Hr Plan**, and ask Bob *"what's the congestion outlook for the
next 72 hours?"*.

## 3. Environment variables (`src/backend/.env`)

| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres:YOUR_PASSWORD@localhost:5432/portflow` | SQLAlchemy + psycopg3 URL. Database must exist first. |
| `ANTHROPIC_API_KEY` | *(optional)* | Enables the Claude narrative layer. If unset, the plan/Bob fall back to a deterministic template built from the same engine numbers. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Claude model id. |
| `CORS_ORIGINS` | `http://localhost:5173` | Dashboard origin(s). |
| `REFERENCE_LAT` / `REFERENCE_LON` | `33.74` / `-118.20` | San Pedro Bay reference point for the weather pipeline. |
| `SIM_SEED` / `SIM_HORIZON_HOURS` | `20240817` / `72` | SimPy determinism + horizon. |

No key is required to run the app.

## 4. Reseeding / resetting

```bash
cd src/backend
# Wipe everything and start fresh (terminals + SimPy layer):
uv run python -m app.seed --reset

# Or drop + recreate all tables, then reseed:
uv run python -c "from app.db import drop_all, init_db; drop_all(); init_db()"
uv run python -m app.seed
```

On first start the server **auto-generates** the AIS congestion history and weather data — no manual step needed.

## 5. Data sources

| Source | What | How loaded |
|---|---|---|
| **REAL POLB terminals** | Berth lengths, cranes, capacity — `GET /api/terminals` | `reference.py` (hardcoded from POLB fact sheets) |
| **AIS congestion history** | 14-day hourly queue / wait / index per zone — `source="AIS"` | Auto-generated on startup via `pipelines/ais_generate.py`; refresh via **Quality page → Regenerate AIS** or `POST /api/ais/generate` |
| **Open-Meteo weather** | 72h wind / gust / wave / visibility | Auto-fetched on startup; refresh via **Quality page → Refresh Weather** or `POST /api/weather/refresh` |
| **Vessel schedule** | Vessel queue — uploadable CSV | **Quality page → Upload CSV** or `POST /api/vessels/upload` |
| **Real NOAA AccessAIS** | Replace generated history with a real export | `uv run python -m app.pipelines.ais build <ais.csv> series.csv && uv run python -m app.pipelines.ais import series.csv` |

## 6. Useful commands

| Command | What it does |
|---|---|
| `uv run uvicorn app.main:app --reload` | Run the FastAPI gateway (:8000) |
| `uv run python -m app.seed` | Reseed reference data (safe — skips if data exists) |
| `uv run python -m app.seed --reset` | Force full wipe + reseed |
| `uv run python -m app.pipelines.ais_generate` | Generate + load AIS history (14d) into DB |
| `uv run python -m app.pipelines.ais build <ais.csv> series.csv` | Real NOAA AccessAIS CSV → congestion series |
| `uv run python -m app.pipelines.ais import series.csv` | Load series into DB (`source="AIS"`) |
| `uv run python -m app.mcp_server` | Run the MCP server (stdio) for IBM Bob |
| `npm run dev` (in `frontend/`) | Run the React/Vite dashboard (:5173) |
| `npm run build` (in `frontend/`) | Type-check + production build |
| `curl localhost:8000/api/forecast?zone=Z-PORT` | LightGBM forecast + bands + validation |
| `curl localhost:8000/api/ais/status` | Current congestion history source + row count |

## 7. API endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/overview` | GET | KPIs, zone status, alerts, hotspots, anomalies |
| `/api/forecast?zone=` | GET | LightGBM forecast (72h), bands, model card, per-horizon validation |
| `/api/optimise` | GET(latest)/POST | OR-Tools CP-SAT BAP/QCAP run (POST accepts scenario body) |
| `/api/scenarios` | POST | Baseline-vs-scenario impact assessment |
| `/api/routing` | GET | Divert / slow-steam / priority-window / hold recommendations |
| `/api/plan` | GET(`?text=1`)/POST | 72h plan JSON or printable text |
| `/api/terminals` | GET | REAL POLB capacity + crane/yard/gate state |
| `/api/vessels` | GET | Queue enriched with assignments |
| `/api/vessels/upload` | POST | Upload CSV vessel schedule → auto-replan |
| `/api/anomalies` | GET | Isolation Forest flags |
| `/api/hotspots` | GET | Risk-score ranking + binding resource |
| `/api/quality` | GET | Per-terminal data completeness scores |
| `/api/weather` | GET | Open-Meteo 72h wind/gust/wave/visibility |
| `/api/weather/refresh` | POST | Re-fetch weather from Open-Meteo |
| `/api/ais/status` | GET | Current congestion history source + stats |
| `/api/ais/generate` | POST | Generate + load realistic AIS history |
| `/api/export?type=` | GET | CSV: assignments / routing / vessels / forecast |
| `/api/bob` | GET/POST | Assistant history / message (Claude + deterministic fallback) |
| **MCP** `app.mcp_server` | stdio | 11 engine tools + resources + prompts for **IBM Bob** |

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Can't reach database server` / `ECONNREFUSED` | PostgreSQL not running | start the service; check host/port in `DATABASE_URL` |
| `database "portflow" does not exist` | DB not created | `createdb -U postgres portflow` |
| `Authentication failed for user` | wrong credentials | fix `DATABASE_URL` in `src/backend/.env` |
| `uv: command not found` | uv not installed | install uv (prereq) — uv manages Python 3.11 |
| Frontend shows “Loading…” forever | backend not running or wrong port | start uvicorn on :8000 (Vite proxies `/api` there) |
| Bob replies `mode: deterministic` | no `ANTHROPIC_API_KEY` (or Claude unreachable) | engines still ran; set the key to enable Claude phrasing |
| CP-SAT takes long on `/api/optimise` | 28 vessels × berths × crane options | it is capped at 8 s; results are cached for 120 s |

## 9. What "running" should look like

- **Overview:** KPI cards, 5 zone cards with sparklines + level badges, hotspot risk with binding
  resource, Isolation Forest anomaly flags.
- **Forecast:** 72 h LightGBM curve with an 80 % quantile band, model card (version, MAE, skill), and a
  per-horizon validation table.
- **Berth & Cranes:** scenario sliders (crane availability, productivity), CP-SAT vs FIFO metrics, a 72 h
  Gantt, assignment table, and the real terminal/crane/yard/gate table.
- **Routing:** divert / slow-steam / priority / hold cards with $ savings and confidence.
- **72-Hr Plan:** 12 shift cards + top actions + CSV export.
- **Bob AI:** answers with the tool-calls it executed and the mode (`llm` / `deterministic`).
