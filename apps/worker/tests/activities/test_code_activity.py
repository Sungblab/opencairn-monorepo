"""CodeAgent activities — exercise persistence calls and prompt forwarding."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio.testing import ActivityEnvironment

from llm.tool_types import AssistantTurn, ToolUse, UsageCounts

from worker.activities.code_activity import (
    ClientFeedback,
    CodeRunParams,
    PersistedTurn,
    analyze_feedback_activity,
    generate_code_activity,
)


def _params() -> CodeRunParams:
    return CodeRunParams(
        run_id="11111111-1111-1111-1111-111111111111",
        note_id="22222222-2222-2222-2222-222222222222",
        workspace_id="33333333-3333-3333-3333-333333333333",
        user_id="u1",
        prompt="ask",
        language="python",
        byok_key_handle=None,
    )


def _turn(args: dict) -> AssistantTurn:
    return AssistantTurn(
        final_text=None,
        tool_uses=(ToolUse(id="t", name="emit_structured_output", args=args),),
        assistant_message=None,
        usage=UsageCounts(input_tokens=0, output_tokens=0),
        stop_reason="tool_use",
    )


@pytest.mark.asyncio
async def test_generate_calls_agent_and_persists_turn():
    params = _params()
    fake_provider = MagicMock()
    fake_provider.generate_with_tools = AsyncMock(
        return_value=_turn({"language": "python", "source": "print(1)", "explanation": "ok"})
    )
    with patch("worker.activities.code_activity.resolve_llm_provider",
               new=AsyncMock(return_value=fake_provider)), \
         patch("worker.activities.code_activity.persist_turn", new=AsyncMock()) as persist, \
         patch("worker.activities.code_activity.set_run_status", new=AsyncMock()) as setstatus:
        env = ActivityEnvironment()
        out = await env.run(generate_code_activity, params, [])
    assert out.source == "print(1)"
    persist.assert_awaited_once()
    setstatus.assert_any_await(params.run_id, "running")
    setstatus.assert_any_await(params.run_id, "awaiting_feedback")


@pytest.mark.asyncio
async def test_analyze_uses_feedback_kind_and_last_error():
    params = _params()
    feedback = ClientFeedback(kind="error", error="ZeroDivisionError", stdout="")
    history = [PersistedTurn(seq=0, kind="generate", source="1/0", explanation="", prev_error=None)]
    fake_provider = MagicMock()
    captured: dict = {}

    async def capture(messages, tools, **kw):
        captured["msg"] = messages
        return _turn({"language": "python", "source": "1/1", "explanation": "fixed"})

    fake_provider.generate_with_tools = capture
    with patch("worker.activities.code_activity.resolve_llm_provider",
               new=AsyncMock(return_value=fake_provider)), \
         patch("worker.activities.code_activity.persist_turn", new=AsyncMock()), \
         patch("worker.activities.code_activity.set_run_status", new=AsyncMock()):
        env = ActivityEnvironment()
        out = await env.run(analyze_feedback_activity, params, history, feedback)
    flat = "\n".join(m["content"] for m in captured["msg"] if isinstance(m.get("content"), str))
    assert "ZeroDivisionError" in flat
    assert "1/0" in flat
    assert out.source == "1/1"


@pytest.mark.asyncio
async def test_generate_marks_failed_on_agent_error():
    params = _params()
    fake_provider = MagicMock()
    fake_provider.generate_with_tools = AsyncMock(side_effect=RuntimeError("boom"))
    setstatus = AsyncMock()
    with patch("worker.activities.code_activity.resolve_llm_provider",
               new=AsyncMock(return_value=fake_provider)), \
         patch("worker.activities.code_activity.persist_turn", new=AsyncMock()), \
         patch("worker.activities.code_activity.set_run_status", new=setstatus):
        env = ActivityEnvironment()
        with pytest.raises(RuntimeError, match="boom"):
            await env.run(generate_code_activity, params, [])
    setstatus.assert_any_await(params.run_id, "running")
    setstatus.assert_any_await(params.run_id, "failed")
