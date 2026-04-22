from __future__ import annotations

import pytest

from llm.tool_types import (
    AssistantTurn,
    ToolResult,
    ToolUse,
    UsageCounts,
)


def test_tooluse_args_hash_stable_across_key_order():
    a = ToolUse(id="t1", name="foo", args={"x": 1, "y": 2})
    b = ToolUse(id="t1", name="foo", args={"y": 2, "x": 1})
    assert a.args_hash() == b.args_hash()


def test_tooluse_args_hash_differs_for_different_args():
    a = ToolUse(id="t1", name="foo", args={"x": 1})
    b = ToolUse(id="t1", name="foo", args={"x": 2})
    assert a.args_hash() != b.args_hash()


def test_tooluse_thought_signature_optional():
    tu = ToolUse(id="t1", name="foo", args={})
    assert tu.thought_signature is None


def test_tool_result_defaults():
    r = ToolResult(tool_use_id="t1", name="foo", data={"ok": True})
    assert r.is_error is False


def test_assistant_turn_empty_tool_uses():
    turn = AssistantTurn(
        final_text="hello",
        tool_uses=(),
        assistant_message={"raw": "opaque"},
        usage=UsageCounts(input_tokens=10, output_tokens=5),
        stop_reason="STOP",
    )
    assert turn.final_text == "hello"
    assert turn.tool_uses == ()
    assert turn.structured_output is None


def test_assistant_turn_frozen():
    turn = AssistantTurn(
        final_text=None,
        tool_uses=(),
        assistant_message=None,
        usage=UsageCounts(0, 0),
        stop_reason="STOP",
    )
    with pytest.raises(Exception):
        turn.final_text = "mutated"  # type: ignore[misc]
