"""LLM provider resolution — pure logic, no network, no DB."""

from __future__ import annotations

from app.services.llm import _resolve


def test_auto_prefers_bob_then_claude_then_deterministic():
    assert _resolve("auto", True, True) == "bob"
    assert _resolve("auto", True, False) == "bob"
    assert _resolve("auto", False, True) == "claude"
    assert _resolve("auto", False, False) == "deterministic"


def test_explicit_provider_wins():
    assert _resolve("claude", True, True) == "claude"
    assert _resolve("deterministic", True, True) == "deterministic"
    assert _resolve("bob", False, False) == "bob"
