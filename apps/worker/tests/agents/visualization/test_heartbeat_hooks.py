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
async def test_on_tool_start_emits_heartbeat():
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        hooks = HeartbeatLoopHooks()
        await hooks.on_tool_start(_state(), _tool_use())
    activity_mod.heartbeat.assert_called_once()
    metadata = activity_mod.heartbeat.call_args.args[0]
    assert metadata["event"] == "tool_use"
    assert metadata["payload"]["name"] == "search_concepts"
    assert metadata["payload"]["callId"] == "call-1"
    assert metadata["payload"]["input"] == {"query": "x"}


@pytest.mark.asyncio
async def test_on_tool_end_emits_heartbeat_with_summary():
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        hooks = HeartbeatLoopHooks()
        await hooks.on_tool_end(_state(), _tool_use(), _tool_result())
    metadata = activity_mod.heartbeat.call_args.args[0]
    assert metadata["event"] == "tool_result"
    assert metadata["payload"]["callId"] == "call-1"
    assert metadata["payload"]["ok"] is True


@pytest.mark.asyncio
async def test_other_hooks_are_no_op():
    hooks = HeartbeatLoopHooks()
    # Should not raise / not heartbeat
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        await hooks.on_run_start(_state())
        await hooks.on_turn_start(_state())
        await hooks.on_run_end(_state())
    activity_mod.heartbeat.assert_not_called()
