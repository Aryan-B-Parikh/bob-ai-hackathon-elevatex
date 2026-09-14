"""PortFlow SBX — MCP server for IBM Bob.

Exposes the engines as Model-Context-Protocol tools so **IBM Bob** (CLI/agent)
can actually RUN them: forecast congestion, rank hotspots, detect anomalies,
solve berth/crane assignment with OR-Tools CP-SAT, recommend routing and
generate the 72-hour plan. Every tool returns engine-computed numbers; Bob
phrases them.

Run (stdio — what CLI clients register):

    uv run python -m app.mcp_server

Run (streamable HTTP, e.g. for a remote Bob client):

    uv run python -m app.mcp_server --http 8765

Register with IBM Bob (add to its MCP config, e.g. `bob mcp add portflow …`):

    {
      "mcpServers": {
        "portflow": {
          "command": "uv",
          "args": ["run", "--directory", "<abs-path>/src/backend", "python", "-m", "app.mcp_server"]
        }
      }
    }
"""

from __future__ import annotations

import argparse
import json

from mcp.server.mcpserver import MCPServer

from . import reference as ref
from .db import SessionLocal
from .serialize import forecast_to_dict, vessel_to_dict
from .services import bob as bob_svc
from .services import pipeline

mcp = MCPServer(
    name="PortFlow SBX",
    version="0.1.0",
    instructions=(
        "San Pedro Bay container-port congestion & berth/crane operations. "
        "Tools return engine-computed numbers only: LightGBM congestion forecasts, a composite "
        "hotspot risk score with the binding resource, Isolation Forest anomaly flags, OR-Tools "
        "CP-SAT berth/crane assignments (BAP/QCAP) with a FIFO baseline, alternate-routing "
        "recommendations and a 72-hour operations plan. Never invent figures — always call a tool. "
        "Terminal capacity is real Port of Long Beach fact-sheet data; the vessel queue and "
        "congestion history are the labelled DEMO_AIS synthetic layer."
    ),
)


# ------------------------------------------------------------------ helpers
def _full(db, persist: bool = False):
    return pipeline.build_full(db, persist=persist)


def _session():
    return SessionLocal()


# ------------------------------------------------------------------ tools
@mcp.tool(description="Live port overview: KPIs, per-zone congestion, alerts, hotspot risk scores and anomaly flags.")
def get_port_overview() -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        return pipeline.build_overview(f["ctx"], f["forecasts"], f["hotspots"], f["anomalies"], f["optimiser"])
    finally:
        db.close()


@mcp.tool(description="72-hour LightGBM congestion forecast for a zone (Z-PORT, Z-LBCT, Z-ITS, Z-PCT, Z-TTI): hourly index/queue/wait/yard-utilisation with 80% quantile bands, model card and per-horizon validation.")
def forecast_congestion(zone: str = "Z-PORT") -> dict:
    if zone not in ref.ALL_ZONES:
        return {"error": f"unknown zone {zone}", "valid_zones": ref.ALL_ZONES}
    db = _session()
    try:
        f = _full(db, persist=False)
        return {"zone": zone, "forecast": forecast_to_dict(f["forecasts"][zone]),
                "summary_all_zones": {z: {"current_index": fc.current["index"], "peak_index": fc.peak["index"],
                                          "peak_hour": fc.peak["hour"]} for z, fc in f["forecasts"].items()}}
    finally:
        db.close()


@mcp.tool(description="Rank congestion hotspots by composite risk score and report the BINDING resource (BERTH / CRANE / YARD / GATE) plus confidence.")
def rank_hotspots() -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        return f["hotspots"]
    finally:
        db.close()


@mcp.tool(description="Isolation-Forest anomaly / disruption detection per zone (bunching, outage, yard saturation, data error).")
def detect_anomalies() -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        return {"anomalies": f["anomalies"], "method": "scikit-learn IsolationForest"}
    finally:
        db.close()


@mcp.tool(description="Solve berth allocation + quay-crane assignment with OR-Tools CP-SAT under hard constraints (berth length/depth, crane reach, no overlap, crane-pool capacity). Returns the schedule, metrics and the FIFO-baseline comparison. Optionally simulate impaired cranes/productivity.")
def optimise_berth_cranes(crane_factor: float = 1.0, move_rate_per_crane_hour: float = 28.0) -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        out = pipeline.run_optimiser(f["ctx"], f["forecasts"],
                                     {"crane_factor": max(0.5, min(1.0, crane_factor)),
                                      "move_rate_per_crane_hour": max(20.0, min(35.0, move_rate_per_crane_hour))})
        return {k: out[k] for k in ("solver", "status", "objective", "solve_ms", "params",
                                    "metrics", "baseline", "deltas", "weights", "assignments", "deferred")}
    finally:
        db.close()


@mcp.tool(description="Recommend alternate routing per vessel (DIVERT / SLOW_STEAM / PRIORITY_WINDOW / HOLD) with estimated savings and the sustained-congestion check.")
def recommend_routing() -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        recs = f["routing"]
        counts: dict[str, int] = {}
        for r in recs:
            counts[r["option"]] = counts.get(r["option"], 0) + 1
        return {"recommendations": recs, "counts": counts,
                "total_savings_usd": sum(r["est_savings_usd"] for r in recs)}
    finally:
        db.close()


@mcp.tool(description="Generate the 72-hour port operations plan (12 x 6-hour shifts: arrivals, berthings, crane deployment, alerts, routing deadlines, checklist). Set include_text=true for the printable version.")
def generate_operations_plan(include_text: bool = False) -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        plan = f["plan"]
        out = {"summary": plan["summary"], "shifts": plan["shifts"]}
        if include_text:
            out["text"] = plan["text"]
        return out
    finally:
        db.close()


@mcp.tool(description="What-if scenario: compare the CP-SAT plan under impaired crane availability / productivity against the baseline (metrics delta).")
def simulate_scenario(crane_factor: float = 0.75, move_rate_per_crane_hour: float = 24.0) -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        base = pipeline.run_optimiser(f["ctx"], f["forecasts"], {})
        scen = pipeline.run_optimiser(f["ctx"], f["forecasts"],
                                      {"crane_factor": max(0.5, min(1.0, crane_factor)),
                                       "move_rate_per_crane_hour": max(20.0, min(35.0, move_rate_per_crane_hour))})
        return {"params": scen["params"], "baseline": base["metrics"], "scenario": scen["metrics"],
                "impact": {"serviced": scen["metrics"]["serviced"] - base["metrics"]["serviced"],
                           "moves": scen["metrics"]["total_moves"] - base["metrics"]["total_moves"],
                           "avg_wait": round(scen["metrics"]["avg_wait_hours"] - base["metrics"]["avg_wait_hours"], 1),
                           "makespan": round(scen["metrics"]["makespan_hours"] - base["metrics"]["makespan_hours"], 1)}}
    finally:
        db.close()


@mcp.tool(description="Query the vessel queue (optionally filter by status: ANCHORAGE | DRIFTING | INBOUND), enriched with the current CP-SAT assignment.")
def query_vessels(status: str | None = None) -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        assignment = {a["vessel_id"]: a for a in f["optimiser"]["assignments"]}
        rows = []
        for v in f["ctx"].vessels:
            if status and v.status.upper() != status.upper():
                continue
            d = vessel_to_dict(v)
            a = assignment.get(v.id)
            d["assignment"] = ({"berth_name": a["berth_name"], "terminal_code": a["terminal_code"],
                                "start_hour": a["start_hour"], "cranes": a["cranes"]} if a else None)
            rows.append(d)
        return {"count": len(rows), "vessels": rows}
    finally:
        db.close()


@mcp.tool(description="Real Port of Long Beach terminal capacity (berths, STS cranes, TEU) with live crane/yard/gate state.")
def get_terminals() -> dict:
    db = _session()
    try:
        f = _full(db, persist=False)
        return {"source": ref.__doc__, "terminals": [
            {"code": t.code, "name": t.name, "pier": t.pier, "berth_length_ft": t.berth_length_ft,
             "deepsea_berths": t.deepsea_berths, "gantry_cranes": t.gantry_cranes,
             "capacity_teu_m": t.capacity_teu_m, "zone_code": t.zone_code, "note": t.note,
             "available_cranes": f["ctx"].cranes.get(t.code),
             "yard_util_pct": f["ctx"].yard_util.get(t.code),
             "gate_queue": f["ctx"].gate_queue.get(t.code)}
            for t in f["ctx"].terminals]}
    finally:
        db.close()


@mcp.tool(description="Ask Bob an operational question in natural language. Runs the engines for the detected intent and answers strictly from their output (Claude phrasing when configured, deterministic fallback otherwise).")
def ask_operations_question(question: str) -> dict:
    db = _session()
    try:
        out = bob_svc.respond(db, question, persist=False)
        return {"answer": out["content"], "intent": out["intent"], "actions": out["actions"], "mode": out["mode"]}
    finally:
        db.close()


# ------------------------------------------------------------------ resources
@mcp.resource("portflow://overview", name="Port overview", mime_type="application/json",
              description="Live KPIs, zone congestion, hotspot risk and anomalies.")
def res_overview() -> str:
    db = _session()
    try:
        f = _full(db, persist=False)
        return json.dumps(pipeline.build_overview(f["ctx"], f["forecasts"], f["hotspots"],
                                                  f["anomalies"], f["optimiser"]), default=str)
    finally:
        db.close()


@mcp.resource("portflow://terminals", name="Terminal capacity", mime_type="application/json",
              description="REAL POLB terminal capacity + live crane/yard/gate state.")
def res_terminals() -> str:
    return json.dumps(get_terminals(), default=str)


@mcp.resource("portflow://plan", name="72h operations plan", mime_type="text/plain",
              description="Printable 72-hour port operations plan.")
def res_plan() -> str:
    db = _session()
    try:
        return _full(db, persist=False)["plan"]["text"]
    finally:
        db.close()


@mcp.resource("portflow://forecast/{zone}", name="Zone forecast", mime_type="application/json",
              description="72h LightGBM forecast for a zone (Z-PORT / Z-LBCT / Z-ITS / Z-PCT / Z-TTI).")
def res_forecast(zone: str) -> str:
    db = _session()
    try:
        f = _full(db, persist=False)
        if zone not in f["forecasts"]:
            return json.dumps({"error": f"unknown zone {zone}", "valid": ref.ALL_ZONES})
        return json.dumps(forecast_to_dict(f["forecasts"][zone]), default=str)
    finally:
        db.close()


# ------------------------------------------------------------------ prompts
@mcp.prompt(description="Shift-handover briefing prompt grounded in the 72h plan.")
def shift_handover_briefing() -> str:
    return (
        "Call generate_operations_plan(include_text=true) and get_port_overview. Then write a shift-handover "
        "briefing for the supervisor: risk level, arriving vessels, berthings with assigned berths/cranes, "
        "binding-resource hotspots with their decide-by actions, and the checklist. Use ONLY the numbers "
        "returned by the tools; state any missing value as unavailable."
    )


@mcp.prompt(description="Diversion decision prompt for a vessel.")
def diversion_decision(vessel: str = "") -> str:
    return (
        f"Call recommend_routing and forecast_congestion for the affected zone"
        + (f" and query_vessels to locate '{vessel}'" if vessel else "")
        + ". Explain the divert / slow-steam / no-action trade-off for that vessel with predicted wait, "
        "estimated savings and confidence. Use only engine numbers."
    )


# ------------------------------------------------------------------ entry point
def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="app.mcp_server", description="PortFlow SBX MCP server (tools for IBM Bob)")
    p.add_argument("--http", nargs="?", const=8765, type=int, default=None,
                   help="serve over streamable HTTP on this port instead of stdio")
    args = p.parse_args(argv)
    if args.http is None:
        mcp.run(transport="stdio")
    else:
        mcp.run(transport="streamable-http", host="127.0.0.1", port=args.http)


if __name__ == "__main__":
    main()
