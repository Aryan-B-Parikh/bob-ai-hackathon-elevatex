"""IBM Bob stream-json parser — pure unit tests (no network, no credits)."""

from __future__ import annotations

from app.services.bob_agent import parse_stream

# Shape captured from a real `bob run --format stream-json` session.
STREAM = "\n".join([
    '{"type":"message","role":"user","content":"call the tool"}',
    '{"type":"tool_use","tool_name":"mcp__portflow__rank_hotspots","parameters":{}}',
    '{"type":"tool_result","tool_id":"x","status":"success","output":"{\\"ranked\\":[]}"}',
    '{"type":"message","role":"assistant","content":"**Zone:** "}',
    '{"type":"message","role":"assistant","content":"`Z-LBCT`"}',
    '{"type":"message","role":"assistant","content":"\\n**Risk:** 38.0"}',
    '{"type":"result","status":"success","stats":{"tool_calls":1,"session_costs":0.0542}}',
])

JSON_FORMAT = '{"type":"result","status":"success","stats":{"tool_calls":0,"session_costs":0.02},"last_message":"PORTPULSE-OK"}'


def test_accumulates_assistant_deltas_and_tool_names():
    r = parse_stream(STREAM)
    assert r["status"] == "success"
    assert r["text"] == "**Zone:** `Z-LBCT`\n**Risk:** 38.0"      # user message excluded
    assert r["actions"] == ["mcp__portflow__rank_hotspots"]
    assert r["tool_calls"] == 1
    assert round(r["cost"], 4) == 0.0542


def test_last_message_wins_when_present():
    r = parse_stream(JSON_FORMAT)
    assert r["text"] == "PORTPULSE-OK"
    assert r["actions"] == []


def test_garbage_and_partial_lines_are_ignored():
    r = parse_stream("not json\n{broken\n" + STREAM)
    assert r["text"].startswith("**Zone:**")
    assert parse_stream("")["text"] == ""


def test_failed_status_is_reported():
    r = parse_stream('{"type":"result","status":"error","stats":{"tool_calls":0,"session_costs":0}}')
    assert r["status"] == "error"
    assert r["text"] == ""
