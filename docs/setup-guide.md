# Setup Guide — PortPulse AI

Tested stack: **Python 3.11 (uv) + FastAPI + PostgreSQL + React/Vite**.

## 1. Prerequisites

- **uv** for the Python toolchain
- **PostgreSQL** running locally
- **Node.js ≥ 20** + npm
- **IBM Bob CLI** for the agentic assistant (optional for deterministic local fallback)

## 2. Run

```bash
git clone <your-repo-url> && cd <repo>
createdb -U postgres portflow

cd src/backend
uv sync --python 3.11
cp .env.example .env
# Set DATABASE_URL and BOB_API_KEY in your local environment.
uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8000

# second terminal
cd ../frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## 3. IBM Bob

Set `BOB_API_KEY` and register `src/backend/app/mcp_server.py` with IBM Bob. `LLM_PROVIDER=auto` selects Bob when the CLI/key are available; otherwise the application uses deterministic engine-derived text. **There is no Claude or other external LLM fallback.**

## 4. Data sources

| Source | Role | Status |
|---|---|---|
| Port of Long Beach fact sheets | Real berth/crane/terminal capacity | Active |
| DEMO_AIS / SimPy | Clearly labelled synthetic vessel/operations layer | Active demo path |
| NOAA AccessAIS pipeline | Replaceable real AIS history path | Available |
| Open-Meteo | Wind/gust/wave/visibility features | Active |
| BTS PPFSP parser | Benchmark/validation path | Available |

The hybrid real/synthetic approach is intentional: public feeds do not provide a complete live terminal TOS dataset.

## 5. Core API

- `/api/overview` — command view
- `/api/forecast?zone=` — LightGBM 72h forecast + uncertainty
- `/api/optimise` — OR-Tools CP-SAT BAP/QCAP
- `/api/routing` — routing recommendations
- `/api/plan` — persisted/provenance-aware 72h plan
- `/api/terminals` — real POLB capacity + live state
- `/api/vessels` — vessel queue + assignments
- `/api/vessels/upload` — CSV schedule ingestion + ETA revision history + auto-replan
- `/api/anomalies` — Isolation Forest disruption flags
- `/api/hotspots` — binding-resource risk ranking
- `/api/quality` — data completeness + normalization status
- `/api/weather` — Open-Meteo observations
- `/api/scenarios` — what-if stress tests
- `/api/bob` — IBM Bob operational assistant
- MCP `app.mcp_server` — 11 Bob tools + resources + prompts

## 6. Performance limitation

The prototype prioritizes reproducibility and explainability over production dispatch latency. Cold LightGBM forecasting is approximately **11 seconds** and a cold full plan can take approximately **20–30 seconds**; warm process-cached requests are approximately **1 second**. For a live demonstration, prewarm the engines before the walkthrough.

## 7. Demo scope

The submission is intentionally limited to the core L1 decision loop: **observe → predict → explain risk → optimise → route → plan → Bob**. Full TOS/EDI integration, live port-wide coverage, continuous retraining and enterprise deployment are Phase-2 items.
