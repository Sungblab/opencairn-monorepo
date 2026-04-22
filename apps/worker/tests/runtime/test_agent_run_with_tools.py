from __future__ import annotations

import pytest

from llm.errors import ToolCallingNotSupported
from runtime.loop_runner import run_with_tools
from runtime.tool_loop import LoopConfig


class _NoToolsProvider:
    def supports_tool_calling(self) -> bool:
        return False

    async def generate_with_tools(self, **kwargs):
        raise ToolCallingNotSupported("nope")


async def test_run_with_tools_fails_fast_when_provider_unsupported():
    with pytest.raises(ToolCallingNotSupported):
        await run_with_tools(
            provider=_NoToolsProvider(),
            initial_messages=[],
            tools=[],
            tool_context={"workspace_id": "ws", "project_id": "pj"},
            config=LoopConfig(),
        )
