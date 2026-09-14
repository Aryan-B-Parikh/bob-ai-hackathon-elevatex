# Solution Overview — PortFlow SBX

Four engines + a load-bearing AI assistant, all sharing one model time `t0` and one PostgreSQL/Prisma context:

```
vessels + POLB capacity + hourly history
        │
        ▼
  ① forecast.ts ──► hotspot ranking ──► ② routing.ts
        │                                     │
        ▼                                     ▼
  ③ optimiser.ts ──────────────────► ④ plan.ts (12 × 6h shifts)
        └───────────────┬───────────────────┘
                        ▼
               pipeline.ts ──► /api/* ──► dashboard
                        │
                        ▼
               ⑤ bob.ts ──► grounded LLM answer (+ deterministic fallback)
```

---

## ① Forecasting & hotspot prediction — `src/lib/engine/forecast.ts`

**What it does:** predicts the congestion index, queue length and average anchorage wait for each of 5 zones (port-wide `Z-PORT` + the four POLB terminal zones `Z-LBCT`, `Z-ITS`, `Z-PCT`, `Z-TTI`) one hour at a time out to **72 hours**, then ranks hotspots by forecast peak.

**Algorithm (real trained model, not a lookup table):**

- **Model:** ridge-regularised least squares (λ = 3.0) fitted by normal equations solved with Gaussian elimination + partial pivoting — implemented from scratch, one model per zone per target (`index`, `queue`, `wait`).
- **Features (14):** current index, 1h delta, index at t−24h, 24h delta, trailing 6h and 24h means, current queue and wait (scaled), hour-of-day sin/cos, day-of-week sin/cos, **arrival pressure over the next 6 h from the vessel ETA schedule** (the "vessel schedules" input required by the problem statement), and a static **berth load factor** (cranes/18 — the "berth capacity" input). Features are standardised (z-score, clipped ±3.5).
- **Forecasting:** recursive 1-step rollout for 72 h — predictions are fed back as lag features. To keep long rollouts stable, each step is ETS-style **damped** toward the trailing 24 h mean with δ = 0.75 (undamped recursion of 1-step models oscillates at long horizons).
- **Validation:** final 48 h held out for 1-step scoring (MAE / MAPE / R²) against a persistence baseline (index held flat); **12 multi-origin recursive rollouts** give per-horizon residual σ → **80 % prediction bands** (±1.2816σ) and MAE₂₄ / MAE₇₂.
- **Historical inflow:** while training, arrival pressure is derived from the queue itself (Δqueue + outflow), where per-zone service outflow ≈ berths/36 vessels per hour (a berth turns a vessel roughly every 36 h).
- **Schedule rule:** only `INBOUND` vessels count as future arrivals (vessels already at anchor are the current queue, not future demand).

**Inputs:** per-zone hourly history (`CongestionReading`), the vessel queue with ETAs (`Vessel`), zone capacity from the real POLB table (`Terminal`/`Berth`).
**Outputs:** 72 hourly points per zone with 80 % bands, current/peak/avg index, hotspot ranking (peak index), natural-language driver attribution (arrival surge / sustained queue pressure / diurnal peak window / service catch-up), and the model card (algorithm, features, training rows, MAE/R²/skill).

**Measured on the shipped demo series (at build time, live numbers in `/api/forecast`):** R² ≈ 0.90 (1-step holdout), MAE₇₂ ≈ 5 index points, **+83 % skill vs persistence**.

---

## ② Alternate routing recommender — `src/lib/engine/routing.ts`

**What it does:** for every vessel, picks one of `DIVERT` / `SLOW_STEAM` / `PRIORITY_WINDOW` / `HOLD` from the *forecast* wait at the vessel's (or assigned) zone, priced through a documented cost model; vessels the optimiser could not slot inside the horizon are treated as ≥ 78 h waits — the prime divert candidates.

**Rules (in priority order):**

| Rule | Trigger | Action & economics |
|---|---|---|
| `DIVERT` | predicted wait ≥ 48 h and a feasible alternate exists | divert cost = extra transit + availability buffer beyond the avoided wait; savings = (waitAvoided/24) × $32k − (shift/24) × $32k × 0.35; confidence 0.82, tier *critical* |
| `SLOW_STEAM` | 18 h ≤ wait < 48 h, vessel inbound | steam down (min(wait−6, 48) h) to arrive as the window opens; ~35 % fuel-burn reduction steaming at ~60 % power (~14 kn); confidence 0.72, tier *high* |
| `PRIORITY_WINDOW` | wait ≥ 10 h and ≥ 200 reefer units aboard | swap windows with a lower-priority call; avoided spoilage risk = reefers × $180 × 0.4; confidence 0.64, tier *medium* |
| `HOLD` | everything else | normal rotation or negative divert economics; confidence 0.55, tier *low* |

**Inputs:** vessels + forecast wait per zone (`pipeline.runRouting` wires forecast points to vessels).
**Outputs:** ranked recommendations (tier → savings) with rationale strings naming the numbers.

---

## ③ Berth & crane assignment optimiser — `src/lib/engine/optimiser.ts`

**What it does:** assigns waiting vessels to real berths and cranes over the 72 h horizon, and reports a **FIFO first-fit baseline** (the industry default) alongside the optimised schedule so every claim is a measured delta.

**Hard constraints — real POLB fact-sheet data:** vessel LOA ≤ berth length, draft ≤ berth depth, cranes ≤ berth's max STS cranes. Terminals (see `GET /api/terminals`): LBCT Pier E 4,200 ft / 3 deepsea berths / 18 STS cranes (3.5M+ TEU/yr); ITS Pier G 4,250 ft / 14; PCT Pier J 5,902 ft / 14; TTI Pier T 5,000 ft / 16 — 13 working berths / 62 cranes after the published split; port-wide POLB: 80 berths, 10 piers, 71 post-Panamax cranes.

**Service-time model:** cranes per vessel = max(2, min(berth max, 8, ⌈total moves / 900⌉)); service hours = moves / (cranes × **28 moves/crane-hour**) + **2 h** mooring/unmooring buffer.

**Objective:** minimise Σ wait × priority weight, where weight = 1 + anchoredHours/48 + reefers/300 (an hour of delay hurts a long-waiting or reefer-loaded vessel more), plus 0.15 × service hours and a **berth-mismatch reservation** (+8 when berth is > 700 ft longer than the vessel — keeps long berths for big ships).

**Three phases:**

1. **WHO** — process vessels in priority order (0.5·anchoredHours + 0.02·LOA + 0.003·moves + 0.02·reefers) to *select* the serviced set under the horizon constraint (end > horizon + 24 h → deferred).
2. **WHEN** — sequence the selected set in ready-time order (the classic wait-minimising rule) with the size-aware berth choice.
3. **POLISH** — pairwise **berth-swap local search** (≤ 3 improvement passes, threshold 0.5) **interleaved with gap-insertion passes** (2 rounds): a swap re-opens an idle gap a deferred feeder can backfill, and vice versa.

**Outputs:** per-assignment schedule (berth, start/end hour, cranes, wait, priority score), deferred list with reasons, metrics (serviced, total/avg/max/weighted wait, berth & crane utilisation clamped to the horizon, total moves), FIFO baseline, and deltas.

**Honest trade-off (important):** the shipped scenario is a **deliberately oversubscribed 2021-style crisis (~3× demand vs capacity)**. In that regime the optimiser *cannot* make the average wait small, so it maximises **throughput (vessels serviced, moves worked)** and **priority-weighted fairness** (weighted wait) instead of raw average wait, and hands the truly unslottable vessels to the routing engine as divert candidates. On the shipped dataset this services ~1 more vessel and works ~10 % more moves than FIFO at equal or better weighted wait — the deltas object always reports exactly what was gained and lost.

---

## ④ 72-hour operations plan — `src/lib/engine/plan.ts`

**What it does:** fuses forecast + assignments + routing into **12 × 6-hour shifts** (structured JSON + a printable text rendering for shift handover).

**Per shift:** physically arriving vessels (inbound ETAs in window), berthing operations starting in the window (berth + cranes), **crane deployment per terminal prorated by overlap**, congestion alerts (peak index in window: `CRIT` ≥ 75, `WARN` ≥ 60, `WATCH` ≥ 45), routing decisions with **decide-by deadlines** (divert by ETA−12 h, slow-steam/priority by ETA−4 h), a dynamic supervisor checklist (VTS confirmations, tugs/line-handlers, reefer staging, contingency triggers) and a yard note when a shift discharges > 9,000 import moves.

**Summary:** total arrivals/berthings/moves, crane-hours, idle berth-hours %, port-wide peak index + zone, risk level (`SEVERE` ≥ 80, `HIGH` ≥ 65, `ELEVATED` ≥ 45, else `LOW`), deferred count, top actions. `GET /api/plan?text=1` returns the text version; `POST /api/plan` regenerates and persists it.

---

## ⑤ Bob — the load-bearing AI ops assistant — `src/lib/engine/bob.ts`

**What it does:** answers natural-language operations questions by **actually running the engines**, then answering strictly from their output.

**Flow:** intent detection (regex router → `plan | optimise | routing | forecast | vessel | status`) → the matching pipeline pack **invokes the real engines** (e.g. `plan` runs forecast → optimiser → routing → plan in order) → the engine JSON becomes an `ENGINE DATA` block in the prompt → `z-ai-web-dev-sdk` LLM (backend-only) answers under strict rules ("use ONLY the numbers in the ENGINE DATA block; never invent figures") → the reply is persisted with `actions` metadata naming every tool called.

**Fallback:** if the engines fail, Bob answers from a KPI snapshot only; if the LLM fails, Bob returns a **deterministic answer built from the same engine output** — both are marked `mode: "deterministic"` in the message metadata so the UI can show exactly what happened. The numbers are engine-computed either way.

**Key constants Bob cites:** $32k/day ship operating cost, 28 moves/crane-hour, the congestion-index definition, and the live peak/wait figures from the packs.

---

## Key constants and where they come from

| Constant | Value | Used by | Source / rationale |
|---|---|---|---|
| STS productivity | 28 moves/crane-hour | optimiser | mid-point of the 25–35 moves/h industry range for modern STS cranes |
| Ship operating cost | $32,000/day | routing, overview KPIs | mid-range of public ~$25k–45k/day estimates for a mid/large container ship (fuel + ops) |
| Reefer spoilage-risk value | $180/unit per event | routing | expected spoilage-risk per reefer unit (documented assumption) |
| Slow-steam fuel saving | ~35 % at ~60 % power (~14 kn) | routing | documented slow-steaming figure |
| Divert deadweight factor | 35 % of operating cost while repositioning | routing | documented assumption: the ship is moving/working, not idle |
| Alt-port table | Oakland 500 nm / 33 h (medium avail., LOA ≤ 1,320 ft); Seattle-Tacoma 1,180 nm / 79 h (low, ≤ 1,320 ft); Prince Rupert 1,260 nm / 84 h (low, ≤ 1,300 ft); Ensenada 150 nm / 10 h (high, ≤ 1,000 ft) | routing | great-circle distances / 15 kn transits; availability = rule-based redirected-capacity buffer (high +6 h, medium +18 h, low +36 h), documented as demo constants |
| Congestion index | `index = clamp(60·(queue/20) + 40·(wait/72), 0, 100)` | everywhere | composite index: 60 % weight on queue size (20 vessels = 60 pts), 40 % on average anchorage wait (72 h = 40 pts); identical formula in seed, forecast engine and AIS pipeline |
| Berth turnaround | ~36 h | forecast inflow | occupancy + buffer; per-zone outflow ≈ berths/36 per hour |
| Berth load factor | cranes / 18 | forecast | 18 = LBCT's STS crane count, the published maximum per terminal |
| Crane sizing | ≥ 2, ≤ 8 per vessel, ⌈moves/900⌉ | optimiser | practical simultaneous-crane cap; ~900 moves per crane-shift at 28/h |
| Mismatch reservation | +8 if berth − LOA > 700 ft | optimiser | keeps long berths available for ULCVs |
| Ridge λ / damping / holdout | 3.0 / 0.75 / 48 h (12 rollout origins, 80 % = ±1.2816σ) | forecast | standard regularisation & ETS damped-trend practice; holdout = final 48 h |
| Alert levels | WATCH ≥ 45, WARN ≥ 60, CRIT ≥ 75; plan risk ELEVATED ≥ 45, HIGH ≥ 65, SEVERE ≥ 80 | plan, overview | documented thresholds |

**Terminal capacity data — real, cited:** Port of Long Beach terminal fact sheets (berth lengths, deepsea berths, STS crane counts, LBCT 3.5M+ TEU annual capacity; port-wide 80 berths / 10 piers / 71 post-Panamax cranes). **AIS data — real pipeline, demo default:** NOAA Office for Coastal Management / AccessAIS (https://marinecadastre.gov/accessais/); see `src/scripts/ais/README.md`.
