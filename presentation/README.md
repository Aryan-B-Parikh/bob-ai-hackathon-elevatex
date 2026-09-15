# presentation/ — Submission deck

`slides.pdf` (9 slides, 1280×720 landscape, vector text + embedded dashboard screenshots) is the submission deck. It is generated from `slides.html`; `preview.png` is a 3×3 contact sheet of all nine slides.

Fonts are self-hosted in `presentation/fonts/` (Inter 300–900 + JetBrains Mono 400–700) so the deck renders without network access.

Live-demo material comes from the running dashboard — screenshots in `demo/screenshots/`, recording script in `demo/demo-video-script.md`, link in `demo/demo-video-link.txt`.

## Slide outline

1. **Problem** — San Pedro Bay, 2021: 100+ ships offshore for weeks, Marine Exchange queue peaking at ~109 vessels, $10B+ supply-chain impact; berth/crane planning done manually in spreadsheets; hotspots discovered reactively; routing decided too late. The exact 4-item challenge scope.
2. **Data** — REAL: Port of Long Beach terminal fact sheets (LBCT Pier E 4,200 ft / 3 deepsea berths / 18 STS cranes, 3.5M+ TEU; ITS Pier G 4,250 ft / 14; PCT Pier J 5,902 ft / 14; TTI Pier T 5,000 ft / 16; port-wide 80 berths / 10 piers / 71 post-Panamax cranes). AIS pipeline auto-runs on startup: `pipelines/ais_generate.py` generates NOAA AccessAIS-format CSV → loaded as `source="AIS"`; real CSV drop-in via `pipelines/ais.py`.
3. **Model** — schedule-aware ridge regression (14 features incl. ETA arrival pressure + berth load factor, λ = 3.0), 72 h recursive rollout with damped recursion (δ = 0.75), 48 h holdout + 12 multi-origin rollouts → 80% bands; results: R² ≈ 0.90, MAE₇₂ ≈ 5 index pts, +83% skill vs persistence (screenshot: Forecast tab).
4. **Optimiser** — FIFO baseline vs 3-phase priority-selection / ready-time-sequencing / swap + gap-insertion; real POLB constraints; 28 moves/crane-hour service model; honest crisis trade-off (maximise throughput + priority-weighted fairness, deferred vessels visible); measured deltas vs FIFO (screenshot: Berth & Cranes tab).
5. **Routing** — DIVERT / SLOW_STEAM / PRIORITY_WINDOW / HOLD on forecast waits; $32k/day cost model; alt-port table (Oakland 500 nm/33 h, Seattle-Tacoma 1,180 nm/79 h, Prince Rupert 1,260 nm/84 h, Ensenada 150 nm/10 h); reefer $180/unit risk logic (screenshot: Routing tab).
6. **Plan** — 12 × 6 h shifts: arrivals, berthings, crane deployment per terminal, congestion alerts (WATCH/WARN/CRIT), decide-by deadlines, supervisor checklist + printable text (screenshot: 72-Hr Plan tab).
7. **Bob** — load-bearing integration: intent detection → real engine calls via the pipeline → strictly grounded prompt (engine JSON only) → LLM (z-ai-web-dev-sdk, backend) → actions metadata shown in the UI → deterministic engine-derived fallback (screenshot: Bob AI tab with actions row).
8. **Impact** — what an operator gains: 72 h warning instead of reactive discovery; optimised berths/cranes vs FIFO with measured deltas; divert/slow-steam economics before the last leg; one fused handover plan; every number auditable back to an engine.
9. **Demo** — 3–5 min real run: cold start per `docs/setup-guide.md` → Overview → Forecast → Run optimiser → Routing → Regenerate plan → ask Bob; honest limitations slide (AIS-generated dataset, CP-SAT exact solver, 13-berth subset of POLB).
