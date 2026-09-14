# PortFlow SBX — Python backend

FastAPI gateway + capability services, implementing the stack from the technical
plan (`3_Technical_Architecture_and_Build_Plan.md` §1):

| Capability | Technology | Module |
|---|---|---|
| Gateway / API | **FastAPI** (Python 3.11) | `app/main.py`, `app/routers/*` |
| Simulation (synthetic ops layer) | **SimPy** discrete-event | `app/services/simulation.py` |
| Congestion forecasting | **LightGBM** (+ quantile bands) | `app/services/forecasting.py` |
| Anomaly / disruption detection | **scikit-learn Isolation Forest** | `app/services/anomaly.py` |
| Hotspot ranking + risk score | deterministic scorer | `app/services/hotspot.py` |
| Berth/crane optimisation (BAP/QCAP) | **Google OR-Tools CP-SAT** | `app/services/optimiser.py` |
| Routing / diversion | rule + cost model | `app/services/routing.py` |
| 72-hour plan | assembler + **Claude** narrative | `app/services/plan.py`, `llm.py` |
| Persistence | **PostgreSQL** (SQLAlchemy 2 + psycopg3) | `app/models.py`, `db.py` |

## Run

```bash
uv sync --python 3.11          # install (pins Python 3.11)

# Postgres must be running; create the database once:
createdb -U postgres portflow

cp .env.example .env           # then set DATABASE_URL + (optional) ANTHROPIC_API_KEY

uv run python -m app.seed      # real POLB terminals + SimPy synthetic ops layer
uv run uvicorn app.main:app --reload --port 8000
# docs: http://localhost:8000/docs
```

## Layout

```
app/
├── main.py            # FastAPI gateway (mounts every capability router)
├── config.py          # pydantic-settings
├── db.py              # SQLAlchemy engine / session / Base
├── models.py          # full data model (spec §18 entity flow)
├── reference.py       # REAL POLB terminals + documented constants
├── seed.py            # DB seed (reference + SimPy output)
├── routers/           # one router per capability
└── services/          # simulation, forecasting, anomaly, hotspot, optimiser,
                       # routing, plan, llm, context, pipeline
```
