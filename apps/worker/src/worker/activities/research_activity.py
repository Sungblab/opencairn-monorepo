"""Research agent Temporal activity.

Thin wrapper around :class:`worker.agents.research.ResearchAgent`. Mirrors
the Compiler activity: one activity per run, full hook chain (trajectory
writer + token counter) wired up so the Research event stream is persisted
the same way the Compiler's is.

Kept in ``activities/`` (not ``temporal/activities/``) to match the Phase A
layout of ``compiler_activity.py`` — Plan 4's original "temporal/" folder
layout was never created on master.
"""
from __future__ import annotations

import os
from dataclasses import asdict
from pathlib import Path
from typing import Any

from llm import get_provider
from temporalio import activity

from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.events import AgentEvent
from runtime.hooks import HookRegistry
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter

from worker.agents.research import ResearchAgent
from worker.agents.research.agent import _output_to_dict  # type: ignore[attr-defined]
from worker.lib.api_client import AgentApiClient


_TRAJECTORY_DIR = Path(
    os.environ.get("TRAJECTORY_DIR", "/var/opencairn/trajectories")
)


class _ActivityTrajectoryHook(TrajectoryWriterHook):
    def __init__(self, storage: LocalFSTrajectoryStorage) -> None:
        super().__init__()
        self._storage = storage

    async def _build_writer(self, ctx: ToolContext) -> TrajectoryWriter:
        w = TrajectoryWriter(
            storage=self._storage,
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
        )
        await w.open()
        return w


@activity.defn(name="run_research")
async def run_research(inp: dict[str, Any]) -> dict[str, Any]:
    """Run a single Research session.

    Input:
        - query: str
        - project_id, workspace_id, user_id: str
        - top_k: int (optional, default 8)

    Output: :class:`ResearchOutput` serialised via the same helper the
    agent uses when emitting its ``AgentEnd`` payload.
    """
    run_id = activity.info().workflow_id

    activity.logger.info(
        "run_research start: query=%r project=%s workspace=%s run=%s",
        inp.get("query"),
        inp.get("project_id"),
        inp.get("workspace_id"),
        run_id,
    )

    storage = LocalFSTrajectoryStorage(base_dir=_TRAJECTORY_DIR)
    traj_hook = _ActivityTrajectoryHook(storage)
    token_hook = TokenCounterHook()

    registry = HookRegistry()
    registry.register(traj_hook, scope="global")
    registry.register(token_hook, scope="global")

    async def _emit(ev: AgentEvent) -> None:
        await traj_hook.on_event(ctx, ev)
        await token_hook.on_event(ctx, ev)

    ctx = ToolContext(
        workspace_id=inp["workspace_id"],
        project_id=inp.get("project_id"),
        page_id=None,
        user_id=inp["user_id"],
        run_id=run_id,
        scope="project",
        emit=_emit,
    )

    provider = get_provider()
    agent = ResearchAgent(provider=provider, api=AgentApiClient())

    final_output: dict[str, Any] | None = None
    async for ev in agent.run(inp, ctx):
        await _emit(ev)
        if ev.type == "agent_end":
            final_output = dict(ev.output)  # type: ignore[arg-type]

    # Fallback when the agent didn't emit AgentEnd (should not happen unless
    # it raised before reaching the end — in which case AgentError was
    # already yielded and the exception re-raised to Temporal).
    if final_output is None:
        final_output = {
            "query": inp.get("query", ""),
            "answer": "",
            "sub_queries": [],
            "citations": [],
            "wiki_feedback": [],
        }

    activity.logger.info(
        "run_research done: citations=%d wiki_feedback=%d",
        len(final_output.get("citations", [])),
        len(final_output.get("wiki_feedback", [])),
    )
    return final_output
