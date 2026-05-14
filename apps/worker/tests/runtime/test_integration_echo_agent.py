"""End-to-end: EchoAgent runs with full hook chain, writes trajectory,
tokens are counted, eval case passes. No external services (local filesystem only)."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from runtime.agent import Agent
from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.eval.case import EvalCase, ExpectedToolCall
from runtime.eval.metrics import score_trajectory
from runtime.events import AgentEnd, AgentEvent, AgentStart, ModelEnd, ToolResult, ToolUse
from runtime.hooks import HookRegistry
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path


class EchoAgent(Agent):
    """Echo input back. Emits one ModelEnd + one ToolUse/Result to exercise full event set."""

    name = "echo"
    description = "Echo agent for integration testing."

    async def run(
        self, input: dict[str, Any], ctx: ToolContext
    ) -> AsyncGenerator[AgentEvent, None]:
        yield AgentStart(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=0, ts=1.0, type="agent_start", scope=ctx.scope, input=input,
        )
        yield ModelEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=1, ts=1.1, type="model_end", model_id="gemini-3-pro",
            prompt_tokens=100, completion_tokens=30, cached_tokens=0,
            cost_krw=8, finish_reason="stop", latency_ms=600,
        )
        yield ToolUse(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=2, ts=1.2, type="tool_use", tool_call_id="c0",
            tool_name="search_pages",
            input_args={"scope": ctx.scope, "query": input.get("query", "")},
            input_hash="h", concurrency_safe=True,
        )
        yield ToolResult(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=3, ts=1.3, type="tool_result", tool_call_id="c0",
            ok=True, output=[{"id": "p1", "title": "알고리즘 노트"}], duration_ms=40,
        )
        yield AgentEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=4, ts=1.5, type="agent_end",
            output={"answer": f"프로젝트 알고리즘: {input.get('query', '')}"},
            duration_ms=500,
        )


async def test_full_pipeline(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)

    class TestTrajectoryHook(TrajectoryWriterHook):
        async def _build_writer(self, ctx: ToolContext) -> TrajectoryWriter:
            w = TrajectoryWriter(
                storage=storage, run_id=ctx.run_id, workspace_id=ctx.workspace_id
            )
            await w.open()
            return w

    traj_hook = TestTrajectoryHook()
    token_hook = TokenCounterHook()

    reg = HookRegistry()
    reg.register(traj_hook, scope="global")
    reg.register(token_hook, scope="global")

    case = EvalCase(
        id="echo-1",
        description="EchoAgent emits all events and matches expectations",
        agent="echo",
        scope="page",
        input={"query": "알고리즘"},
        expected_tools=[
            ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})
        ],
        response_contains=["알고리즘"],
        max_cost_krw=100,
    )

    async def _emit(ev: AgentEvent) -> None:
        await traj_hook.on_event(_ctx, ev)
        await token_hook.on_event(_ctx, ev)

    _ctx = ToolContext(
        workspace_id="ws-1", project_id="proj-1", page_id="page-1",
        user_id="u-1", run_id="run-echo-1", scope="page", emit=_emit,
    )

    agent = EchoAgent()
    events: list[AgentEvent] = []
    async for ev in agent.run(case.input, _ctx):
        events.append(ev)
        await _emit(ev)

    files = list(tmp_trajectory_dir.rglob("*.ndjson"))
    assert len(files) == 1
    lines = files[0].read_text(encoding="utf-8").splitlines()
    assert len(lines) == 5
    parsed = [json.loads(line) for line in lines]
    assert [p["type"] for p in parsed] == [
        "agent_start", "model_end", "tool_use", "tool_result", "agent_end",
    ]

    totals = token_hook.totals(_ctx.run_id)
    assert totals.prompt_tokens == 100
    assert totals.cost_krw == 8
    assert totals.model_call_count == 1

    scores = score_trajectory(
        case, events, total_cost_krw=totals.cost_krw, duration_ms=500,
    )
    assert scores.tool_trajectory_score == 1.0
    assert scores.forbidden_tool_score == 1.0
    assert scores.response_contains_score == 1.0
    assert scores.cost_within_budget == 1.0
