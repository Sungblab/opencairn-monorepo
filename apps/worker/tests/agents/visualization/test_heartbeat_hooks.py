"""Plan 5 KG Phase 2 — HeartbeatLoopHooks unit tests.

Post-merge review (gemini-code-assist) follow-up: heartbeats are lossy —
Temporal only persists the *latest* heartbeat call's details. The hook
must accumulate event history and re-send the full list on every call
so fast tool windows (cache hits, sub-poll-interval completions) don't
overwrite tool_use entries before the API poller (250 ms) sees them.
"""
from unittest.mock import MagicMock, patch

import pytest

from worker.agents.visualization.heartbeat_hooks import (
    HeartbeatLoopHooks,
)


def _state(turn=0, tool_calls=0):
    s = MagicMock()
    s.turn_count = turn
    s.tool_call_count = tool_calls
    return s


def _tool_use(name="search_concepts", id_="call-1", args=None):
    tu = MagicMock()
    tu.id = id_
    tu.name = name
    tu.args = args or {"query": "x"}
    return tu


def _tool_result(name="search_concepts", id_="call-1"):
    r = MagicMock()
    r.tool_use_id = id_
    r.name = name
    r.is_error = False
    return r


@pytest.mark.asyncio
async def test_on_tool_start_emits_tool_use_event_as_first_payload():
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        hooks = HeartbeatLoopHooks()
        await hooks.on_tool_start(_state(), _tool_use())
    activity_mod.heartbeat.assert_called_once()
    # First call: history holds just the one tool_use event, sent as a
    # single positional arg → heartbeatDetails.payloads = [Payload(tool_use)].
    args = activity_mod.heartbeat.call_args.args
    assert len(args) == 1
    assert args[0]["event"] == "tool_use"
    assert args[0]["payload"]["name"] == "search_concepts"
    assert args[0]["payload"]["callId"] == "call-1"
    assert args[0]["payload"]["input"] == {"query": "x"}


@pytest.mark.asyncio
async def test_on_tool_end_resends_full_event_history():
    # Critical regression guard: when a fast tool finishes inside a single
    # poll window, we MUST re-send the tool_use event alongside the
    # tool_result so the API stream sees both.
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        hooks = HeartbeatLoopHooks()
        await hooks.on_tool_start(_state(), _tool_use())
        await hooks.on_tool_end(_state(), _tool_use(), _tool_result())
    # Second heartbeat call carries BOTH events (variadic, full history).
    second_call = activity_mod.heartbeat.call_args_list[-1]
    args = second_call.args
    assert len(args) == 2
    assert args[0]["event"] == "tool_use"
    assert args[1]["event"] == "tool_result"
    assert args[1]["payload"]["callId"] == "call-1"
    assert args[1]["payload"]["ok"] is True


@pytest.mark.asyncio
async def test_history_accumulates_across_multiple_tool_calls():
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        hooks = HeartbeatLoopHooks()
        await hooks.on_tool_start(
            _state(),
            _tool_use(name="search_concepts", id_="call-1"),
        )
        await hooks.on_tool_end(
            _state(),
            _tool_use(name="search_concepts", id_="call-1"),
            _tool_result(id_="call-1"),
        )
        await hooks.on_tool_start(
            _state(),
            _tool_use(name="expand_concept_graph", id_="call-2"),
        )
        await hooks.on_tool_end(
            _state(),
            _tool_use(name="expand_concept_graph", id_="call-2"),
            _tool_result(id_="call-2"),
        )
    # Final heartbeat carries the entire 4-event history.
    args = activity_mod.heartbeat.call_args_list[-1].args
    assert len(args) == 4
    events = [a["event"] for a in args]
    assert events == ["tool_use", "tool_result", "tool_use", "tool_result"]
    call_ids = [a["payload"]["callId"] for a in args]
    assert call_ids == ["call-1", "call-1", "call-2", "call-2"]


@pytest.mark.asyncio
async def test_other_hooks_are_no_op():
    hooks = HeartbeatLoopHooks()
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        await hooks.on_run_start(_state())
        await hooks.on_turn_start(_state())
        await hooks.on_run_end(_state())
    activity_mod.heartbeat.assert_not_called()
