"""LLM narrative layer — Claude via the Anthropic API.

Per the plan, the LLM is used ONLY to phrase validated engine output; it never
invents schedules, ETAs or capacity numbers. If no API key is configured (or the
call fails) we fall back to a deterministic template built from the same numbers.
"""

from __future__ import annotations

import json

from ..config import get_settings

SYSTEM = (
    "You are the operational-narrative assistant for PortFlow SBX, a San Pedro Bay container-port "
    "congestion and berth/crane optimisation system. You are given VALIDATED numeric output from the "
    "forecasting, optimisation and routing engines. Rewrite it as a concise briefing for a shift "
    "supervisor. STRICT RULES: use ONLY the numbers present in the ENGINE DATA block; never invent "
    "figures, vessels, berths or ETAs; do not add scheduling decisions that are not in the data; if a "
    "value is missing, say it is unavailable. Keep it under 220 words."
)


def is_enabled() -> bool:
    return bool(get_settings().anthropic_api_key)


def _client():
    from anthropic import Anthropic  # imported lazily so the app runs without the dep configured

    s = get_settings()
    return Anthropic(api_key=s.anthropic_api_key), s.anthropic_model


def narrate(text_plan: str, summary: dict) -> tuple[str, str]:
    """Return (narrative, source) where source is 'llm' or 'deterministic'."""
    if not is_enabled():
        return _deterministic(summary), "deterministic"
    try:
        client, model = _client()
        payload = json.dumps({"summary": summary}, default=str)[:4000]
        msg = client.messages.create(
            model=model,
            max_tokens=700,
            system=SYSTEM,
            messages=[{"role": "user", "content":
                       f"ENGINE DATA (72h plan summary):\n{payload}\n\nFull plan text:\n{text_plan[:6000]}\n\n"
                       f"Write the supervisor briefing."}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", "") == "text"]
        text = "\n".join(parts).strip()
        return (text or _deterministic(summary)), ("llm" if text else "deterministic")
    except Exception as exc:  # noqa: BLE001
        print(f"[llm] Claude call failed, using deterministic narrative: {exc}")
        return _deterministic(summary), "deterministic"


def answer(question: str, engine_data: str, history: list[dict] | None = None) -> tuple[str, str]:
    """Grounded Q&A over engine output (Bob). Returns (answer, source)."""
    if not is_enabled():
        return "", "deterministic"
    try:
        client, model = _client()
        msgs = [{"role": m["role"], "content": m["content"]} for m in (history or [])][-6:]
        msgs.append({"role": "user", "content":
                     f"ENGINE DATA:\n{engine_data[:6000]}\n\nQUESTION: {question}\n\n"
                     f"Answer strictly from ENGINE DATA."})
        msg = client.messages.create(model=model, max_tokens=800, system=SYSTEM, messages=msgs)
        parts = [b.text for b in msg.content if getattr(b, "type", "") == "text"]
        text = "\n".join(parts).strip()
        return text, ("llm" if text else "deterministic")
    except Exception as exc:  # noqa: BLE001
        print(f"[llm] Claude call failed: {exc}")
        return "", "deterministic"


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
