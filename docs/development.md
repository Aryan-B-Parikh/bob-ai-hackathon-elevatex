# Developing PortFlow SBX

Developer workflow for the project. (The root [`CONTRIBUTING.md`](../CONTRIBUTING.md) is the hackathon **submission** guide; this file is the **code** contribution guide.)

The complete application lives in `src/` (the app root) — run all commands below from that folder.

## Setup

```bash
# one-time: create the database, then copy the env template
createdb -U postgres portflow_sbx
cp .env.example .env        # src/.env — PostgreSQL connection string

bun install
bun run db:push
bun run db:seed
bun run dev
```

Full tested instructions: [`setup-guide.md`](setup-guide.md).

## Daily commands

| Command | Purpose |
|---|---|
| `bun run dev` | Dev server on port 3000 |
| `bun run lint` | ESLint — must pass before any PR |
| `bun run db:push` | Apply `prisma/schema.prisma` to PostgreSQL |
| `bun run db:seed` | Wipe + reseed the labelled demo dataset (deterministic) |
| `bun scripts/ais/build-congestion.ts <ais.csv> <out.csv>` | Real AIS → congestion series |
| `bun scripts/ais/import-series.ts <series.csv>` | Load a series into the DB (`source="AIS"`) |

## Where things live

- Engines: `src/lib/engine/` — `forecast.ts`, `optimiser.ts`, `routing.ts`, `plan.ts`, `pipeline.ts`, `bob.ts`, `context.ts`, `snapshot.ts`, `types.ts`
- APIs: `src/app/api/` — overview, forecast, optimise, routing, plan, vessels, terminals, export, bob
- UI: `src/app/page.tsx` (6-tab shell) + `src/components/dashboard/`
- Docs: `docs/*.md` — update them whenever behaviour or constants change

## PR checklist (map to the master guide before opening)

- [ ] Does the change map to a challenge item (predict hotspots / alternate routing / optimise berths & cranes / 72-hour plan) or to required submission infrastructure? No scope creep (no customs, pricing, carbon tracking).
- [ ] Template files/folders intact: `submission.yaml`, `README.md`, `docs/`, `demo/`, `presentation/`, `CONTRIBUTING.md` — nothing renamed, deleted or reordered.
- [ ] `.github/workflows/validate.yml` untouched; `.gitignore` still excludes `.env`, `node_modules/`, build artifacts — never commit those.
- [ ] `bun run lint` passes; no TypeScript errors.
- [ ] No unfilled template/placeholder text left anywhere in README or docs (search the diff for leftover markers).
- [ ] Data honesty preserved: terminal capacities stay the cited REAL POLB fact-sheet figures; anything demo stays labelled `DEMO_AIS`; anything real cites its source (NOAA AccessAIS / POLB fact sheets).
- [ ] Numbers in docs match the code (constants like 28 moves/crane-hour, $32k/day, the congestion-index formula are defined in the engine files — change them in one place only).
- [ ] If it breaks something: disclose it in "Known Limitations" (root README) rather than hiding it.
- [ ] Screenshots/demo video claims match reality — never mock output.
