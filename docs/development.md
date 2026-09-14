# Developing PortFlow SBX

Developer workflow. (The root [`CONTRIBUTING.md`](../CONTRIBUTING.md) is the hackathon **submission** guide;
this file is the **code** contribution guide.)

## Setup

```bash
# database (once)
createdb -U postgres portflow

# backend (FastAPI + engines) — run from src/backend
cd src/backend
uv sync --python 3.11
cp .env.example .env            # set DATABASE_URL (+ optional ANTHROPIC_API_KEY)
uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8000

# frontend (React + Vite) — run from src/frontend
cd ../frontend
npm install
npm run dev                     # http://localhost:5173
```

## Daily commands

| Command (dir) | Purpose |
|---|---|
| `uv run uvicorn app.main:app --reload` (`backend/`) | Run the FastAPI gateway on :8000 |
| `uv run python -m app.seed` (`backend/`) | Reseed REAL POLB reference + SimPy operations layer |
| `npm run dev` (`frontend/`) | Vite dev server on :5173 (proxies `/api` → :8000) |
| `npm run build` (`frontend/`) | Type-check + production build |
| `uv run ruff check app` (`backend/`) | Lint the backend (if `ruff` installed) |

## Where things live

- Simulation: `backend/app/services/simulation.py` (SimPy) + `reference.py` (REAL POLB data)
- Engines: `backend/app/services/` — `forecasting.py` (LightGBM), `anomaly.py` (Isolation Forest),
  `hotspot.py`, `optimiser.py` (OR-Tools CP-SAT), `routing.py`, `plan.py`, `llm.py` (Claude)
- Gateway/API: `backend/app/main.py`, `backend/app/routers/`
- Data model: `backend/app/models.py`; seed: `backend/app/seed.py`
- UI: `frontend/src/App.tsx` (6 tabs), `frontend/src/api.ts` (typed client)

## PR checklist

- [ ] Change maps to a challenge item (predict hotspots / alternate routing / optimise berths & cranes /
      72-hour plan) or required infrastructure. No scope creep.
- [ ] Template files/folders intact: `submission.yaml`, `README.md`, `docs/`, `demo/`, `presentation/`,
      `CONTRIBUTING.md`.
- [ ] `.github/workflows/validate.yml` untouched; `.gitignore` still excludes `.env`, `node_modules/`,
      `.venv/`, build artefacts — never commit those.
- [ ] Backend imports cleanly (`uv run python -c "import app.main"`); frontend `npm run build` passes.
- [ ] Data honesty preserved: terminal capacities stay the cited REAL POLB figures; anything synthetic
      stays labelled `DEMO_AIS`; anything real cites its source.
- [ ] Numbers in docs match the code (constants live in `backend/app/reference.py`).
- [ ] Disclose breakage in "Known Limitations" (root README).
