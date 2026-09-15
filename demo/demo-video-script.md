# Demo video script — PortPulse AI (target 4:30)

Record at 1440×900, browser zoom 100%. Prewarm the application before recording so cached engine requests are fast. Every number shown must come from the running application.

| # | Time | Screen / action | Narration |
|---|---|---|---|
| 1 | 0:00–0:25 | Open Overview | “This is PortPulse AI — a 72-hour decision cockpit for San Pedro Bay. It connects congestion, vessel arrivals, terminal capacity, berth and crane planning, routing and an agentic IBM Bob interface.” |
| 2 | 0:25–0:55 | Overview → Congestion | “The command view shows the current queue, congestion risk and the resource causing the bottleneck. The Congestion view adds the spatial heatmap, terminal markers and terminal-to-vessel drill-down.” |
| 3 | 0:55–1:30 | Forecast → select terminal → uncertainty band → validation | “LightGBM forecasts queue, wait and yard utilisation across 24, 48 and 72 hours with quantile uncertainty. Validation and confidence are visible instead of presenting a single unexplained score.” |
| 4 | 1:30–2:15 | Berths & Cranes → run optimiser → inspect Gantt → FIFO comparison | “Now the prediction becomes an operational decision. OR-Tools CP-SAT assigns berths, start times and cranes under hard physical constraints including berth dimensions, draft, crane reach, overlap and terminal crane-pool capacity. The result is compared with FIFO.” |
| 5 | 2:15–2:45 | Scenario Center → reduce crane availability → apply | “We can stress the plan without changing the base data. A crane-availability scenario re-solves the constrained problem and reports the operational impact against baseline.” |
| 6 | 2:45–3:15 | Routing → open recommendation | “Routing turns forecast congestion into an actionable decision: divert, slow-steam, priority window or hold. Recommendations include sustained-congestion checks, predicted wait and an explicit economic trade-off.” |
| 7 | 3:15–3:45 | 72-Hour Plan → show shifts + provenance | “The plan fuses forecast, risk, optimisation and routing into twelve six-hour shifts. Every plan carries forecast and optimiser run IDs, model version and confidence so the decision is auditable.” |
| 8 | 3:45–4:15 | Bob AI → ask: “What is the biggest congestion risk and what should we do?” → show tool chips | “IBM Bob is load-bearing, not decorative. Through MCP it calls the real PortPulse engines, retrieves the computed forecast, risk or optimisation results, and explains them. Bob does not invent the schedule — CP-SAT creates it.” |
| 9 | 4:15–4:30 | Return to Overview → end card | “PortPulse AI closes the loop: observe, predict, explain risk, optimise, route, plan and act through Bob. Every operational number traces back to an engine.” |

## Shot checklist

- [ ] Backend and PostgreSQL running
- [ ] IBM Bob CLI + MCP server registered for the Bob shot
- [ ] Open-Meteo weather loaded or graceful fallback visible
- [ ] Overview / Congestion / Forecast / Berth / Scenario / Routing / Plan / Bob opened once to warm caches
- [ ] Heatmap and Gantt visible
- [ ] Show at least one FIFO-vs-CP-SAT comparison
- [ ] Show plan provenance
- [ ] Show Bob tool-call metadata
- [ ] Upload the final video and put the hosted URL in `demo/demo-video-link.txt`
