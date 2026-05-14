"""CodeAgent unit — exercises the one-shot tool-extraction contract."""
from unittest.mock import AsyncMock, MagicMock

import pytest
from llm.tool_types import AssistantTurn, ToolUse, UsageCounts

from worker.agents.code.agent import CodeAgent, CodeContext, CodeOutput


def _turn_with_emit(args: dict) -> AssistantTurn:
    return AssistantTurn(
        final_text=None,
        tool_uses=(
            ToolUse(
                id="t1",
                name="emit_structured_output",
                args=args,
            ),
        ),
        assistant_message=None,
        usage=UsageCounts(input_tokens=0, output_tokens=0),
        stop_reason="tool_use",
    )


def _turn_without_tool() -> AssistantTurn:
    return AssistantTurn(
        final_text="no tool used",
        tool_uses=(),
        assistant_message=None,
        usage=UsageCounts(input_tokens=0, output_tokens=0),
        stop_reason="stop",
    )


@pytest.mark.asyncio
async def test_emits_structured_output_on_generate():
    llm = MagicMock()
    llm.generate_with_tools = AsyncMock(
        return_value=_turn_with_emit(
            {"language": "python", "source": "print('ok')", "explanation": "trivial"}
        )
    )
    agent = CodeAgent(llm=llm)
    ctx = CodeContext(
        kind="generate",
        user_prompt="say hi",
        language="python",
        last_code=None,
        last_error=None,
        stdout_tail="",
    )
    out = await agent.run(ctx)
    assert isinstance(out, CodeOutput)
    assert out.source == "print('ok')"
    assert out.language == "python"


@pytest.mark.asyncio
async def test_fix_passes_last_error_into_prompt():
    llm = MagicMock()
    captured: dict = {}

    async def capture(messages, tools, **kw):
        captured["msg"] = messages
        return _turn_with_emit(
            {"language": "python", "source": "x=1", "explanation": "fixed"}
        )

    llm.generate_with_tools = capture
    agent = CodeAgent(llm=llm)
    out = await agent.run(
        CodeContext(
            kind="fix",
            user_prompt="p",
            language="python",
            last_code="oops",
            last_error="NameError: zzz",
            stdout_tail="t",
        )
    )
    flat = "\n".join(
        m["content"] for m in captured["msg"] if isinstance(m.get("content"), str)
    )
    assert "NameError" in flat
    assert "oops" in flat
    assert out.source == "x=1"


@pytest.mark.asyncio
async def test_rejects_when_emit_missing():
    llm = MagicMock()
    llm.generate_with_tools = AsyncMock(return_value=_turn_without_tool())
    agent = CodeAgent(llm=llm)
    with pytest.raises(RuntimeError, match="emit_structured_output"):
        await agent.run(
            CodeContext(
                kind="generate",
                user_prompt="p",
                language="python",
                last_code=None,
                last_error=None,
                stdout_tail="",
            )
        )
