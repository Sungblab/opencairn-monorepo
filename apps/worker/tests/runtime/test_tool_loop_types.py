from __future__ import annotations

from runtime.tool_loop import (
    CallKey,
    LoopConfig,
    LoopState,
    NoopHooks,
    NullBudgetPolicy,
)


def test_loop_config_defaults():
    c = LoopConfig()
    assert c.max_turns == 8
    assert c.max_tool_calls == 12
    assert c.max_total_input_tokens == 200_000
    assert c.per_tool_timeout_sec == 30.0
    assert c.per_tool_timeout_overrides == {"fetch_url": 60.0}
    assert c.loop_detection_threshold == 3
    assert c.loop_detection_stop_threshold == 5
    assert c.mode == "auto"


def test_callkey_equality_via_args_hash():
    a = CallKey(tool_name="search", args_hash="deadbeef")
    b = CallKey(tool_name="search", args_hash="deadbeef")
    c = CallKey(tool_name="search", args_hash="cafebabe")
    assert a == b
    assert a != c
    assert hash(a) == hash(b)


def test_loop_state_tracks_counts():
    s = LoopState(messages=[])
    s.turn_count += 1
    s.tool_call_count += 2
    assert s.turn_count == 1
    assert s.tool_call_count == 2
    assert s.call_history == []


def test_null_budget_never_stops():
    p = NullBudgetPolicy()
    s = LoopState(messages=[])
    s.total_input_tokens = 10**9
    assert p.should_stop(s) is False


async def test_noop_hooks_callable():
    h = NoopHooks()
    s = LoopState(messages=[])
    await h.on_run_start(s)
    await h.on_turn_start(s)
    await h.on_run_end(s)
