"""IBM Bob (harness) provider — the app delegates to the REAL Bob agent.

Bob is load-bearing in **both** directions:

    Bob (client)      -> our MCP tools -> our engines      (external agent)
    our app (client)  -> Bob agent     -> our MCP tools -> our engines

So the in-app assistant and the 72h plan narrative are not "an LLM wrapper" —
they are IBM Bob, which fetches the numbers from our own MCP server. Bob never
invents figures: the MCP tools return engine-computed JSON.

Recursion guard
---------------
The spawned Bob process inherits ``PORTFLOW_NO_BOB_AGENT=1``; Bob passes its env
to the MCP server child, so ``ask_operations_question`` (inside MCP) will never
re-enter Bob. This breaks the cycle app -> bob -> mcp -> app -> bob.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile

from ..config import get_settings

NO_BOB_ENV = "PORTFLOW_NO_BOB_AGENT"


def disabled() -> bool:
    """True inside a Bob-spawned child (MCP server) — prevents recursion."""
    return os.environ.get(NO_BOB_ENV) == "1"


def _cli_path() -> str | None:
    s = get_settings()
    return shutil.which(s.bob_cli) or shutil.which(f"{s.bob_cli}.cmd") or shutil.which(f"{s.bob_cli}.exe")


def available() -> bool:
    """Bob can be used: API key present, CLI on PATH, and not inside a Bob child."""
    return bool(get_settings().bob_api_key) and _cli_path() is not None and not disabled()


def parse_stream(stdout: str) -> dict:
    """Parse Bob's `--format stream-json` output.

    Bob emits: incremental `message` deltas (role=assistant), `tool_use` events and one
    `result` event. Returns {text, actions, tool_calls, status, cost}.
    """
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
            if isinstance(content, str):
                chunks.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                        chunks.append(str(block["text"]))
        elif kind == "assistant":
            content = event.get("content") or event.get("text") or ""
            if isinstance(content, str) and content.strip():
                text = content.strip()
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                        text = str(block["text"]).strip()
        elif kind == "result":
            status = event.get("status")
            stats = event.get("stats") or {}
            tool_calls = int(stats.get("tool_calls") or 0)
            cost = float(stats.get("session_costs") or 0.0)
            if event.get("last_message"):
                text = str(event["last_message"]).strip()
    if not text and chunks:            # stream-json path: concatenate the deltas
        text = "".join(chunks).strip()
    return {"text": text, "actions": actions, "tool_calls": tool_calls, "status": status, "cost": cost}


def run(prompt: str, *, max_turns: int | None = None, timeout: int | None = None, retries: int = 1) -> dict:
    """Run the Bob agent headlessly (with a retry on transient failure)."""
    last: dict = {}
    for _ in range(max(1, retries + 1)):
        last = _run_once(prompt, max_turns=max_turns, timeout=timeout)
        if last["ok"]:
            return last
    return last


def _run_once(prompt: str, *, max_turns: int | None = None, timeout: int | None = None) -> dict:
    """One Bob CLI invocation; returns {ok, text, actions, tool_calls, status, error, cost}."""
    s = get_settings()
    cli = _cli_path()
    if not s.bob_api_key or cli is None:
        return {"ok": False, "text": "", "actions": [], "tool_calls": 0, "status": None,
                "error": "bob unavailable", "cost": 0.0}

    env = {**os.environ, "BOB_API_KEY": s.bob_api_key, NO_BOB_ENV: "1"}
    if s.bob_team_id:
        env["BOB_TEAM_ID"] = s.bob_team_id
    argv = [cli, "run", "--trust", "--max-turns", str(max_turns or s.bob_max_turns),
            "--format", "stream-json", prompt]

    try:
        proc = subprocess.run(
            argv, capture_output=True, env=env,
            text=True, encoding="utf-8", errors="replace",   # Bob prints UTF-8 (·, emoji); Windows defaults to cp1252
            cwd=tempfile.gettempdir(),          # scratch cwd: Bob cannot touch the repo
            timeout=timeout or s.bob_timeout_s,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "text": "", "actions": [], "tool_calls": 0, "status": "timeout",
                "error": "bob timeout", "cost": 0.0}
    except OSError as exc:
        return {"ok": False, "text": "", "actions": [], "tool_calls": 0, "status": "error",
                "error": str(exc), "cost": 0.0}

    parsed = parse_stream(proc.stdout or "")
    ok = parsed["status"] == "success" and bool(parsed["text"])
    if not ok:  # observability: keep the raw stream for diagnosis
        try:
            with open(os.path.join(tempfile.gettempdir(), "portflow-bob-last.jsonl"),
                      "w", encoding="utf-8") as fh:
                fh.write(proc.stdout or "")
                if proc.stderr:
                    fh.write("\n---STDERR---\n" + proc.stderr)
        except OSError:
            pass
    return {**parsed, "ok": ok,
            "error": None if ok else (proc.stderr or "")[-300:]}
