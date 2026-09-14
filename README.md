# 🚀 PortFlow SBX — Container Congestion Predictor & Port Operations Optimiser

> A 72-hour port-operations cockpit for San Pedro Bay (Ports of Long Beach / Los Angeles), built for the **Bob AI Hackathon** problem **L1 — Container Congestion Predictor & Port Operations Optimiser**.

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

San Pedro Bay — the twin Ports of Long Beach and Los Angeles, the largest container gateway in the Western Hemisphere — has no single operator view connecting *vessel arrivals*, *berth/crane capacity* and *live congestion*. In the 2021 backlog 100+ container ships waited offshore for weeks (the Marine Exchange queue peaked at roughly **109 vessels**, with **$10B+** in supply-chain impact) because hotspots were discovered reactively, berth and crane plans were built vessel-by-vessel in spreadsheets, and diversion decisions were taken too late to change the economics.

Full analysis, 2021 evidence and the exact scope: [`docs/problem-statement.md`](docs/problem-statement.md).

---

## 💡 Solution

PortFlow SBX is a 72-hour port-operations cockpit that implements the four L1 challenge items end-to-end. A real **schedule-aware ridge-regression model** forecasts congestion hotspots 72 hours ahead with validated 80% bands; a **rule engine** recommends divert / slow-steam / priority-window routing priced through a documented cost model; a **three-phase optimiser** assigns berths and cranes under real Port of Long Beach terminal capacities and reports its measured deltas against a FIFO baseline; and a **12 × 6-hour shift plan** fuses all three for shift supervisors. **Bob**, the AI ops assistant, actually invokes those engines on every question and answers strictly from their computed output.

### The four challenge items — and where each lives

| # | Challenge item | Engine code | API route | UI tab |
|---|---|---|---|---|
| 1 | Predict congestion hotspots using vessel schedules and berth capacity data | `src/lib/engine/forecast.ts` | `GET /api/forecast?zone=…` | **Forecast** |
| 2 | Recommend alternate routing strategies | `src/lib/engine/routing.ts` | `GET /api/routing` | **Routing** |
| 3 | Optimise berth and crane assignments | `src/lib/engine/optimiser.ts` | `GET`/`POST /api/optimise` | **Berth & Cranes** |
| 4 | Generate a 72-hour port operations plan for shift supervisors | `src/lib/engine/plan.ts` | `GET`/`POST /api/plan` | **72-Hr Plan** |

Cross-cutting: live KPIs and zone alerts come from `src/lib/engine/pipeline.ts` → `GET /api/overview` (**Overview** tab); Bob lives in `src/lib/engine/bob.ts` → `GET`/`POST /api/bob` (**Bob AI** tab). Algorithm details and every constant with its source: [`docs/solution-overview.md`](docs/solution-overview.md).

---

## ✨ Key Features

- **Schedule-aware congestion forecasting:** ridge regression (λ = 3.0) with 14 features including ETA arrival pressure and berth load factor, 72-hour damped recursive rollout (δ = 0.75), 48-hour holdout + 12 multi-origin rollouts → 80% bands, per-horizon MAE/σ/bias validation.
- **Berth & crane optimiser:** FIFO first-fit baseline vs a 3-phase priority-selection / ready-time-sequencing / swap + gap-insertion heuristic, constrained by real POLB terminal berth lengths, drafts and STS crane counts; a what-if scenario simulator impairs crane availability and productivity.
- **Alternate-routing recommender:** `DIVERT` / `SLOW_STEAM` / `PRIORITY_WINDOW` / `HOLD` with a documented `$32k/day` ship-cost model, a cited alternate-port table and reefer-spoilage risk logic.
- **72-hour operations plan:** 12 × 6-hour shift cards (arrivals, berthings, crane deployment, congestion alerts, decide-by deadlines, tickable supervisor checklist) plus a printable raw-text plan and JSON.
- **Bob, the load-bearing AI assistant:** intent detection → *real* engine calls via the pipeline → strictly grounded prompt → LLM (backend-only) → tool-call metadata shown in the UI → deterministic engine-derived fallback.
- **Operational extras:** what-if scenario simulator, vessel queue roster + detail dialogs, CSV exports (assignments / routing / vessels / forecast), model-validation view, and a light/dark theme toggle.

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | TypeScript |
| **Frameworks** | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui, Prisma |
| **IBM Technologies** | IBM Bob (AI ops assistant) |
| **Databases** | PostgreSQL (via Prisma) |
| **Other** | Bun, TanStack Query, Recharts, next-themes, z-ai-web-dev-sdk (backend LLM SDK), NOAA AccessAIS real-data pipeline |

---

## 📁 Repository Structure

```
bob-ai-hackathon-elevatex/
├── src/                      # The complete application (app root — run commands from here)
│   ├── app/                  # App Router: dashboard page + /api/* route handlers
│   ├── components/dashboard/ # The 6 feature tabs + shared widgets
│   ├── components/ui/        # shadcn/ui primitives
│   ├── hooks/                # toast + mobile hooks
│   ├── lib/engine/           # forecast, optimiser, routing, plan, pipeline, bob
│   ├── lib/                  # typed API client, Prisma client, utils
│   ├── prisma/               # schema.prisma + deterministic seed
│   ├── scripts/ais/          # real NOAA AccessAIS → congestion-series pipeline
│   ├── public/               # static assets
│   ├── package.json          # build/run manifest (+ lockfile)
│   ├── tsconfig.json / next.config.ts / tailwind.config.ts / eslint.config.mjs
│   ├── .env.example          # environment template (copy to src/.env)
│   └── README.md             # annotated source map
├── docs/                     # problem, solution, architecture, setup guide
│   ├── problem-statement.md
│   ├── solution-overview.md
│   ├── architecture.md
│   └── setup-guide.md
├── demo/                     # demo evidence
│   ├── screenshots/          # 10 app screenshots
│   ├── demo-video-link.txt   # link to the demo video
│   └── demo-video-script.md  # shot-by-shot recording script
├── presentation/             # slide deck (slides.pdf + source)
├── submission.yaml           # structured submission metadata
├── README.md
└── CONTRIBUTING.md
```

> Per the template, **all project code lives inside `src/`** — the complete Next.js app (source, Prisma schema, scripts, configs and manifest) is under `src/`, which is therefore the app root. Run all build/run commands from `src/`. See [`src/README.md`](src/README.md) for the annotated map.

---

## ⚡ How to Run

> **Copy these exact steps from your [`docs/setup-guide.md`](docs/setup-guide.md)**

```bash
# 1. Clone the repo
#    The complete app lives in src/, so that is the app root.
git clone https://github.com/your-org/bob-ai-hackathon-elevatex.git
cd bob-ai-hackathon-elevatex/src

# 2. Prerequisites: Bun >= 1.1 and a running local PostgreSQL server
curl -fsSL https://bun.sh/install | bash

# 3. Create the PostgreSQL database (once)
createdb -U postgres portflow_sbx

# 4. Install dependencies
bun install

# 5. Configure environment (Prisma reads src/.env)
cp .env.example .env        # then set DATABASE_URL to your PostgreSQL connection string

# 6. Create the PostgreSQL schema and seed real POLB capacities + labelled demo data
bun run db:push
bun run db:seed

# 7. Run
bun run dev        # → http://localhost:3000
```

**Verify (30 seconds):** open http://localhost:3000 — the Overview tab should show port-wide KPIs and 5 zone cards. Then click **Berth & Cranes → Run optimiser**, **72-Hr Plan → Regenerate plan**, and ask Bob *"what's the congestion outlook for the next 72 hours?"*.

---

## 🖥️ Demo

| Artifact | Link |
|---|---|
| 📹 Demo Video | [See demo/demo-video-link.txt](demo/demo-video-link.txt) (recording script: [demo/demo-video-script.md](demo/demo-video-script.md)) |
| 🌐 Live Demo | [See demo/live-demo-url.txt](demo/live-demo-url.txt) |
| 🖼️ Screenshots | [See demo/screenshots/](demo/screenshots/) (10 images) |
| 📊 Presentation | [See presentation/slides.pdf](presentation/slides.pdf) |

---

## 🧪 Data honesty — what is real, what is demo

**REAL (hard-coded, cited):** the Port of Long Beach terminal capacity table from POLB terminal fact sheets — LBCT Pier E 4,200 ft / 3 deepsea berths / 18 STS cranes, 3.5M+ TEU annual capacity; ITS Pier G 4,250 ft / 14 cranes; PCT Pier J 5,902 ft / 14 cranes; TTI Pier T 5,000 ft / 16 cranes; port-wide 80 berths across 10 piers and 71 post-Panamax gantry cranes. These are the optimiser's hard constraints (`GET /api/terminals`).

**DEMO (labelled `source: "DEMO_AIS"` everywhere it appears):** the 38-vessel queue and the 14-day hourly congestion history shipped in the seed. The dataset is clearly labelled and **replaceable** — `src/scripts/ais/` contains a real, self-contained pipeline (`build-congestion.ts` → `import-series.ts`) that converts a genuine NOAA AccessAIS CSV into the same per-zone hourly series and loads it with `source: "AIS"`. See [`src/scripts/ais/README.md`](src/scripts/ais/README.md).

---

## ⚠️ Known Limitations

> We would rather be honest than overclaim.

- **Demo AIS dataset** — the vessel queue and congestion history are a deterministic, labelled demo seed (`DEMO_AIS`), not real AIS; a real NOAA AccessAIS swap-in pipeline is provided in `src/scripts/ais/`.
- **Anchorage dwell is interval-approximated** in the AIS pipeline (last minus first anchored sighting; a vessel counts toward every hour between them — no interpolation across AIS gaps).
- **Anchorage rectangles are documented approximations**, not official chart polygons.
- **13 berths modelled, not 80** — the optimiser constrains the four POLB container terminals (13 working berths / 62 cranes after the published split), not the full port-wide estate.
- **Heuristic optimiser** — greedy selection + sequencing + pairwise berth-swap local search, not an exact MILP; it always reports the FIFO baseline and its own deltas.
- **Deliberately oversubscribed crisis scenario (~3×)** — the optimiser maximises throughput and priority-weighted fairness rather than raw average wait; vessels beyond the horizon are deferred and shown honestly as divert candidates.
- **In-memory caching only** (60 s context TTL, forecast cache keyed by model time) — single process, no external cache.
- **Bob's LLM mode needs the backend SDK** — otherwise it answers in deterministic mode from the same engine output (clearly marked in the UI).
- **Static vessel schedule** — ETAs are fixed at seed/run time; no live feed integration.

---

## 🏅 What We're Most Proud Of

The **forecasting engine is a real trained model**, not a lookup table: a schedule-aware ridge regression rolled out recursively with ETS-style damping, validated on a 48-hour holdout plus 12 multi-origin rollouts (R² ≈ 0.90, MAE₇₂ ≈ 5 index points, **+83% skill vs persistence**), with per-horizon error diagnostics rendered in the UI. Equally, **Bob is load-bearing rather than cosmetic** — every answer is produced by actually running the forecast / optimiser / routing / plan engines and is auditable through the tool-call metadata, with a deterministic fallback built from the same engine output. Every number in the app is engine-computed and traceable back to a documented constant.

---

## 📚 Documentation index

- [`docs/problem-statement.md`](docs/problem-statement.md) — the problem, the 2021 evidence, the exact scope
- [`docs/solution-overview.md`](docs/solution-overview.md) — the 4 modules + Bob, algorithms, constants with sources
- [`docs/architecture.md`](docs/architecture.md) — Mermaid flow, component table, data flow, API table, Bob flow
- [`docs/setup-guide.md`](docs/setup-guide.md) — tested setup, env vars, reseeding, real-AIS swap, troubleshooting
- [`src/README.md`](src/README.md) — annotated source map
- [`docs/development.md`](docs/development.md) — developer workflow and PR checklist
- [`src/scripts/ais/README.md`](src/scripts/ais/README.md) — real AIS → congestion-series pipeline
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev workflow and PR checklist
