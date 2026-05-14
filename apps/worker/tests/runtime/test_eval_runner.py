"""Runner smoke test using a fake Agent."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from runtime.agent import Agent
from runtime.eval.case import EvalCase, ExpectedToolCall
from runtime.eval.runner import DEFAULT_CRITERIA, AgentEvaluator
from runtime.events import AgentEnd, AgentEvent, AgentStart, ToolResult, ToolUse

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from runtime.tools import ToolContext


class FakeResearchAgent(Agent):
    name = "research"
    description = "fake"

    async def run(
        self, input: dict[str, Any], ctx: ToolContext
    ) -> AsyncGenerator[AgentEvent, None]:
        yield AgentStart(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=0, ts=1.0, type="agent_start", scope=ctx.scope, input=input,
        )
        yield ToolUse(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=1, ts=1.1, type="tool_use", tool_call_id="c0",
            tool_name="search_pages", input_args={"scope": "page"},
            input_hash="h", concurrency_safe=True,
        )
        yield ToolResult(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=2, ts=1.2, type="tool_result", tool_call_id="c0",
            ok=True, output=[{"id": "p1"}], duration_ms=30,
        )
        yield AgentEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=3, ts=1.5, type="agent_end",
            output={"answer": "결과: 알고리즘"}, duration_ms=500,
        )


async def test_runner_passes_clean_trajectory() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page",
        input={"query": "알고리즘"},
        expected_tools=[
            ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})
        ],
        response_contains=["알고리즘"],
        max_cost_krw=1000,
    )
    result = await AgentEvaluator.run(case, agent_factory=lambda: FakeResearchAgent())
    result.assert_passed(DEFAULT_CRITERIA)
