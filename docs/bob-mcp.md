# IBM Bob integration — MCP server

PortFlow SBX exposes its engines to **IBM Bob** through a **Model Context Protocol (MCP)** server
(`src/backend/app/mcp_server.py`). This is the pattern in the hackathon template guide
(`IBM Bob CLI → MCP call → Your MCP Server`): **Bob is the client; our engines are the tools.**

When Bob is registered, a prompt like *"what's the congestion outlook for the next 72 hours?"* makes Bob
call `forecast_congestion` / `rank_hotspots`, and *"optimise the berths and cranes"* makes Bob call
`optimise_berth_cranes` — i.e. Bob actually runs LightGBM / OR-Tools CP-SAT / routing / the plan
generator. Nothing is mocked or hard-coded; each tool returns engine-computed numbers.

The dashboard's **Bob AI** tab uses the *same* service (`app/services/bob.py`), so what you see in the app
is exactly what Bob sees.

## 1. Run the server

```bash
cd src/backend
uv sync --python 3.11

# stdio (what CLI MCP clients register)
uv run python -m app.mcp_server

# streamable HTTP (for a remote client)
uv run python -m app.mcp_server --http 8765      # → http://127.0.0.1:8765/mcp
```

## 2. Register with IBM Bob

Add this to Bob's MCP configuration (or `bob mcp add portflow …`), replacing the path with your clone:

```json
{
  "mcpServers": {
    "portflow": {
      "command": "uv",
      "args": ["run", "--directory", "<ABSOLUTE-PATH-TO-REPO>/src/backend", "python", "-m", "app.mcp_server"]
    }
  }
}
```

A ready-to-edit copy lives at [`src/backend/bob-mcp.config.json`](../../src/backend/bob-mcp.config.json).
Once registered, Bob discovers the tools listed below automatically.

## 3. Tools Bob can call

| Tool | What it runs | Returns |
|---|---|---|
| `get_port_overview` | forecast + hotspot + anomaly + CP-SAT | KPIs, zone status, alerts, hotspots, anomalies |
| `forecast_congestion(zone)` | LightGBM (+ quantile bands) | 72h index/queue/wait/yard, bands, model card, validation |
| `rank_hotspots` | risk scorer | ranked hotspots + **binding resource** + confidence |
| `detect_anomalies` | Isolation Forest | bunching / outage / yard / data-error flags |
| `optimise_berth_cranes(crane_factor, move_rate_per_crane_hour)` | **OR-Tools CP-SAT** | schedule, metrics, FIFO baseline, deltas, weights |
| `recommend_routing` | routing rule engine | divert / slow-steam / priority / hold + savings |
| `generate_operations_plan(include_text)` | plan generator | 12 × 6h shifts (+ printable text) |
| `simulate_scenario(crane_factor, move_rate_per_crane_hour)` | CP-SAT ×2 | baseline vs scenario impact |
| `query_vessels(status)` | DB + assignments | vessel queue with current assignment |
| `get_terminals` | reference + live state | REAL POLB capacity + crane/yard/gate state |
| `ask_operations_question(question)` | Bob brain | grounded answer + tools executed + mode |

## 4. Resources Bob can read

| URI | Content |
|---|---|
| `portflow://overview` | live KPIs / zones / hotspots / anomalies (JSON) |
| `portflow://terminals` | terminal capacity + live state (JSON) |
| `portflow://plan` | printable 72h plan (text) |
| `portflow://forecast/{zone}` | per-zone 72h forecast (JSON) |

## 5. Prompts Bob can use

| Prompt | Purpose |
|---|---|
| `shift_handover_briefing` | build a supervisor hand-over briefing from the 72h plan |
| `diversion_decision(vessel)` | walk the divert / slow-steam / hold trade-off for a vessel |

## 6. Verify

```bash
# tools listed and callable end-to-end (no Bob needed)
cd src/backend && uv run python - <<'PY'
import asyncio, json
from app.mcp_server import mcp
async def main():
    print([t.name for t in await mcp.list_tools()])
    r = await mcp.call_tool("rank_hotspots", {})
    d = r.structuredContent or json.loads(r.content[0].text)
    print([(h["zone_code"], h["risk_score"], h["binding_constraint"]) for h in d["ranked"]])
asyncio.run(main())
PY
```

Expected: 11 tools listed, then e.g. `[('Z-LBCT', 38.0, 'CRANE'), ('Z-PCT', 32.3, 'CRANE'), …]`.

## 7. Notes

- **LLM phrasing.** `ask_operations_question` uses Claude (Anthropic) when `ANTHROPIC_API_KEY` is set;
  otherwise it answers deterministically from the same engine output. Bob supplies its own LLM, so the
  other tools return raw engine JSON for Bob to phrase.
- **Side-effect free.** MCP tools are read-only — they run the engines but do not write runs to the
  database (the REST API does, when you want persistence).
- **Requires the database.** Run `uv run python -m app.seed` once first (see
  [`docs/setup-guide.md`](setup-guide.md)).
