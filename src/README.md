# src/ — PortFlow SBX app root & source map

Per the hackathon template, **all project code lives inside `src/`** — which makes
this folder the Next.js app root. Everything needed to build, seed and run the app
is here; run all commands from this folder.

One Next.js 16 (App Router, TypeScript) application: dashboard UI + API route
handlers + the four prediction/optimisation engines + Bob.

```
src/                              # ← app root (run commands from here)
├── app/                          # App Router
│   ├── page.tsx                  # dashboard shell — 6 tabs: Overview, Forecast,
│   │                             #   Berth & Cranes, Routing, 72-Hr Plan, Bob AI
│   ├── layout.tsx                # root layout, fonts, theme
│   ├── providers.tsx             # TanStack Query + next-themes + Sonner providers
│   ├── globals.css               # Tailwind 4 theme tokens
│   └── api/                      # route handlers (all dynamic)
│       ├── overview/route.ts     # GET — live KPIs, zone status, alerts, arrivals
│       ├── forecast/route.ts     # GET ?zone= — 72h forecast + hotspot rank + model card
│       ├── optimise/route.ts     # GET latest run / POST run + persist
│       ├── routing/route.ts      # GET — divert / slow-steam / priority-window recs
│       ├── plan/route.ts         # GET ?text=1 / POST — 72h ops plan (JSON + text)
│       ├── vessels/route.ts      # GET — queue enriched with assignment status
│       ├── export/route.ts       # GET ?type= — CSV exports
│       ├── terminals/route.ts    # GET — REAL POLB capacity table (cited)
│       └── bob/route.ts          # GET history / POST message → engine packs → LLM
├── components/
│   ├── dashboard/                # feature tabs + shared widgets (badges, cards)
│   └── ui/                       # shadcn/ui primitives (button, card, tabs, …)
├── hooks/                        # use-toast, use-mobile
├── lib/
│   ├── engine/                   # ← the prediction/optimisation core
│   │   ├── types.ts              #    shared engine contracts (zones, vessels, outputs)
│   │   ├── context.ts            #    DB → EngineContext (shared t0, 60 s cache)
│   │   ├── forecast.ts           #    ① ridge-regression congestion forecast + hotspot rank
│   │   ├── optimiser.ts          #    ③ FIFO baseline vs 3-phase berth/crane optimiser
│   │   ├── routing.ts            #    ② alternate-routing rule engine ($32k/day cost model)
│   │   ├── plan.ts               #    ④ 72 h plan — 12 × 6 h shifts + checklist + text
│   │   ├── pipeline.ts           #    orchestration: forecast → optimiser → routing → plan
│   │   ├── snapshot.ts           #    fresh-run reuse for read-only views
│   │   └── bob.ts                #    ⑤ Bob: intent → engines → grounded LLM + fallback
│   ├── api.ts                    # typed fetch client for /api/*
│   ├── db.ts                     # Prisma client singleton
│   └── utils.ts                  # cn(), uuid()
├── prisma/
│   ├── schema.prisma             # data model (PostgreSQL via Prisma)
│   └── seed.ts                   # REAL POLB capacities + labelled demo vessels/history
├── scripts/
│   ├── ais/                      # real NOAA AccessAIS → congestion-series pipeline
│   └── debug-optimiser.ts
├── public/                       # static assets
├── .env.example                  # copy to .env (both live in src/)
├── package.json / bun.lock       # dependency manifest + lockfile
├── tsconfig.json / next.config.ts / tailwind.config.ts / eslint.config.mjs
└── components.json               # shadcn/ui config
```

Numbered modules ①–⑤ correspond to the four challenge items plus Bob — the mapping back to the hackathon template (`src/forecasting/` → `src/lib/engine/forecast.ts`, …) is tabled in the root `README.md` and `docs/architecture.md`. Environment template: `.env.example` (`DATABASE_URL` → the local PostgreSQL `portflow_sbx` database). Data lives in PostgreSQL via `prisma/schema.prisma`.
