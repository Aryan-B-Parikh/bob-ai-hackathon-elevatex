# 🚀 PortFlow SBX — Container Congestion Predictor & Port Operations Optimiser

> A 72-hour port-operations cockpit for San Pedro Bay (Ports of Long Beach / Los Angeles), built for the **Bob AI Hackathon** problem **L1 — Container Congestion Predictor & Port Operations Optimiser**, on the technology stack from the project's technical plan (FastAPI · LightGBM · OR-Tools CP-SAT · SimPy · PostgreSQL · React/Vite · Claude).

---

## 👥 Team

| Field | Value |
|---|---|
| **Team Name** | ElevateX |
| **Track** | AI |
| **Team Lead** | Aryan Parikh — aryan81006@gmail.com |
| **Members** | Rudra Parikh |

---

## 🎯 Problem Statement

San Pedro Bay — the twin Ports of Long Beach and Los Angeles, the largest container gateway in the Western Hemisphere — has no single operator view connecting *vessel arrivals*, *berth/crane capacity* and *live congestion*. In the 2021 backlog 100+ container ships waited offshore for weeks (the Marine Exchange queue peaked at roughly **109 vessels**, with **$10B+** in supply-chain impact) because hotspots were discovered reactively, berth and crane plans were built manually, and diversion decisions came too late to matter.

Full analysis and the exact scope: [`docs/problem-statement.md`](docs/problem-statement.md).

---

## 💡 Solution

PortFlow SBX forecasts congestion **before** it happens and hands a shift supervisor a **physically valid 72-hour plan**.

A **SimPy** discrete-event simulation generates the synthetic berth/crane/yard/gate operations layer over the **REAL** Port of Long Beach terminal-capacity table. A **LightGBM** model (with quantile-regression bands) forecasts congestion across 24/48/72 h. A **scikit-learn Isolation Forest** detects disruptions, and a composite risk score names the **binding resource** (berth / crane / yard / gate). An **OR-Tools CP-SAT** solver performs berth allocation + quay-crane assignment under hard physical constraints, always contrasted with a **FIFO** baseline. A **FastAPI** gateway serves it all to a **React/Vite** dashboard and to **Bob**, the AI ops assistant, which runs the engines and (via **Claude**) phrases the grounded plan.

### The four challenge items — and where each lives

| # | Challenge item | Engine code (Python) | API route | UI tab |
|---|---|---|---|---|
| 1 | Predict congestion hotspots | `src/backend/app/services/forecasting.py` (LightGBM) + `hotspot.py` | `GET /api/forecast?zone=…` | **Forecast** |
| 2 | Recommend alternate routing | `src/backend/app/services/routing.py` | `GET /api/routing` | **Routing** |
| 3 | Optimise berth & crane assignments | `src/backend/app/services/optimiser.py` (OR-Tools CP-SAT) | `GET`/`POST /api/optimise` | **Berth & Cranes** |
| 4 | 72-hour operations plan | `src/backend/app/services/plan.py` (+ `llm.py`) | `GET`/`POST /api/plan` | **72-Hr Plan** |

Cross-cutting: KPIs / hotspots / anomalies via `pipeline.py` → `GET /api/overview`; Bob via `services/bob.py` → `GET`/`POST /api/bob`.

### 🤖 IBM Bob integration — load-bearing in **both** directions

| Direction | Flow |
|---|---|
| **Bob → engines** | Bob (CLI/agent) calls our **MCP server** (`src/backend/app/mcp_server.py`): **11 tools** + 4 resources + 2 prompts; each call actually runs LightGBM / OR-Tools CP-SAT / routing. |
| **App → Bob** | The dashboard's **Bob AI** tab and the 72h **plan narrative** run on the **real IBM Bob agent** (`services/bob_agent.py`) — Bob fetches the numbers through our MCP tools. `provider` is reported per answer (`bob` \| `claude` \| `deterministic`). |

So Bob is not a wrapper: the app *is* Bob for its narrative layer, and Bob *is* the agent that drives our engines.
Setup + registration: [`docs/bob-mcp.md`](docs/bob-mcp.md) (`LLM_PROVIDER=auto` + `BOB_API_KEY`).

---

## ✨ Key Features

- **SimPy operations layer** — every berth is a `simpy.Resource`; a discrete-event simulation generates vessel calls, ETA-revision history and the 14-day hourly congestion series (deterministic, seed `20240817`).
- **LightGBM forecasting with quantile bands** — point model + quantile 0.1/0.9 regression per zone over 24/48/72 h; a per-horizon validation table (MAE / σ / bias) and skill-vs-persistence; a **model version** attached to every run.
- **OR-Tools CP-SAT optimiser (BAP/QCAP)** — berth assignment, crane count and start time decided together under hard constraints (berth length/depth, crane reach, no berth overlap, terminal crane-pool capacity); a FIFO baseline is solved alongside for measured deltas; objective weights are exposed.
- **Isolation Forest anomaly detection** — flags bunching / outage / yard saturation and distinguishes a likely **data error** from a real disruption; refuses to assert below a minimum sample size.
- **Resource-binding hotspot scoring** — a composite risk score `w1·queue + w2·utilisation + w3·variance + w4·uncertainty + w5·disruption` that says *which resource is the bottleneck*, not just which berth is busiest.
- **Bob, the load-bearing AI assistant** — exposed to **IBM Bob** as an MCP server (11 tools + resources + prompts) so Bob actually runs the engines, *and* available in-app via `services/bob.py`; intent → real engine calls → strictly grounded prompt → Claude (phrasing only) → tool-call metadata → deterministic fallback.
- **Operational extras** — what-if scenario simulator (crane availability / productivity), live real-POLB terminal/crane/yard/gate table, CSV exports, and a light/dark-ready dashboard.

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | Python 3.11, TypeScript |
| **Frameworks** | FastAPI, React, Vite, Tailwind CSS, SQLAlchemy 2, LightGBM, scikit-learn, Google OR-Tools (CP-SAT), SimPy |
| **IBM Technologies** | IBM Bob (invoked via our Model Context Protocol server) |
| **Databases** | PostgreSQL (psycopg3) |
| **Other** | Anthropic Claude (plan narrative, phrasing only), Recharts, uv, NOAA AccessAIS pipeline, Open-Meteo |

---

## 📁 Repository Structure

```
bob-ai-hackathon-elevatex/
├── src/                          # All project code
│   ├── backend/                  # FastAPI gateway + capability services (Python 3.11)
│   │   ├── app/
│   │   │   ├── main.py           # gateway
│   │   │   ├── models.py         # SQLAlchemy data model
│   │   │   ├── reference.py      # REAL POLB terminals + constants
│   │   │   ├── seed.py           # reference seed + SimPy layer
│   │   │   ├── routers/          # one router per capability
│   │   │   └── services/         # simulation · forecasting · anomaly · hotspot ·
│   │   │                         #   optimiser · routing · plan · llm · pipeline
│   │   ├── pyproject.toml
│   │   └── .env.example
│   ├── frontend/                 # React + Vite dashboard (6 tabs)
│   └── README.md                 # annotated src/ map
├── docs/                         # problem · solution · architecture · setup guide
├── demo/                         # screenshots + demo video link/script
├── presentation/                 # slides.pdf + source
├── submission.yaml
├── IMPLEMENTATION_STATUS.md      # honest code-vs-spec status
└── CONTRIBUTING.md
```

---

## ⚡ How to Run

> **Copy these exact steps from [`docs/setup-guide.md`](docs/setup-guide.md).**

```bash
# 0. Clone
git clone https://github.com/your-org/bob-ai-hackathon-elevatex.git
cd bob-ai-hackathon-elevatex

# 1. Create the PostgreSQL database (once)
createdb -U postgres portflow

# 2. Backend — FastAPI + engines
cd src/backend
uv sync --python 3.11              # uv installs Python 3.11 and all deps
cp .env.example .env               # set DATABASE_URL (+ optional ANTHROPIC_API_KEY)
uv run python -m app.seed          # REAL POLB data + SimPy synthetic operations layer
uv run uvicorn app.main:app --reload --port 8000

# 3. Frontend — React + Vite (second terminal)
cd ../frontend
npm install
npm run dev                        # → http://localhost:5173
```

**Verify:** open http://localhost:5173 (Overview KPIs + hotspots + anomalies), click **Berth & Cranes → Run scenario**, then **72-Hr Plan**, and ask Bob *"what's the congestion outlook for the next 72 hours?"*.

---

## 🖥️ Demo

| Artifact | Link |
|---|---|
| 📹 Demo Video | [See demo/demo-video-link.txt](demo/demo-video-link.txt) (script: [demo/demo-video-script.md](demo/demo-video-script.md)) |
| 🌐 Live Demo | [See demo/live-demo-url.txt](demo/live-demo-url.txt) |
| 🖼️ Screenshots | [See demo/screenshots/](demo/screenshots/) |
| 📊 Presentation | [See presentation/slides.pdf](presentation/slides.pdf) |

---

## 🧪 Data honesty — what is real, what is demo

- **REAL (cited):** the Port of Long Beach terminal capacity table — LBCT Pier E 4,200 ft / 3 berths / 18 STS cranes, 3.5M+ TEU; ITS Pier G 4,250 ft / 14; PCT Pier J 5,902 ft / 14; TTI Pier T 5,000 ft / 16 (POLB fact sheets). These are the optimiser's hard constraints (`GET /api/terminals`).
- **SYNTHETIC (`DEMO_AIS`):** the vessel queue and 14-day hourly congestion series, produced by the SimPy simulation — the operational layer no public dataset exposes.
- **REAL pipeline path:** the NOAA AccessAIS batch pipeline (`src/backend/app/pipelines/ais.py`) converts a genuine AccessAIS CSV into the same `CongestionObservation` schema (`source="AIS"`) — see [`docs/setup-guide.md`](docs/setup-guide.md) §5. Data source: NOAA Office for Coastal Management, AccessAIS (https://marinecadastre.gov/accessais/).

---

## ⚠️ Known Limitations

- **`DEMO_AIS` operations layer** — vessel queue + history are SimPy-generated and labelled; no live AIS/TOS feed.
- **13 berths modelled** (four POLB container terminals), not the port-wide 80-berth estate.
- **Tidal windows** are modelled only as a berth draft bound, not a time-varying tide curve.
- **Objective trade-off** — in the deliberately oversubscribed scenario CP-SAT prioritises wait/makespan (the spec objective); cargo volume is reported but not optimised.
- **LLM is optional** — Claude phrases the plan; without a key Bob/plan use a deterministic template over the same numbers.
- **Caching is in-memory**; vessel ETAs are fixed at seed time.

---

## 🏅 What We're Most Proud Of

The **entire stack matches the technical plan** — SimPy generates the operations layer, LightGBM forecasts with quantile bands, Isolation Forest detects disruptions, and **OR-Tools CP-SAT solves berth + crane assignment exactly** under hard constraints with an honest FIFO baseline. And **Bob is load-bearing**: every answer actually runs the engines and is auditable through the tool-call metadata, with a deterministic fallback built from the same engine output.

---

## 📚 Documentation index

- [`docs/problem-statement.md`](docs/problem-statement.md) — problem, 2021 evidence, scope
- [`docs/solution-overview.md`](docs/solution-overview.md) — modules, algorithms, constants
- [`docs/architecture.md`](docs/architecture.md) — layers, data flow, API, Bob flow
- [`docs/setup-guide.md`](docs/setup-guide.md) — tested setup, env vars, troubleshooting
- [`src/README.md`](src/README.md) — annotated monorepo map
- [`docs/bob-mcp.md`](docs/bob-mcp.md) — IBM Bob MCP integration (tools, resources, registration)
- [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) — honest code-vs-spec status
- [`TEAM_PLAN.md`](TEAM_PLAN.md) — 4-way parallel work division + merge protocol (Phase 0 ✅ done)
- [`AUDIT.md`](AUDIT.md) — code-based audit vs the 3 spec docs (findings + fixes)
- [`docs/api-contract.md`](docs/api-contract.md) — frozen API contract (paths, shapes, DB fields)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev workflow
