from __future__ import annotations

from llm.tool_types import AssistantTurn, ToolUse, UsageCounts

from runtime.tool_loop import LoopConfig, ToolLoopExecutor

from .test_tool_loop_core import _FakeProvider, _FakeRegistry, _turn


async def test_max_turns_terminates():
    tu = ToolUse(id="t", name="ping", args={})
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu]) for _ in range(20)])

    async def ping(args):
        return {"ok": True}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(max_turns=3, max_tool_calls=999)
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "max_turns"


async def test_max_tool_calls_terminates():
    tu = ToolUse(id="t", name="ping", args={})
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu]) for _ in range(20)])

    async def ping(args):
        return {"ok": True}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(max_turns=999, max_tool_calls=2)
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "max_tool_calls"
    assert result.tool_call_count == 2


async def test_max_input_tokens_terminates():
    tu = ToolUse(id="t", name="ping", args={})
    provider = _FakeProvider(scripted=[
        AssistantTurn(
            final_text=None, tool_uses=(tu,),
            assistant_message={},
            usage=UsageCounts(input_tokens=100, output_tokens=10),
            stop_reason="STOP",
        ) for _ in range(5)
    ])

    async def ping(args):
        return {}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(max_total_input_tokens=150)
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "max_input_tokens"
