from __future__ import annotations

import asyncio

import pytest

from llm.errors import ProviderFatalError, ProviderRetryableError
from llm.tool_types import ToolUse
from runtime.tool_loop import LoopConfig, ToolLoopExecutor

from .test_tool_loop_core import _FakeProvider, _FakeRegistry, _turn


class _ErrorProvider:
    def __init__(self, exc: Exception):
        self._exc = exc

    def supports_tool_calling(self) -> bool:
        return True

    async def generate_with_tools(self, **kwargs):
        raise self._exc

    def tool_result_to_message(self, result):
        return {}


async def test_structured_submitted_ends_immediately():
    tu = ToolUse(
        id="t", name="emit_structured_output",
        args={"schema_name": "X", "data": {"a": 1}},
    )
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu])])

    async def emit(args):
        return {"accepted": True, "validated": args["data"]}

    registry = _FakeRegistry(handlers={"emit_structured_output": emit})
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "structured_submitted"
    assert result.final_structured_output == {"a": 1}


async def test_provider_fatal_terminates_provider_error():
    provider = _ErrorProvider(ProviderFatalError("unauthorized"))
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=_FakeRegistry(handlers={}),
        config=LoopConfig(), tool_context={},
    )
    result = await executor.run(initial_messages=[])
    assert result.termination_reason == "provider_error"
    assert "unauthorized" in (result.error or "")


async def test_provider_retryable_propagates():
    provider = _ErrorProvider(ProviderRetryableError("rate limit"))
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=_FakeRegistry(handlers={}),
        config=LoopConfig(), tool_context={},
    )
    with pytest.raises(ProviderRetryableError):
        await executor.run(initial_messages=[])


async def test_cancelled_returns_partial_state():
    async def slow_generate(**kwargs):
        await asyncio.sleep(5)
        return _turn(text="never")

    class _SlowProvider:
        def supports_tool_calling(self):
            return True

        generate_with_tools = staticmethod(slow_generate)

        def tool_result_to_message(self, r):
            return {}

    provider = _SlowProvider()
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=_FakeRegistry(handlers={}),
        config=LoopConfig(), tool_context={},
    )
    task = asyncio.create_task(executor.run(initial_messages=[]))
    await asyncio.sleep(0.05)
    task.cancel()
    result = await task
    assert result.termination_reason == "cancelled"
