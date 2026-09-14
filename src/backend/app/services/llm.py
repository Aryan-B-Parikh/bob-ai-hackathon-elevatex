"""Narrative layer — **IBM Bob first**, then Claude, then deterministic.

Provider resolution (``LLM_PROVIDER=auto|bob|claude|deterministic``):
  * ``bob``   — the real IBM Bob agent (``services/bob_agent.py``); Bob fetches the
                numbers itself through our MCP server. Preferred.
  * ``claude``— Anthropic Claude, strictly grounded in an ENGINE DATA block.
  * deterministic — a template over the same engine numbers (always available).

Whatever the provider, the NUMBERS are engine-computed; the LLM only phrases them.
"""

from __future__ import annotations

import json

from ..config import get_settings
from . import bob_agent

SYSTEM = (
    "You are the operational-narrative assistant for PortFlow SBX, a San Pedro Bay container-port "
    "congestion and berth/crane optimisation system. You are given VALIDATED numeric output from the "
    "forecasting, optimisation and routing engines. Rewrite it as a concise briefing for a shift "
    "supervisor. STRICT RULES: use ONLY the numbers present in the ENGINE DATA block; never invent "
    "figures, vessels, berths or ETAs; do not add scheduling decisions that are not in the data; if a "
    "value is missing, say it is unavailable. Keep it under 220 words."
)


# ------------------------------------------------------------------ provider
def _resolve(setting: str, has_bob: bool, has_claude: bool) -> str:
    """Pure resolution rule (unit-testable)."""
    if setting in ("bob", "claude", "deterministic"):
        return setting
    if has_bob:
        return "bob"
    if has_claude:
        return "claude"
    return "deterministic"


def provider() -> str:
    s = get_settings()
    return _resolve(s.llm_provider, bob_agent.available(), bool(s.anthropic_api_key))


def is_enabled() -> bool:
    return provider() != "deterministic"


def _claude_client():
    from anthropic import Anthropic  # lazy: the app runs without the SDK configured

    s = get_settings()
    return Anthropic(api_key=s.anthropic_api_key, timeout=20.0, max_retries=1), s.anthropic_model


def _claude_answer(question: str, engine_data: str, history: list[dict] | None) -> str:
    try:
        client, model = _claude_client()
        msgs = [{"role": m["role"], "content": m["content"]} for m in (history or [])][-6:]
        msgs.append({"role": "user", "content":
                     f"ENGINE DATA:\n{engine_data[:6000]}\n\nQUESTION: {question}\n\n"
                     f"Answer strictly from ENGINE DATA."})
        msg = client.messages.create(model=model, max_tokens=800, system=SYSTEM, messages=msgs)
        return "\n".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # noqa: BLE001
        print(f"[llm] Claude call failed: {exc}")
        return ""


def _claude_narrate(text_plan: str, summary: dict) -> str:
    try:
        client, model = _claude_client()
        payload = json.dumps({"summary": summary}, default=str)[:4000]
        msg = client.messages.create(
            model=model, max_tokens=700, system=SYSTEM,
            messages=[{"role": "user", "content":
                       f"ENGINE DATA (72h plan summary):\n{payload}\n\nFull plan text:\n{text_plan[:6000]}\n\n"
                       f"Write the supervisor briefing."}],
        )
        return "\n".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # noqa: BLE001
        print(f"[llm] Claude call failed: {exc}")
        return ""


# ------------------------------------------------------------------ public API
def answer_meta(question: str, engine_data: str = "", history: list[dict] | None = None) -> dict:
    """Grounded Q&A. Returns {text, provider, actions, tool_calls, cost_usd}."""
    prov = provider()
    if prov == "bob":
        try:
            r = bob_agent.run(question)      # Bob uses the MCP tools to get the data itself
        except Exception as exc:  # noqa: BLE001
            r = {"ok": False, "status": "exception", "error": str(exc), "actions": [], "tool_calls": 0, "cost": 0.0}
        if r["ok"]:
            return {"text": r["text"], "provider": "bob", "actions": r["actions"],
                    "tool_calls": r["tool_calls"], "cost_usd": r["cost"]}
        print(f"[llm] Bob agent failed ({r.get('status')}: {r.get('error')}) — falling back")
    if prov in ("bob", "claude") and get_settings().anthropic_api_key:
        text = _claude_answer(question, engine_data, history)
        if text:
            return {"text": text, "provider": "claude", "actions": [], "tool_calls": 0, "cost_usd": 0.0}
    return {"text": "", "provider": "deterministic", "actions": [], "tool_calls": 0, "cost_usd": 0.0}


def answer(question: str, engine_data: str, history: list[dict] | None = None) -> tuple[str, str]:
    """Back-compat wrapper → (text, provider)."""
    meta = answer_meta(question, engine_data, history)
    return meta["text"], meta["provider"]


def narrate_meta(text_plan: str, summary: dict) -> dict:
    """72h plan briefing. Returns {text, provider, actions, tool_calls, cost_usd}."""
    prov = provider()
    if prov == "bob":
        prompt = (
            "Rewrite the following validated 72-hour port operations plan as a concise shift-supervisor "
            "briefing (max 220 words). Use ONLY the numbers present; never invent figures.\n\n"
            f"PLAN:\n{text_plan[:6000]}"
        )
        try:
            r = bob_agent.run(prompt, max_turns=1)
        except Exception as exc:  # noqa: BLE001
            r = {"ok": False, "status": "exception", "error": str(exc), "actions": [], "tool_calls": 0, "cost": 0.0}
        if r["ok"]:
            return {"text": r["text"], "provider": "bob", "actions": r["actions"],
                    "tool_calls": r["tool_calls"], "cost_usd": r["cost"]}
        print(f"[llm] Bob narrate failed ({r.get('status')}) — falling back")
    if prov in ("bob", "claude") and get_settings().anthropic_api_key:
        text = _claude_narrate(text_plan, summary)
        if text:
            return {"text": text, "provider": "claude", "actions": [], "tool_calls": 0, "cost_usd": 0.0}
    return {"text": _deterministic(summary), "provider": "deterministic", "actions": [],
            "tool_calls": 0, "cost_usd": 0.0}


def narrate(text_plan: str, summary: dict) -> tuple[str, str]:
    """Back-compat wrapper → (text, provider)."""
    meta = narrate_meta(text_plan, summary)
    return meta["text"], meta["provider"]


def _deterministic(summary: dict) -> str:
    return (
        f"SHIFT BRIEFING — risk {summary['risk_level']}. "
        f"{summary['total_arrivals']} arrivals and {summary['total_berthings']} berthings across 12 shifts; "
        f"{summary['total_moves']:,} moves and {summary['crane_hours']:,} crane-hours planned. "
        f"Port-wide peak index {summary['peak_index']} ({summary['peak_zone']}); "
        f"{summary['deferred_count']} vessel(s) deferred to the routing engine; "
        f"idle berth-hours {summary['idle_berth_hours_pct']}%. "
        + " ".join(summary.get("top_actions", [])[:2])
    )
