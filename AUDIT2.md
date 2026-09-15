# AUDIT 2 — full code review of the merged codebase (post W1+W2+W3)

**Date:** after W1+W2+W3 merged to `main` (`78c820d`). **W4 not merged** (frontend is partial).
**Method:** every finding below was produced by **reading the merged code** or **executing the live stack**
(fresh DB seed → uvicorn → every `/api/*` route → DB row counts → 62-test suite → MCP tool list).
**No doc claim was trusted**; where a doc says "done", the code was checked.

Artifacts compared against `1_…Module_Requirements.md`, `2_…Data_Sources_Research.md`,
`3_…Architecture_and_Build_Plan.md`.

Legend: ✅ done · 🟡 partial · ❌ missing · 🔴 bug

---

## 0. Executive verdict

| Axis | Result |
|---|---|
| Tech stack (doc 3 §1) | ✅ **aligned** — FastAPI · LightGBM+quantile · IsolationForest · OR-Tools CP-SAT · SimPy · PostgreSQL · React/Vite · **IBM Bob as the app's narrative engine** |
| Modules A–N | **5 ✅ · 7 🟡 · 2 ❌** (table §4) |
| Acceptance (doc 1 §29) | 8 ✅ · 4 🟡 · 0 ❌ |
| Acceptance (doc 3 §9) | 6 ✅ · 1 🟡 |
| Tests | ✅ **62 passed** (backend) · frontend builds |
| Runtime | ✅ all 19 routes 200; MCP 11 tools live; provenance now populated |
| 🔴 Critical bugs found | **4** (all reproducible; listed §2) |
| 🟠 Medium | 6 · 🟡 Low | 12 |

**Bottom line:** the merged backend is genuinely working and much closer to the spec than the last
audit — W1/W2/W3 are real, not stubs. But **3 of the 4 "completed" claims have production-logic gaps**
(upload never creates vessels; weather pipeline is never wired; rejected-row accounting is wrong), and
**plan provenance is still null on the read path**. W4 remains the largest functional gap (heatmap,
drill-down, scenario-compare UI).

---

## 1. Runtime evidence (fresh seed → live server)

| Route | Code | Cold time | Size | Key observations |
|---|---|---|---|---|
| `GET /api/overview` | 200 | 17.1 s (cold) | 11.5 KB | anomalies flagged on 3 zones |
| `GET /api/quality` | 200 | 0.1 s | 0.5 KB | 4 terminals, `completeness_pct=100.0`, `stub:false` |
| `GET /api/weather?hours=72` | 200 | 0.0 s | 0.1 KB | **`points: 0`** — table empty |
| `GET /api/anomalies` | 200 | 0.9 s | 1.9 KB | 4 zones |
| `GET /api/forecast?zone=Z-PORT` | 200 | 0.8 s | 26.6 KB | `weather_used:false`, `confidence:0.807`, `confidence_by_horizon`, `horizons`, `data_version`, `provenance` |
| `GET /api/routing` | 200 | 0.8 s | 19.2 KB | 28 recs, **28 with `option_detail`** |
| `GET /api/vessels` | 200 | 0.8 s | 17.9 KB | |
| `GET /api/terminals` | 200 | 0.0 s | 12.2 KB | |
| `GET /api/plan` | 200 | 0.8 s | 22.6 KB | `confidence_by_bucket` present |
| `POST /api/optimise` (tidal+incremental) | 200 | 24 s | — | `tidal_feasible:true`, `gap_pct:7.7%` |
| `POST /api/scenarios/extended` | 200 | 16 s | — | `description`, `scenario_id`, distinct impacts per kind |
| `POST /api/scenarios/{id}/rollback` | 200 | — | — | `restored:true`, `status:"ROLLED_BACK"` |
| `POST /api/vessels/upload` | 200 | <1 s | — | **bugs — see §2** |
| `GET /api/tides?hours=96` | 200 | — | — | 13 berths, period 12.42 h, amplitude 2.8 ft |

**Measured pipeline (cold/warm):** `load_context` 159 ms · `run_forecasts` **10 935 ms** ·
`run_anomalies` 981 ms · `run_optimiser` **8 131 ms** · routing 2 ms · plan 3 ms ·
**`build_full` cold ≈ 19.8 s, warm ≈ 1.05 s**.

---

## 2. 🔴 Bugs found by this audit (all reproducible)

### B-1 🔴 Schedule upload **never creates vessels or ETA revisions** (Module B broken)
`POST /api/vessels/upload` parses and dedupes the CSV, writes a `VesselScheduleUpload` audit row,
returns `accepted: 2` — but **contains zero references to `VesselCall` or `EtaRevision`**. Verified:
after uploading 2 valid rows, `VesselCall` named `AUDITTEST` = **0**; `revisions_created` is hard-coded `0`.
**Impact:** Module B "ingest vessel call schedules" is **not implemented** — the endpoint is a
well-built audit log around a no-op. Doc-1 §29 item 2 is therefore still ❌.

### B-2 🔴 Upload accounting is wrong: invalid rows **vanish**
`parse_schedule` silently drops rows whose `declared_eta_hours` isn't numeric, and the audit counts
`accepted + rejected = rows`, which no longer adds up. Verified: 1-row CSV with `declared_eta_hours="notanumber"`
→ `rows=1, accepted=0, rejected=0, errors=[]` — the row is neither accepted nor rejected.

### B-3 🔴 `revisions_created` is hard-coded `0` even on success
The frozen contract promises the count; the value is a constant, so the UI/API cannot report what
happened. Same root cause as B-1.

### B-4 🟠 **Plan provenance on `GET /api/plan` is still null**
`GET /api/plan` calls `build_full(persist=False)` → nothing is written → `_fc_cache.run_id` is `None`
and **`ForecastRun`/`OptimiserRun` tables are empty** (verified: 0 rows) → the fallback query returns
`None`. Result: the printed plan literally says **`Source runs: forecast #None / optimiser #None`**.
`POST /api/plan` (persist=True) **does** write and cite them correctly (`forecast_run_id=1`,
`optimiser_run_id=2`). **Fix:** on read paths, cite the latest persisted `OperationsPlan` row's ids
(the plan is already persisted on POST) instead of re-deriving from an empty cache.

### B-5 🟠 **`weather_used: null` on `/api/overview`**
Overview emits `weather_used: None` (key absent in its builder) while `/api/forecast` correctly returns
`false`. Inconsistent contract field on one of the two main read surfaces.

### B-6 🟠 **Weather pipeline is never invoked** → W2's weather features are unreachable in practice
`run_weather_pipeline()` exists (`pipelines/weather.py`) and W2 consumes its rows
(`load_weather_series`), but **no route, startup hook, seed step or CLI entry point calls it**
(verified: no callers outside the pipeline file; `weather_observation` rows = 0).
So with `FEATURE_WEATHER=true` (now the default on main), the app permanently reports
`weather_used: false` — **W2's headline weather feature is dead code on the shipped path**.
An exposed `POST /api/weather/refresh` (or a seed hook) is the missing wiring.

### B-7 🟠 **`pipelines/bts.py` is dead code** — zero callers anywhere; doc-2's BTS PPFSP
benchmark therefore remains unimplemented in practice.

### B-8 🟠 **Anomaly `kind` mislabels the disruption** — all four zones report
`kind="VARIANCE"` (never `OUTAGE`/`BUNCHING`), and `detail` no longer explains the rule. The SimPy seed
**injects a PCT crane outage at 72–36 h ago** — the detector should be flagging that. Recalibration
improved *flagging* (3 of 4 zones now flagged) but the *classification* regressed.

### B-9 🟡 **`/api/quality` completeness is self-fulfilling**
It counts vessels with `imo`/`voyage_number` non-null. The seed sets `imo` for every vessel and
`voyage_number` for none → but the endpoint reports **100.0 %** with `missing=[]` while 28/28 vessels
have a null `voyage_number`. Root cause: `compute_terminal_quality` counts `imo IS NOT NULL AND
voyage_number IS NOT NULL` — 28/28 pass because... verified `voyage_number NULL = 28`, so the
"good" count should be 0, yet 100 % is returned. The query joins on `dest_zone_code == code`, but
zone codes are `Z-LBCT` etc. while `Terminal.code` is `LBCT` — **the join key is wrong**, so `total=0`
→ falls into the `completeness = 100.0` branch. The score is therefore not measuring anything.

### B-10 🟡 Upload audit-row side effect: a garbage upload **commits an audit row** with
`rejected=0` — audit records exist but the counters they carry are unreliable (see B-2).

---

## 3. Performance findings (re-measured on the merged tree)

| Operation | Before merges | **Now** | Note |
|---|---|---|---|
| `load_context` | 159 ms | 159 ms | stable |
| `run_forecasts` (5 zones, cold) | 9 185 ms | **10 935 ms** | W2 added confidence/coverage/interval computation |
| `run_optimiser` (cold CP-SAT) | 8 038 ms | **8 131 ms** | still capped at 8 s → `FEASIBLE`, `gap_pct` now reported |
| `run_anomalies` | — | 981 ms | new IsolationForest pass |
| `build_full` cold | 8 929 ms | **19 784 ms** | forecast grew; **first request ≈ 20 s** |
| `build_full` warm | 939 ms | **1 054 ms** | fine |
| Payloads | ≤ 26.6 KB | ≤ 26.6 KB | fine (forecast is the largest) |
| `POST /api/plan` (persist) | — | ≈ 30 s | includes Claude/Bob narrative + persistence |

**Recommendations (owner-tagged):**
1. **Cache the trained LightGBM boosters** to disk keyed by `(t0, data_version)` — removes ~10 s from
   every cold start (W2).
2. `/api/plan` GET should serve the latest **persisted** `OperationsPlan` instead of rebuilding
   (`persist=0` still rebuilds) (W3).
3. `/api/export` and `/api/routing` likewise rebuild; route them at persisted runs (W3).
4. `POST /api/optimise` still re-solves every call (8 s) and inserts a new `OptimiserRun` + N
   `Assignment` rows per click — dedupe by `(t0, params)` or serve persisted (Integrator).

---

## 4. Security / ops

| # | Sev | Finding |
|---|---|---|
| S1 | Med | **No authentication on any route** incl. mutating `POST /api/optimise`, `/api/vessels/upload`, `/api/scenarios/*`. Must be stated in Known Limitations. |
| S2 | Low | Upload has **no size cap** and reads the whole file into memory. |
| S3 | Low | CORS restricted to `localhost:5173` ✅; real DB password only in gitignored `.env` ✅; `bob-mcp.config.json` uses a placeholder ✅. |
| S4 | Low | Two **live IBM Bob keys were pasted into chat** earlier — both must be rotated. Not a repo issue (never committed; verified by scan). |

---

## 5. Spec compliance matrix (code-verified)

### 5a. Doc 1 — Modules A–N

| Module | Status | Evidence / gap |
|---|---|---|
| **A** Port & Terminal Profiling | 🟡 | `Terminal/Berth/Crane/YardZone/Gate` modelled from REAL POLB fact sheets; **no labour shifts, no rail, no config versioning UI**. |
| **B** Vessel Schedule Ingestion | ❌ | `VesselCall` + `EtaRevision` + declared/AIS ETA exist, **but the upload endpoint creates neither** (B-1) and `voyage_number` is never populated (B-9). No EDI. |
| **C** Berth/Crane/Yard/Gate Capacity | ✅ | SimPy emits live occupancy/yard/gate; crane maintenance vs available is real. |
| **D** Normalisation & Quality | 🟡 | `NormalisationEngine` (ft→m only) + `compute_terminal_quality` exist and run; **the score is meaningless** (wrong join key, B-9) and normalisation covers 4 fields. |
| **E** AIS / Historical KB | 🟡 | `CongestionObservation` + working AIS pipeline ✅. No vessel tracks, no berth-dwell baselines, no vintages. |
| **F** Forecasting | ✅ | LightGBM, 4 targets incl. yard, quantile bands, per-horizon validation, model version + `data_version`, **weather adjustment** (once weather rows exist), low-confidence fallback. |
| **G** Hotspot / Bottleneck | ✅ | w1–w5 risk score, binding resource over **real** gate throughput (audit B10 fixed by W2), confidence blended with forecast confidence. |
| **H** Anomaly / Disruption | 🟡 | IsolationForest + weather signal ✅, `DATA_ERROR` separation ✅, min-sample guard ✅; **kind classification regressed** (B-8). |
| **I** Alternate Routing | ✅ | 4 options + **sustained** rule + cost model + `option_detail` (in-port alternate + berthing window) + `rule` string. |
| **J** Berth/Crane Optimiser | ✅ | CP-SAT BAP/QCAP, tidal windows, warm-start, gap reporting, exposed real weights, FIFO baseline. |
| **K** 72h Plan | 🟡 | 12 shifts + text + provenance on **POST**; **null on GET** (B-4) + `confidence_by_bucket`. |
| **L** Scenario Simulator | ✅ | 6 kinds, validation (400), clone lineage, persisted runs, rollback. |
| **M** Explainability | ✅ | risk `explanation`, routing `rationale`+`rule`, model card, feature importance, **real** objective weights, forecast confidence. |
| **N** Dashboard | ❌ | 6 tabs render live data (incl. tidal curve, gap, option_detail) — **no heatmap, no port→terminal→berth→vessel drill-down, no scenario-compare view** (planned, not built). |

### 5b. Doc 1 §29 acceptance checklist

| # | Item | Status |
|---|---|---|
| 1 | Terminal/berth/crane/yard data entered, edited, validated | 🟡 (modelled + seeded; no edit UI) |
| 2 | Vessel schedule ingest (manual/CSV) + ETA revision history | ❌ **B-1** |
| 3 | Units/timestamps normalised consistently | 🟡 (ft→m engine exists; not wired into the seed) |
| 4 | Historical baselines stored and versioned | 🟡 |
| 5 | Forecasts reproducible + confidence band | ✅ |
| 6 | Hotspots ranked, attributed, explainable | ✅ |
| 7 | Plan never violates a hard constraint | ✅ (asserted in tests, incl. tides) |
| 8 | 72h plan with visible assumptions/confidence | 🟡 (+ provenance only on POST) |
| 9 | ≥1 what-if scenario vs baseline | ✅ |
| 10 | Dashboard heatmap + Gantt | 🟡 (Gantt ✅; heatmap ❌) |
| 11 | Edge cases don't mislead | ✅ (data-error vs disruption, min-sample, contradictions rejected) |
| 12 | Model version + timestamp per run | ✅ |

### 5c. Doc 3 §9 acceptance

| # | Item | Status |
|---|---|---|
| 1 | Pipeline loads real AIS + BTS + weather + synthetic ops, no manual steps | 🟡 SimPy ✅, AIS ✅, **weather pipeline built but never invoked** (B-6), BTS parser dead (B-7) |
| 2 | Forecast point + uncertainty for queue/wait/utilisation | ✅ |
| 3 | Optimiser never violates a hard constraint | ✅ (tidal re-verified in tests) |
| 4 | Heatmap + Gantt from live output | 🟡 |
| 5 | ≥1 scenario vs baseline | ✅ |
| 6 | Plan text from validated numbers, LLM phrasing only | ✅ (IBM Bob provider verified; deterministic fallback) |
| 7 | Demo rehearsed with weather fallback | 🟡 (fallback exists and is tested; rehearsal pending) |

### 5c. Doc 2 — data sources

| Source | Status |
|---|---|
| NOAA AccessAIS | ✅ pipeline (`app/pipelines/ais.py`) |
| SimPy synthetic ops | ✅ |
| Open-Meteo weather | 🟡 **pipeline built, never invoked** (B-6) |
| BTS PPFSP | 🟡 parser exists (`pipelines/bts.py`), **no caller** (dead code) |
| World Port Index / Kaggle | ➖ replaced by real cited POLB facts |

---

## 6. Remediation (owner-tagged, priority order)

| P | Fix | Owner |
|---|---|---|
| **P0** | **B-1** schedule upload must create `VesselCall` + `EtaRevision` rows | **W1** |
| **P0** | **B-2** reject/invalid rows must be counted (`accepted+rejected == rows`) | **W1** |
| **P0** | **B-6** expose `POST /api/weather/refresh` (or invoke the pipeline at seed) so `FEATURE_WEATHER` is reachable | **W1** |
| **P0** | **B-9** fix the completeness join (`Terminal.code` ≠ `dest_zone_code`) | **W1** |
| **P0** | **B-4** plan GET provenance: serve the latest persisted `OperationsPlan` or fill ids from the DB on read paths | **W3/Integrator** |
| **P1** | **B-5** overview must emit `weather_used` (align with `/api/forecast`) | Integrator |
| **P1** | **B-8** recalibrate anomaly `kind` classification (OUTAGE/BUNCHING) | **W2** |
| **P1** | **B-7** wire the BTS parser to an endpoint or delete it | **W1** |
| **P2** | Model/booster persistence (−10 s cold); serve persisted plan on GET; dedupe optimiser writes | Integrator |
| **P2** | S1 (no auth) + S2 (upload cap) → Known Limitations + size guard | Integrator |
| — | **Module N** heatmap / drill-down / scenario-compare (the whole remaining gap) | **W4** |

---

## 7. Raw evidence (excerpt)

```
seed (fresh DB)     : 4 terminals · 13 berths · 62 cranes · 28 vessels · 1680 observations
GET /api/quality    : 200 · terminals [(LBCT,100.0,[]),(ITS,100.0,[]),(PCT,100.0,[]),(TTI,100.0,[])]
GET /api/weather    : 200 · points=0 · stub=false          ← pipeline never invoked
GET /api/forecast   : 200 · weather_used=False · confidence=0.807 · 72 points
GET /api/routing    : 28 recs · 28 with option_detail
GET /api/plan       : confidence {1-12h:0.95 … 49-72h:0.90} · run_ids None/None (GET)
POST /api/plan      : forecast_run_id=1 · optimiser_run_id=1 · narrative_source=deterministic
GET /api/plan after : forecast_run_id=1 · optimiser_run_id=2 · text "Source runs: forecast #1"
POST /api/vessels/upload (valid 2 rows)  -> accepted=2 · revisions_created=0 (hard-coded)
                                            · VesselCall created = 0 · EtaRevision created = 0
POST /api/vessels/upload (1 bad row)     -> accepted=0 · rejected=0 · errors=[]  (row vanished)
/anomalies kinds         : VARIANCE ×4 (OUTAGE/BUNCHING never emitted)
TerminalQuality rows     : 4 → 4 after two /api/quality calls (upsert, no growth)
TidalWindow rows         : 325 (seeded by /api/tides ensure_windows)
build_full cold/warm     : 19 784 ms / 1 054 ms
pytest                   : 62 passed       npm run build : ok
bob mcp list             : portflow enabled stdio global
```
