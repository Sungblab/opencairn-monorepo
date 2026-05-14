"""Tests for default global hooks."""
from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.events import AgentEnd, AgentEvent, AgentStart, ModelEnd
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter

if TYPE_CHECKING:
    from pathlib import Path


async def _noop(_ev: AgentEvent) -> None:
    pass


@pytest.fixture
def ctx() -> ToolContext:
    return ToolContext(
        workspace_id="w1", project_id=None, page_id=None,
        user_id="u1", run_id="r-traj-1", scope="project", emit=_noop,
    )


async def test_trajectory_writer_hook_flushes_on_end(
    ctx: ToolContext, tmp_trajectory_dir: Path
) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)

    class TestHook(TrajectoryWriterHook):
        async def _build_writer(self, ctx: ToolContext) -> TrajectoryWriter:
            w = TrajectoryWriter(
                storage=storage, run_id=ctx.run_id, workspace_id=ctx.workspace_id
            )
            await w.open()
            return w

    hook = TestHook()
    start = AgentStart(
        run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=0, ts=1.0,
        type="agent_start", scope="project", input={"q": "x"},
    )
    end = AgentEnd(
        run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=1, ts=2.0,
        type="agent_end", output={}, duration_ms=1000,
    )
    await hook.on_event(ctx, start)
    await hook.on_event(ctx, end)

    files = list(tmp_trajectory_dir.rglob("*.ndjson"))
    assert len(files) == 1


async def test_token_counter_aggregates_cost(ctx: ToolContext) -> None:
    hook = TokenCounterHook()
    await hook.reset(ctx.run_id)
    await hook.on_event(
        ctx,
        ModelEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=0, ts=1.0,
            type="model_end", model_id="gemini-3-pro",
            prompt_tokens=100, completion_tokens=50, cached_tokens=0, cost_krw=12,
            finish_reason="stop", latency_ms=800,
        ),
    )
    await hook.on_event(
        ctx,
        ModelEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=1, ts=1.1,
            type="model_end", model_id="gemini-3-pro",
            prompt_tokens=50, completion_tokens=20, cached_tokens=0, cost_krw=5,
            finish_reason="stop", latency_ms=300,
        ),
    )
    totals = hook.totals(ctx.run_id)
    assert totals.prompt_tokens == 150
    assert totals.completion_tokens == 70
    assert totals.cost_krw == 17
