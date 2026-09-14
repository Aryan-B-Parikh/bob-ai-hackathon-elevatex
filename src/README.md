# src/ — PortFlow SBX monorepo

Aligned to the technical plan (`3_Technical_Architecture_and_Build_Plan.md` §1). Three parts:

```
src/
├── backend/                     # FastAPI gateway + capability services (Python 3.11)
│   ├── app/
│   │   ├── main.py              # FastAPI gateway (mounts every capability router)
│   │   ├── config.py            # pydantic-settings (.env)
│   │   ├── db.py                # SQLAlchemy 2.0 engine / session / Base
│   │   ├── models.py            # full data model (spec §18 entity flow)
│   │   ├── reference.py         # REAL Port of Long Beach terminals + documented constants
│   │   ├── seed.py              # DB seed: real reference data + SimPy synthetic layer
│   │   ├── serialize.py         # dataclass → JSON helpers
│   │   ├── routers/             # one router per capability (overview, forecast, optimise,
│   │   │                        #   routing, plan, catalog, bob) behind the gateway
│   │   └── services/
│   │       ├── simulation.py    # SimPy discrete-event operations layer
│   │       ├── forecasting.py   # LightGBM + quantile-regression uncertainty bands
│   │       ├── anomaly.py       # scikit-learn Isolation Forest disruption detector
│   │       ├── hotspot.py       # resource-binding attribution + composite risk score
│   │       ├── optimiser.py     # Google OR-Tools CP-SAT (BAP/QCAP) + FIFO baseline
│   │       ├── routing.py       # DIVERT / SLOW_STEAM / PRIORITY_WINDOW / HOLD rule engine
│   │       ├── plan.py          # 12 × 6h operations plan (JSON + printable text)
│   │       ├── llm.py           # Claude (Anthropic) narrative — phrasing only
│   │       ├── context.py       # DB → shared engine context (one model time t0)
│   │       └── pipeline.py      # orchestration + persistence
│   ├── pyproject.toml           # Python deps (uv)
│   ├── .env.example
│   └── README.md
│
├── frontend/                    # React + Vite dashboard
│   ├── src/
│   │   ├── App.tsx              # 6 tabs: Overview · Forecast · Berth & Cranes ·
│   │   │                        #   Routing · 72-Hr Plan · Bob AI
│   │   ├── api.ts               # typed fetch client (proxied to FastAPI)
│   │   ├── main.tsx / index.css
│   ├── index.html
│   ├── vite.config.ts           # React + Tailwind v4 + /api proxy → :8000
│   └── package.json
│
└── README.md (this file)
```

**Data & simulation layers** live inside the backend (`app/services/simulation.py` for SimPy,
`app/reference.py` for the real POLB reference data). The AIS batch pipeline is a separate
script layer described in `docs/setup-guide.md`.

## Technology map (plan §1)

| Layer | Technology | Where |
|---|---|---|
| Gateway / API | FastAPI (Python 3.11) | `backend/app/main.py`, `backend/app/routers/` |
| Simulation (synthetic ops) | SimPy discrete-event | `backend/app/services/simulation.py` |
| Forecasting | LightGBM + quantile bands | `backend/app/services/forecasting.py` |
| Anomaly detection | scikit-learn Isolation Forest | `backend/app/services/anomaly.py` |
| Hotspot / risk score | deterministic scorer | `backend/app/services/hotspot.py` |
| Optimisation (BAP/QCAP) | Google OR-Tools **CP-SAT** | `backend/app/services/optimiser.py` |
| Routing | rule + cost model | `backend/app/services/routing.py` |
| 72h plan | assembler + **Claude** narrative | `backend/app/services/plan.py`, `llm.py` |
| Persistence | PostgreSQL (SQLAlchemy 2 + psycopg3) | `backend/app/models.py`, `db.py` |
| Dashboard | React + Vite + Tailwind + Recharts | `frontend/` |

## Run (short version)

Full tested steps: [`../docs/setup-guide.md`](../docs/setup-guide.md).

```bash
# database (once)
createdb -U postgres portflow

# backend
cd backend
uv sync --python 3.11
cp .env.example .env              # set DATABASE_URL (+ optional ANTHROPIC_API_KEY)
uv run python -m app.seed         # real POLB data + SimPy synthetic operations layer
uv run uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd ../frontend
npm install
npm run dev                       # http://localhost:5173  (proxies /api → :8000)
```
