"""Tests for Agent ABC and stream_graph_as_events adapter."""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest

from runtime.agent import Agent
from runtime.events import AgentEnd, AgentEvent, AgentStart, CustomEvent
from runtime.tools import ToolContext


async def _noop(_ev: AgentEvent) -> None:
    pass


async def test_agent_is_abstract() -> None:
    with pytest.raises(TypeError):
        Agent()  # type: ignore[abstract]


async def test_subclass_yields_events() -> None:
    class EchoAgent(Agent):
        name = "echo"
        description = "Echoes input."

        async def run(
            self, input: dict[str, Any], ctx: ToolContext
        ) -> AsyncGenerator[AgentEvent, None]:
            yield AgentStart(
                run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                seq=0, ts=1.0, type="agent_start", scope=ctx.scope, input=input,
            )
            yield CustomEvent(
                run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                seq=1, ts=1.1, type="custom", label="progress", payload={"pct": 50},
            )
            yield AgentEnd(
                run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                seq=2, ts=2.0, type="agent_end", output=input, duration_ms=1000,
            )

    ctx = ToolContext(
        workspace_id="w1", project_id=None, page_id=None,
        user_id="u1", run_id="r1", scope="project", emit=_noop,
    )
    agent = EchoAgent()
    events = [ev async for ev in agent.run({"msg": "hi"}, ctx)]
    assert len(events) == 3
    assert events[0].type == "agent_start"
    assert events[1].type == "custom"
    assert events[2].type == "agent_end"
