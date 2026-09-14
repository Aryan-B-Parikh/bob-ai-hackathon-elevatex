# API Contract (frozen — Phase 0)

> **Do not change a path or a response key without the Integrator.** `tests/test_contracts.py` asserts these
> paths and shapes; the frontend (`src/frontend/src/types.ts`, `api.ts`) is typed against them.
> Owners implement the logic behind the frozen stub; they do **not** rename keys.

Base URL: `http://localhost:8000`. All JSON unless noted. `stub: true` marks a Phase-0 placeholder.

## Existing (already implemented)

| Method | Path | Owner | Key response fields |
|---|---|---|---|
| GET | `/health` | Integrator | `{status}` |
| GET | `/api/overview` | Integrator | `{t0, dataset, kpis, zones[], alerts[], hotspots, anomalies[], arrivals_timeline[]}` |
| GET | `/api/forecast?zone=` | W2 | `{t0, dataset_source, summary{}, selected{}, hotspots, anomalies, weather_used, confidence}` |
| GET | `/api/optimise/latest` | W3 | `{run_id, solver, status, objective, solve_ms, assignments[], metrics, baseline, deltas, deferred[], weights, tidal_feasible, incremental}` |
| POST | `/api/optimise` | W3 | as `/latest` + `tidal_feasible`, `incremental` |
| GET | `/api/routing` | W3 | `{recommendations[], counts{}, total_savings_usd, cost_model}` |
| GET | `/api/plan?text=1` | W3 | `{summary{…, confidence_by_bucket{}}, shifts[], text}` |
| POST | `/api/plan` | W3 | as GET + `plan_id`, `narrative`, `narrative_source` |
| GET | `/api/terminals` | W1 | `{terminals[{code,name,pier,berth_length_ft,deepsea_berths,gantry_cranes,capacity_teu_m,zone_code,note,berths[],cranes[],yard_zones[],gate}], source}` |
| GET | `/api/vessels` | W1 | `{vessels[{…, assignment, deferred}]}` |
| GET | `/api/hotspots` | Integrator | `{ranked[], most_actionable, method}` |
| GET | `/api/export?type=` | Integrator | CSV (`assignments\|routing\|vessels\|forecast`) |
| GET/POST | `/api/bob` | Integrator | GET `{messages[]}` · POST `{content, actions[], mode, intent}` |

## New (frozen in Phase 0 — implement behind the flag)

| Method | Path | Owner | Flag | Frozen response shape |
|---|---|---|---|---|
| GET | `/api/quality` | W1 | `FEATURE_QUALITY` | `{terminals:[{code, name, completeness_pct, missing:[]}], rules_version}` |
| GET | `/api/weather?hours=72` | W1 | `FEATURE_WEATHER` | `{points:[{hour, ts, wind_kn, wave_m}], source, hours}` |
| POST | `/api/vessels/upload` | W1 | `FEATURE_UPLOAD` | `{accepted, rejected, errors:[], revisions_created, upload_id, filename}` |
| GET | `/api/anomalies` | W2 | — | `{anomalies:[{zone_code, kind, method, score, is_anomaly, sample_size, detail, features}]}` |
| POST | `/api/scenarios` | W3 | — | `{scenario_id, params, baseline, scenario, impact, weights, solver}` |
| POST | `/api/scenarios/extended` | W3 | `FEATURE_SCENARIOS_EXT` | `{baseline, scenario, impact, feasible, kind, parent_scenario_id}` |
| POST | `/api/scenarios/{id}/rollback` | W3 | `FEATURE_SCENARIOS_EXT` | `{restored, scenario_id}` |

## Shared DB fields added in Phase 0 (see `app/models.py`)

| Table | New |
|---|---|
| `vessel_call` | `voyage_number`, `normalised` (JSONB) |
| `forecast_run` | `data_version`, `feature_flags` (JSONB) |
| `routing_recommendation` | `option_detail` (JSONB) |
| `operations_plan` | `confidence_json` (JSONB) |
| `scenario` | `parent_scenario_id`, `status` |
| **new tables** | `weather_observation`, `terminal_quality`, `tidal_window`, `vessel_schedule_upload` |

## Rules for owners

1. Implement behind your flag; **do not** rename paths or keys.
2. If you need a new key, add it **additively** (never remove/rename) and update this file + `types.ts` in the same PR.
3. Any change to a shared file (`models.py`, `main.py`, `reference.py`, `serialize.py`, `pipeline.py`, `mcp_server.py`) → PR to the Integrator.
4. Run `uv run pytest tests/ -q` before pushing; a contract test failure means a downstream break.
