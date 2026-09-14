# AUDIT — code-based review vs the 3 spec docs

**Date:** after Phase 0. **Method:** real execution + static review (not doc claims).
**Commands run:** PostgreSQL row counts; `load_context`/`run_forecasts`/`run_optimiser`/`build_full` timing;
`pytest` (13 tests); `npm run build`; live `uvicorn` + every `/api/*` route; MCP `list_tools`/`call_tool`;
`bob mcp add-json` + `bob mcp list` + `bob run`.

Artifacts compared against: `1_Problem_Analysis_and_Module_Requirements.md`,
`2_Datasets_and_Data_Sources_Research.md`, `3_Technical_Architecture_and_Build_Plan.md`.

---

## 0. Verdict

| Axis | Result |
|---|---|
| Tech stack vs plan §1 | ✅ **fully aligned** (FastAPI · LightGBM · IsolationForest · OR-Tools CP-SAT · SimPy · PostgreSQL · React/Vite · Claude) |
| Modules A–N (doc 1) | 8 ✅ · 12 🟡 · 2 ❌ (see §5) |
| Data sources (doc 2) | AIS pipeline ✅ · SimPy ✅ · BTS ❌ · weather ❌ · WPI ❌ (replaced by real POLB facts) |
| Engines actually work | ✅ forecast (72 pts + bands) · CP-SAT `FEASIBLE` · routing · 12-shift plan · MCP tools |
| **Blocking correctness bug** | ⚠️ **1 High** — plan provenance is always `null` |
| Performance | ⚠️ cold pipeline ≈ **9 s** (forecast) + **8 s** (CP-SAT); warm ≈ 0.9 s |
| Tests | ✅ 13 passing; frontend builds |
| IBM Bob | ✅ CLI 2.0.2 installed, MCP server **registered**; ⚠️ needs `BOB_API_KEY` |

---

## 1. IBM Bob — status

| Step | Result |
|---|---|
| Bob CLI | ✅ `bob` 2.0.2 (`bobshell@2.0.2`), commands: `chat`, `run`, `mcp`, `acp` |
| Register our MCP server | ✅ `bob mcp add-json -s global portflow '{"command":"uv","args":["run","--directory","<repo>/src/backend","python","-m","app.mcp_server"]}'` → written to `~/.bob/settings/mcp.json` |
| `bob mcp list` | ✅ `portflow: uv run --directory … python -m app.mcp_server \| enabled \| stdio \| global` |
| `bob run "…"` | ❌ **`Error: Bob API key is required. Set BOB_API_KEY`** — needs your IBM Bob key. (I did **not** pass `--accept-license` — that's your call.) |
| MCP server itself | ✅ verified independently: `list_tools` → 11 tools, `call_tool("rank_hotspots")` → live data |

**Action:** `setx BOB_API_KEY "<your key>"` (new shell), then:
`bob run --trust "Call the portflow rank_hotspots tool and report the top hotspot."`

---

## 1b. Fixed during this audit ✅

| Fix | Where |
|---|---|
| **B0 (new, High) — latent crash**: `persist_forecast_run` passed `yard_util=` but the column is `yard_util_pct` → `TypeError` on any **cold-cache + `persist=True`** call (so `POST /api/optimise` and the `/latest` fallback could 500). Hidden while the forecast cache was warm. + regression test added | `services/pipeline.py`, `tests/test_engines.py::test_persist_path_writes_provenance` |
| **B1** plan provenance (`forecast_run_id`/`optimiser_run_id`) now populated, with a latest-run fallback on read paths | `services/pipeline.py` |
| **B4** single-flight locks on the forecast + optimiser caches | `services/pipeline.py` |
| **B5** `bulk_save_objects` → `add_all` | `seed.py` |
| **B6** `utcfromtimestamp` → tz-aware `fromtimestamp` | `services/forecasting.py` |
| **B7** dead constants removed (`DEFER_SLACK_HOURS`, `BIG_THROUGHPUT`) | `services/optimiser.py` |
| **B8** unused `ref` import removed | `services/bob.py` |
| **B11** MCP `source` string fixed | `mcp_server.py` |
| **B12** Anthropic client timeout (20 s, 1 retry) | `services/llm.py` |
| **B14** `GET /api/optimise/latest` no longer writes on a GET | `routers/optimise.py` |

Verified: `uv run pytest` → **14 passed**; provenance now `forecast_run_id=2 / optimiser_run_id=4` on persist and `2 / <latest>` on read.

---

## 2. Correctness bugs

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| **B1** | **High** | **Plan provenance always `null`.** Module K requires the plan to cite the forecast/optimiser run it came from. `run_forecasts()` calls `persist_forecast_run()` but **discards the returned id**, and `_fc_cache` never stores `run_id`. → **✅ FIXED** | `services/pipeline.py` `run_forecasts()` + line ≈256 `forecast_run_id=_fc_cache.get("run_id")`; measured `plan.forecast_run_id = None`, `optimiser_run_id = None` | store the returned id; fall back to `max(ForecastRun.id)` on read paths |
| **B2** | Med | **Unbounded run growth.** Every `build_full(persist=True)` / `POST /api/optimise` writes a new `ForecastRun` **+ 360 `ForecastPoint` rows** (5 zones × 72) and a new `OptimiserRun` + N `Assignment` rows — no dedupe by `(t0, model_version)`. | DB will grow ~360 rows per plan/optimise click | upsert by `(t0, model_version)` or only persist on explicit POST |
| **B3** | Med | **`FEASIBLE`, not `OPTIMAL`.** CP-SAT hits the 8 s cap on the demo instance, so the "exact" solver returns a good-but-unproven solution; `objective` is therefore not optimal. | measured `status=FEASIBLE`, `solve_ms=8025` | add `AddHint` warm-start (W3), trim crane options to `{2,3,4,6,8}`, or raise the cap for batch runs |
| **B4** | Med | **Module-level caches are not thread-safe.** `_fc_cache` / `_opt_cache` are plain globals; FastAPI runs `def` endpoints in a threadpool, so two concurrent requests can duplicate heavy work or interleave writes. | `services/pipeline.py` globals | guard with `threading.Lock` (or per-key `lru_cache`) |
| **B5** | Med | **`bulk_save_objects` is deprecated** in SQLAlchemy 2.0 and removed in 2.1. | `app/seed.py:151` | `db.add_all(objs)` or `insert().values([...])` |
| **B6** | Low | `datetime.utcfromtimestamp` deprecated in Python 3.12 (fine on 3.11, breaks later). | `services/forecasting.py:73` | `datetime.fromtimestamp(ts, tz=timezone.utc)` |
| **B7** | Low | Dead constants: `DEFER_SLACK_HOURS`, `BIG_THROUGHPUT` (no longer used after the deferral/objective rework). | `services/optimiser.py` | delete |
| **B8** | Low | Unused import `ref` in `services/bob.py`; unused `db` param in `scenarios_extended`; `hours` param in `/api/weather` echoed but unused (stub). | grep | clean up |
| **B9** | Low | **Anomaly detector finds nothing** on the shipped data (`VARIANCE`, `is_anomaly=False` for all zones) even though the simulation **injects a PCT crane outage** — thresholds are miscalibrated. | `/api/anomalies` output; `services/anomaly.py` kinds | calibrate `contamination`, and seed the outage into the feature window (W2) |
| **B10** | Low | `binding_constraint` skews to `GATE` (random-walk gate queue from SimPy dominates the normalised pressure) — the "binding resource" story is therefore weak. | `/api/hotspots` → `Z-ITS/Z-TTI = GATE` | normalise gate pressure by lane throughput, or drop gate when its queue is nominal (W2) |
| **B11** | Low | `mcp_server.get_terminals` uses `ref.__doc__` (the whole module docstring) as the `source` string. | `app/mcp_server.py` | use the 1-line citation |
| **B12** | Low | No timeout on the Anthropic client → a hung LLM call blocks the request thread. | `services/llm.py` | `Anthropic(..., timeout=20.0, max_retries=1)` |
| **B13** | Low | `routers/scenarios.py` calls `load_context(db)` + `run_forecasts(...)` **twice** (base + scenario). | `routers/scenarios.py` | reuse one context/forecast |
| **B14** | Low | `GET /api/optimise/latest` falls back to `build_full(persist=True)` — a heavy **write** on a GET, and a second one if the DB is empty. | `routers/optimise.py` | build with `persist=False` |

---

## 3. Performance findings (measured on this machine)

| Operation | Time | Note |
|---|---|---|
| `load_context` (cold / warm) | **107 ms / 18 ms** | 7 queries, small tables — fine |
| `run_forecasts` 5 zones (cold) | **9 185 ms** | 30 LightGBM fits (4 targets + 2 quantiles × 5 zones) + 8 origins × 72 steps × 5 zones |
| `run_forecasts` (cache hit) | **0 ms** | 120 s TTL keyed by `t0` |
| `run_optimiser` CP-SAT (cold) | **8 038 ms** | capped at 8 s → `FEASIBLE` |
| `run_optimiser` (cache hit) | **0 ms** | only cached for read paths (`db=None`) |
| `build_full` cold / warm | **8 929 ms / 939 ms** | warm ≈ anomalies + hotspots + routing + plan |
| Payloads | overview 9.8 KB · forecast 11.6 KB · plan 12.0 KB | acceptable |
| DB rows | 4 terminals · 13 berths · 62 cranes · 16 yard zones · 28 vessels · 1 680 observations | fine |
| Indexes | `congestion_observation`: PK + `uq_obs_zone_hours` + `ix_obs_zone_ts` | sufficient |

**Hot spots / recommendations**
1. **LightGBM retrains from scratch** on every cache miss. Persist the trained booster set keyed by
   `(t0, data_version)` (joblib) → cold 9 s → ~0 s. Reduce `n_estimators` 140→80 and `ROLLOUT_ORIGINS` 8→6.
2. **CP-SAT cold 8 s on every POST.** Add a warm-start hint (W3) and cache the optimiser result for read
   paths (already done) — plus persist so `/latest` need not re-solve.
3. **`/api/export` and `/api/plan` rebuild the whole pipeline**; they should serve the latest persisted
   `OperationsPlan` / `OptimiserRun` when `persist=0`.
4. **`/api/bob` and the MCP `ask_operations_question` call `build_full`** → first Bob question costs ~9 s.
   Reuse the cached pipeline snapshot.
5. **`catalog.terminals` is N+1** (3 queries × 4 terminals = 12). Trivial now; batch if terminals grow.
6. **Concurrency:** two parallel `POST /api/optimise` spawn 2 × CP-SAT (4 workers each) → CPU thrash. Add a
   single-flight lock or a queue.
7. **First request after a cold DB seeds inside the lifespan** (≈10–20 s). Pre-seed in setup, or show a banner.

---

## 4. Security / ops

| # | Sev | Finding |
|---|---|---|
| S1 | Med | **No authentication/authorisation on any endpoint** (incl. `POST /api/vessels/upload`, `POST /api/optimise`). Fine for a local demo — must be stated in Known Limitations. |
| S2 | Low | `src/backend/.env` holds the real DB password — **gitignored ✅**; `.env.example` is masked ✅. |
| S3 | Low | MCP registration lives in `~/.bob/settings/mcp.json` (**outside the repo**) ✅ — nothing secret committed. |
| S4 | Low | `CORS_ORIGINS` limited to `localhost:5173` ✅. |
| S5 | Low | No rate limiting / request size cap on CSV upload (stub reads the whole file into memory). |
| S6 | Info | No `.gitignore` entry needed for `~/.bob`; but add `.bob/` to `.gitignore` in case workspace-scope MCP config is used later. |

---

## 5. Spec compliance matrix

### 5a. Doc 1 — Modules A–N

| Module | Status | Evidence / gap |
|---|---|---|
| A Port & Terminal Profiling | 🟡 | `Terminal/Berth/Crane/YardZone/Gate` modelled (real POLB caps). Missing: labour shifts, rail, version UI. |
| B Vessel Schedule Ingestion | 🟡 | `VesselCall` + `EtaRevision` + declared/AIS ETA + `voyage_number` ✅. CSV upload is a **stub** (`stub:true`). |
| C Berth/Crane/Yard/Gate Capacity | ✅ (synthetic) | SimPy emits live occupancy/yard/gate; `Crane.status` + reason. |
| D Normalisation & Quality | 🟡 | fields exist (`is_measured`, `confidence`, `raw`, `normalised`); **no engine**; `/api/quality` stub. |
| E AIS / Historical KB | 🟡 | `CongestionObservation` + Python AIS pipeline ✅. No tracks/berth-dwell baselines/vintages. |
| F Forecasting | ✅ | LightGBM, 4 targets incl. **yard util**, quantile bands, model version, validation. Gap: weather not wired. |
| G Hotspot / Bottleneck | 🟡 | w1..w5 risk + binding resource ✅; **binding skews to GATE** (B10). |
| H Anomaly / Disruption | 🟡 | IsolationForest ✅; **detects nothing on shipped data** (B9); no weather signal. |
| I Alternate Routing | 🟡 | 4 options + sustained rule + cost model ✅; no in-port terminal/window options. |
| J Berth/Crane Optimiser | ✅ | CP-SAT BAP/QCAP, hard constraints, FIFO baseline, exposed weights. Gaps: tides (W3 flag off), warm-start. |
| K 72h Plan | 🟡 | 12 shifts + text + Claude ✅; **provenance null** (B1); `confidence_by_bucket` stubbed. |
| L Scenario Simulator | 🟡 | crane/productivity ✅; `/api/scenarios/extended` + rollback are **stubs**. |
| M Explainability | 🟡 | rationales, risk explanation, model card, weights exposed ✅; no per-decision "constraint that bound". |
| N Dashboard | 🟡 | 6 tabs, KPI, zone cards, Gantt, plan, Bob ✅; **no heatmap, no drill-down, no scenario-compare** (W4). |

### 5b. Doc 3 §9 acceptance

| # | Item | Status |
|---|---|---|
| 1 | Pipeline loads real AIS + BTS + weather + synthetic ops, no manual steps | 🟡 SimPy ✅ + AIS ✅; **BTS/weather missing** |
| 2 | Forecast point + uncertainty for queue/wait/utilisation | ✅ |
| 3 | Optimiser never violates a hard constraint | ✅ (asserted in tests) |
| 4 | Heatmap + Gantt from live output | 🟡 Gantt ✅, heatmap ❌ |
| 5 | ≥1 scenario vs baseline | ✅ (basic); extended = stub |
| 6 | Plan text from validated numbers, LLM phrasing only | ✅ (deterministic fallback verified) |
| 7 | Demo rehearsed with weather fallback | ❌ no weather |

### 5c. Doc 2 — data sources

| Source | Status |
|---|---|
| NOAA AccessAIS | ✅ pipeline (`app/pipelines/ais.py`, tested) — **not loaded** (ships `DEMO_AIS`) |
| SimPy synthetic ops | ✅ |
| BTS PPFSP | ❌ |
| Open-Meteo weather | ❌ (config only; `/api/weather` stub) |
| World Port Index / Kaggle ports | ➖ replaced by real POLB fact sheet (better, cited) |

---

## 6. Remediation plan (maps to TEAM_PLAN workstreams)

| Priority | Fix | Owner |
|---|---|---|
| P0 | **B1** plan provenance (`run_id`) | **Integrator** |
| P0 | **B2** dedupe `ForecastRun`/`OptimiserRun` writes; serve persisted runs on GET | Integrator |
| P0 | **B4** thread-safe caches (single-flight lock) | Integrator |
| P0 | **B5/B6/B7/B8** deprecations, dead code, unused imports | Integrator |
| P1 | **B3** CP-SAT warm-start + smaller option set | **W3** |
| P1 | **B9/B10** calibration of anomaly kinds + binding pressure | **W2** |
| P1 | **B11/B12** MCP `source` string; Anthropic timeout | Integrator |
| P1 | **B13/B14** scenario reuse; no write on GET | **W3** |
| P2 | **Performance** model persistence (joblib), `n_estimators`/origins trim, single-flight optimise | Integrator + W2 |
| P2 | **S1** document no-auth; cap upload size | **W1** |
| — | D / N / B / weather / BTS / scenarios (feature work) | W1 · W2 · W3 · W4 |

---

## 7. Raw evidence (excerpt)

```
DB: terminal=4 berth=13 crane=62 yard_zone=16 vessel_call=28 congestion_observation=1680
ctx.t0 == DB max(ts) : True      history order oldest->newest : True (336 pts, hours_ago 335..0)
run_forecasts cold   : 9185 ms   →  Z-PORT points=72  model=lgbm-4.7.0-index/queue/wait/yard-15f
run_optimiser cold   : 8038 ms   →  ortools-cp-sat FEASIBLE 8025 ms  serviced 21 vs FIFO 21
build_full cold/warm : 8929 ms / 939 ms
plan.forecast_run_id : None   plan.optimiser_run_id : None   plan.model_version : lgbm-4.7.0-…
payloads             : overview 9.8 KB · forecast 11.6 KB · plan 12.0 KB
pytest               : 13 passed        npm run build : ok
bob mcp list         : portflow enabled stdio global
bob run              : Error: Bob API key is required (BOB_API_KEY)
```
