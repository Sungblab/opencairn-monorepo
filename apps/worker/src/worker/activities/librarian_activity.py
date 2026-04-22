"""Librarian Temporal activity — nightly maintenance for one project.

Mirrors the Compiler/Research activities: single wrapper around the agent,
full hook chain, NDJSON trajectory persisted per run.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from llm import get_provider
from temporalio import activity

from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.events import AgentEvent
from runtime.hooks import HookRegistry
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter

from worker.agents.librarian import LibrarianAgent
from worker.lib.api_client import AgentApiClient
from worker.lib.batch_submit import make_batch_submit


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


@activity.defn(name="run_librarian")
async def run_librarian(inp: dict[str, Any]) -> dict[str, Any]:
    """Run one Librarian pass for a project.

    Input:
        - project_id, workspace_id, user_id: str

    Output: :class:`LibrarianOutput` fields.
    """
    run_id = activity.info().workflow_id

    activity.logger.info(
        "run_librarian start: project=%s workspace=%s run=%s",
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
        project_id=inp["project_id"],
        page_id=None,
        user_id=inp["user_id"],
        run_id=run_id,
        scope="project",
        emit=_emit,
    )

    provider = get_provider()
    agent = LibrarianAgent(
        provider=provider,
        api=AgentApiClient(),
        batch_submit=make_batch_submit(),
    )

    final_output: dict[str, Any] | None = None
    async for ev in agent.run(inp, ctx):
        await _emit(ev)
        if ev.type == "agent_end":
            final_output = dict(ev.output)  # type: ignore[arg-type]

    if final_output is None:
        final_output = {
            "project_id": inp.get("project_id", ""),
            "orphan_count": 0,
            "contradictions": [],
            "duplicates_merged": 0,
            "links_strengthened": 0,
        }

    activity.logger.info(
        "run_librarian done: orphans=%d contradictions=%d merged=%d links=%d",
        final_output.get("orphan_count", 0),
        len(final_output.get("contradictions", [])),
        final_output.get("duplicates_merged", 0),
        final_output.get("links_strengthened", 0),
    )
    return final_output
