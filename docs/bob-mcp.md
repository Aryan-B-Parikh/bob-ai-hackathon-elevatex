# IBM Bob integration — MCP server

**PortPulse AI** exposes its operational engines to **IBM Bob** through a Model Context Protocol (MCP) server (`src/backend/app/mcp_server.py`). Bob is the load-bearing agent; the application does not use a second external LLM provider.

## 1. Two directions

- **Bob → engines:** IBM Bob discovers and calls our MCP tools. The tools execute LightGBM forecasting, Isolation Forest anomaly detection, OR-Tools CP-SAT optimisation, routing and plan generation.
- **App → Bob:** the dashboard's Bob AI surface can invoke the real Bob agent, which uses the same MCP tools.

If Bob is unavailable, the application falls back only to a transparent deterministic briefing generated from engine output. There is **no Claude or other external LLM fallback**.

## 2. Run the server

```bash
cd src/backend
uv sync --python 3.11
uv run python -m app.mcp_server
# or: uv run python -m app.mcp_server --http 8765
```

## 3. Register with IBM Bob

```json
{
  "mcpServers": {
    "portpulse": {
      "command": "uv",
      "args": ["run", "--directory", "<ABSOLUTE-PATH-TO-REPO>/src/backend", "python", "-m", "app.mcp_server"]
    }
  }
}
```

Bob then discovers the operational tools automatically.

## 4. Tools

| Tool | Engine / purpose |
|---|---|
| `get_port_overview` | KPIs, forecasts, hotspots, anomalies and CP-SAT state |
| `forecast_congestion(zone)` | LightGBM 72h forecast + uncertainty |
| `rank_hotspots` | composite risk + binding resource |
| `detect_anomalies` | Isolation Forest disruption flags |
| `optimise_berth_cranes(...)` | OR-Tools CP-SAT BAP/QCAP + FIFO comparison |
| `recommend_routing` | routing decision engine |
| `generate_operations_plan(...)` | 12-shift / 72h plan |
| `simulate_scenario(...)` | baseline vs stress scenario |
| `query_vessels(status)` | vessel queue + assignments |
| `get_terminals` | POLB capacity + live state |
| `ask_operations_question(question)` | grounded operational assistant |

## 5. Architecture principle

```text
Operational data
      ↓
LightGBM + Isolation Forest
      ↓
Risk / hotspot attribution
      ↓
OR-Tools CP-SAT
      ↓
Validated berth + crane schedule
      ↓
Routing + 72h plan
      ↓
IBM Bob via MCP
      ↓
Supervisor-facing explanation
```

**Bob does not create the berth schedule.** The schedule is produced by the constrained optimizer. Bob chooses tools, reasons over their outputs and communicates the result.

## 6. Verification

The MCP server exposes 11 operational tools, four resources and two prompts. Tool calls return engine-computed values; the agent is instructed not to invent operational figures.

```bash
cd src/backend
uv run python -m pytest -q
```

## 7. Deterministic fallback

The deterministic fallback is intentionally retained as an availability/safety mechanism, not as another AI provider. It uses the same engine outputs and cannot create a new schedule or operational number.
