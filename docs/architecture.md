# Architecture — PortFlow SBX

Implementation of the technical plan (`3_Technical_Architecture_and_Build_Plan.md` §1–§3): a **FastAPI**
gateway over distinct capability services, a **React + Vite** dashboard, **PostgreSQL** persistence, and a
**SimPy** synthetic operations layer. All code lives under `src/`.

## End-to-end flow

```mermaid
flowchart TB
    subgraph DATA["Data & synthetic operations layer"]
        REF["REAL POLB terminal table<br/>(berths / cranes / yard / gate)"]
        SIM["SimPy discrete-event simulation<br/>vessel calls + ETA revisions + hourly congestion"]
        AIS["NOAA AccessAIS batch pipeline<br/>(optional real AIS → congestion series)"]
        WX["Open-Meteo weather (batch)"]
    end

    DB[("PostgreSQL<br/>SQLAlchemy 2 + psycopg3")]

    subgraph SVC["FastAPI capability services (behind one gateway)"]
        CTX["context.py<br/>EngineContext (one t0)"]
        FC["forecasting.py<br/>LightGBM + quantile bands"]
        AN["anomaly.py<br/>Isolation Forest"]
        HS["hotspot.py<br/>risk score + binding resource"]
        OPT["optimiser.py<br/>OR-Tools CP-SAT (BAP/QCAP)"]
        RT["routing.py<br/>divert / slow-steam / priority / hold"]
        PL["plan.py<br/>12 × 6h shifts"]
        BOB["bob.py + llm.py<br/>grounded Claude narrative"]
        PIPE["pipeline.py<br/>orchestration + persistence"]
    end

    UI["React + Vite dashboard<br/>Overview · Forecast · Berth & Cranes · Routing · 72-Hr Plan · Bob AI"]

    REF --> DB
    SIM --> DB
    AIS --> DB
    WX -.-> FC
    DB --> CTX --> FC
    CTX --> AN --> HS
    FC --> HS
    FC --> OPT --> RT --> PL
    CTX --> PIPE
    FC --> PIPE
    AN --> PIPE
    HS --> PIPE
    OPT --> PIPE
    RT --> PIPE
    PL --> PIPE
    PIPE --> BOB
    BOB -->|Claude| LLM["Anthropic Claude<br/>(phrasing only)"]
    PIPE --> API["/api/* (FastAPI routers)"]
    API --> UI
    PIPE --> MCP["app/mcp_server.py<br/>MCP tools · resources · prompts"]
    MCP --> BOBAGENT["IBM Bob (MCP client)"]
```

**Data flow in words.** `seed.py` loads the REAL POLB terminal/berth/crane/yard/gate reference tables, then
runs the **SimPy** simulation to generate the vessel queue, ETA-revision history and the 14-day hourly
congestion series (`source="DEMO_AIS"`). `context.py` loads everything into one `EngineContext` with a
single model time `t0`. `forecasting.py` trains a **LightGBM** model per zone (point + quantile 0.1/0.9)
and rolls it out 72 h. `anomaly.py` runs an **Isolation Forest** per zone. `hotspot.py` computes the
composite risk score and names the binding resource. `optimiser.py` solves the berth-allocation +
quay-crane-assignment problem with **OR-Tools CP-SAT** and also computes a FIFO baseline.
`routing.py` turns forecast waits into diver/slow-steam/priority/hold recommendations. `plan.py` fuses
everything into 12 × 6 h shifts. `pipeline.py` orchestrates and persists; the API routers expose it; the
React dashboard consumes it.

## Component table

| File | Responsibility | Tech |
|---|---|---|
| `backend/app/main.py` | FastAPI gateway, CORS, lifespan (auto-seed) | FastAPI |
| `backend/app/routers/*` | one router per capability behind the gateway | FastAPI |
| `backend/app/models.py` | full data model (spec §18 entity flow) | SQLAlchemy 2 |
| `backend/app/reference.py` | REAL POLB terminals + documented constants | — |
| `backend/app/seed.py` | reference seed + SimPy layer | SQLAlchemy + SimPy |
| `backend/app/services/simulation.py` | synthetic berth/crane/yard/gate operations | **SimPy** |
| `backend/app/services/forecasting.py` | congestion forecast + uncertainty bands | **LightGBM** |
| `backend/app/services/anomaly.py` | disruption / data-error detection | **scikit-learn IsolationForest** |
| `backend/app/services/hotspot.py` | risk score w1..w5 + binding constraint | deterministic |
| `backend/app/services/optimiser.py` | BAP/QCAP + FIFO baseline | **OR-Tools CP-SAT** |
| `backend/app/services/routing.py` | divert / slow-steam / priority / hold | rule engine |
| `backend/app/services/plan.py` | 12 × 6h plan (JSON + text) | — |
| `backend/app/services/llm.py` | plan narrative + grounded Q&A | **Anthropic Claude** |
| `backend/app/services/bob.py` | Bob brain (engines → grounded answer); shared by API + MCP | — |
| `backend/app/mcp_server.py` | MCP server: 11 tools + resources + prompts | **MCP (Model Context Protocol)** |
| `backend/app/services/context.py` | DB → EngineContext (one t0) | SQLAlchemy |
| `backend/app/services/pipeline.py` | orchestration + run persistence + caching | — |
| `frontend/src/App.tsx` | 6-tab dashboard | **React + Vite + Tailwind + Recharts** |
| `frontend/src/api.ts` | typed fetch client | — |

## Data model (PostgreSQL / SQLAlchemy)

`Terminal → Berth / Crane / YardZone / Gate → VesselCall (+EtaRevision) → CongestionObservation →
ForecastRun (+ForecastPoint) → HotspotFlag / AnomalyFlag → OptimiserRun (+Assignment) /
RoutingRecommendation → OperationsPlan → Scenario → ImpactAssessment (+ChatMessage)`.

`Terminal`/`Berth` capacity columns are REAL POLB fact-sheet figures; `VesselCall` and
`CongestionObservation` are the labelled `DEMO_AIS` synthetic layer (replaceable by the AIS pipeline).

## Bob integration (load-bearing) — two surfaces, one brain

Both surfaces use `services/bob.py`, so the in-app assistant and IBM Bob behave identically.

1. **in-app (`POST /api/bob`)** → intent detection → the matching **engine pack actually runs** the
   forecast / optimiser / routing / plan services → the engine JSON becomes an `ENGINE DATA` block →
   **Claude** answers strictly from it (if `ANTHROPIC_API_KEY` is set) → the reply is persisted with the
   `actions` list and `mode` (`llm` | `deterministic`).
2. **IBM Bob via MCP (`app/mcp_server.py`)** → Bob registers our MCP server and calls 11 engine tools
   (`forecast_congestion`, `rank_hotspots`, `optimise_berth_cranes`, `recommend_routing`,
   `generate_operations_plan`, `simulate_scenario`, …), reads 4 resources and uses 2 prompts. Each call
   actually runs LightGBM / OR-Tools CP-SAT / routing; Bob phrases the returned numbers.

Without an LLM key (or on failure) the answer is built deterministically from the **same engine output**,
so the numbers are always engine-computed. Registration + tool catalogue: [`bob-mcp.md`](bob-mcp.md).

## Mapping to the hackathon template

| Template | This repo |
|---|---|
| `src/forecasting/` | `src/backend/app/services/forecasting.py` |
| `src/optimiser/` | `src/backend/app/services/optimiser.py` |
| `src/routing/` | `src/backend/app/services/routing.py` |
| `src/bob_integration/` | `src/backend/app/routers/bob.py` + `src/backend/app/services/llm.py` |
| `src/data/` | `src/backend/app/reference.py` + `seed.py` + `simulation.py` + AIS pipeline |
| `src/.env.example` / `src/README.md` | `src/backend/.env.example` / `src/README.md` |
| `docs/` | problem-statement · solution-overview · architecture (this) · setup-guide |
| `demo/`, `presentation/`, `submission.yaml` | repo root |
