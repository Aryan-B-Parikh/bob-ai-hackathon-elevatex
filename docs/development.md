# Developing PortPulse AI

Developer workflow. The core rule is **no scope creep**: keep the submission focused on the complete L1 decision loop.

## Setup

```bash
createdb -U postgres portflow

cd src/backend
uv sync --python 3.11
cp .env.example .env            # set DATABASE_URL and, for agentic mode, BOB_API_KEY
uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install
npm run dev
```

## Daily commands

| Command | Purpose |
|---|---|
| `uv run uvicorn app.main:app --reload` | FastAPI gateway on :8000 |
| `uv run python -m app.seed` | Seed real POLB reference + SimPy operations layer |
| `npm run dev` | Vite development server on :5173 |
| `npm run build` | Type-check + production build |
| `uv run ruff check app` | Backend lint |
| `uv run pytest` | Backend tests |

## Architecture

- Simulation: `backend/app/services/simulation.py`
- Forecasting: `backend/app/services/forecasting.py` (LightGBM)
- Anomalies: `backend/app/services/anomaly.py` (Isolation Forest)
- Hotspots: `backend/app/services/hotspot.py`
- Optimisation: `backend/app/services/optimiser.py` (OR-Tools CP-SAT)
- Routing: `backend/app/services/routing.py`
- Plan: `backend/app/services/plan.py`
- Bob agent: `backend/app/services/bob_agent.py`
- MCP server: `backend/app/mcp_server.py`
- UI: `frontend/src/`

## Scope lock

The MVP is **observe → predict → explain risk → optimise → route → plan → Bob**.

Do not add major new subsystems before submission. Full live TOS/EDI integration, complete port-wide coverage, continuous retraining, enterprise authentication and distributed scheduling are Phase-2 work.

## Data honesty

- Real POLB capacity remains sourced from published fact sheets.
- Synthetic operational history remains explicitly labelled `DEMO_AIS`.
- Real AIS is supported through the NOAA AccessAIS replacement pipeline.
- Weather is sourced from Open-Meteo.
- Do not present synthetic demo values as live terminal telemetry.

## Agent rule

IBM Bob is the only AI-agent provider. It invokes the operational engines through MCP. If Bob is unavailable, use the deterministic engine-derived briefing; do not add another external LLM fallback.
