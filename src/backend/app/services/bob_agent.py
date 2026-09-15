"""IBM Bob provider — the app delegates to the REAL Bob agent.

Bob is load-bearing: the agent receives the operational question, discovers the
PortFlow SBX MCP server, calls engine tools, and writes the final answer from the
returned structured data. The local deterministic path is only a failure mode.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile

from ..config import get_settings

NO_BOB_ENV = "PORTFLOW_NO_BOB_AGENT"

BOB_OPERATIONAL_RULES = """You are the IBM Bob operations agent for PortPulse AI.
This is a live decision-support application, not a generic chatbot.

Rules:
1. For every operational question, use the PortFlow SBX MCP tools before answering.
2. Never invent or estimate a number when a tool can return it.
3. For a forecast question use forecast_congestion and, when useful, rank_hotspots/detect_anomalies.
4. For berth/crane questions use optimise_berth_cranes and compare its CP-SAT result with FIFO.
5. For what-if questions use simulate_scenario with the requested disruption/productivity change.
6. For routing questions use recommend_routing and query_vessels when a vessel is named.
7. For a 72-hour operating recommendation use generate_operations_plan and get_port_overview.
8. Explain the causal chain: observed data -> model/constraint -> decision -> expected impact.
9. State dataset provenance when relevant: AIS means imported NOAA AccessAIS; DEMO_AIS means synthetic demo data.
10. If a tool fails or data is unavailable, say so explicitly. Do not fabricate a replacement.
11. Prefer a small number of targeted tool calls and synthesize their results into one operational answer.
"""


def disabled() -> bool:
    return os.environ.get(NO_BOB_ENV) == "1"


def _cli_path() -> str | None:
    s = get_settings()
    return shutil.which(s.bob_cli) or shutil.which(f"{s.bob_cli}.cmd") or shutil.which(f"{s.bob_cli}.exe")


def available() -> bool:
    return bool(get_settings().bob_api_key) and _cli_path() is not None and not disabled()


def parse_stream(stdout: str) -> dict:
    text, chunks, actions, tool_calls, status, cost = "", [], [], 0, None, 0.0
    for line in (stdout or "").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = event.get("type")
        if kind == "tool_use" and event.get("tool_name"):
            actions.append(event["tool_name"])
        elif kind == "message" and event.get("role") == "assistant":
            content = event.get("content")
            if isinstance(content, str): chunks.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text" and block.get("text"): chunks.append(str(block["text"]))
        elif kind == "assistant":
            content = event.get("content") or event.get("text") or ""
            if isinstance(content, str) and content.strip(): text = content.strip()
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text" and block.get("text"): text = str(block["text"]).strip()
        elif kind == "result":
            status = event.get("status")
            stats = event.get("stats") or {}
            tool_calls = int(stats.get("tool_calls") or 0)
            cost = float(stats.get("session_costs") or 0.0)
            if event.get("last_message"): text = str(event["last_message"]).strip()
    if not text and chunks: text = "".join(chunks).strip()
    return {"text": text, "actions": actions, "tool_calls": tool_calls, "status": status, "cost": cost}


def run(prompt: str, *, max_turns: int | None = None, timeout: int | None = None, retries: int = 1) -> dict:
    last: dict = {}
    for _ in range(max(1, retries + 1)):
        last = _run_once(prompt, max_turns=max_turns, timeout=timeout)
        if last["ok"]: return last
    return last


def _run_once(prompt: str, *, max_turns: int | None = None, timeout: int | None = None) -> dict:
    s = get_settings(); cli = _cli_path()
    if not s.bob_api_key or cli is None:
        return {"ok": False, "text": "", "actions": [], "tool_calls": 0, "status": None, "error": "bob unavailable", "cost": 0.0}
    env = {**os.environ, "BOB_API_KEY": s.bob_api_key, NO_BOB_ENV: "1"}
    if s.bob_team_id: env["BOB_TEAM_ID"] = s.bob_team_id
    instruction = f"{BOB_OPERATIONAL_RULES}\n\nUSER REQUEST:\n{prompt}"
    argv = [cli, "run", "--trust", "--max-turns", str(max_turns or s.bob_max_turns), "--format", "stream-json", instruction]
    try:
        proc = subprocess.run(argv, capture_output=True, env=env, text=True, encoding="utf-8", errors="replace", cwd=tempfile.gettempdir(), timeout=timeout or s.bob_timeout_s)
    except subprocess.TimeoutExpired:
        return {"ok": False, "text": "", "actions": [], "tool_calls": 0, "status": "timeout", "error": "bob timeout", "cost": 0.0}
    except OSError as exc:
        return {"ok": False, "text": "", "actions": [], "tool_calls": 0, "status": "error", "error": str(exc), "cost": 0.0}
    parsed = parse_stream(proc.stdout or "")
    ok = parsed["status"] == "success" and bool(parsed["text"])
    if not ok:
        try:
            with open(os.path.join(tempfile.gettempdir(), "portflow-bob-last.jsonl"), "w", encoding="utf-8") as fh:
                fh.write(proc.stdout or "")
                if proc.stderr: fh.write("\n---STDERR---\n" + proc.stderr)
        except OSError: pass
    return {**parsed, "ok": ok, "error": None if ok else (proc.stderr or "")[-300:]}
