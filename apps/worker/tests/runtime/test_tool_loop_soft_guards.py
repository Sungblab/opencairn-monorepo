from __future__ import annotations

import asyncio

from llm.tool_types import ToolUse

from runtime.tool_loop import LoopConfig, ToolLoopExecutor

from .test_tool_loop_core import _FakeProvider, _FakeRegistry, _turn


async def test_loop_detection_hard_stop_after_5():
    tu = ToolUse(id="t", name="ping", args={"q": "same"})
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu]) for _ in range(10)])

    async def ping(args):
        return {"ok": True}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(
        loop_detection_threshold=3, loop_detection_stop_threshold=5,
        max_turns=999, max_tool_calls=999,
    )
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "loop_detected_hard"
    assert result.tool_call_count <= 5


async def test_per_tool_timeout_yields_error_result():
    tu = ToolUse(id="t", name="slow", args={})
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="recovered"),
    ])

    async def slow_handler(args):
        await asyncio.sleep(5)
        return {"never": True}

    registry = _FakeRegistry(handlers={"slow": slow_handler})
    config = LoopConfig(per_tool_timeout_sec=0.05)
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "model_stopped"
    assert result.final_text == "recovered"


async def test_tool_exception_yields_is_error_loop_continues():
    tu = ToolUse(id="t", name="boom", args={})
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="recovered"),
    ])

    async def boom(args):
        raise ValueError("kaboom")

    registry = _FakeRegistry(handlers={"boom": boom})
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count == 1
