"""Curator agent Temporal activity.

Thin wrapper around :class:`worker.agents.curator.CuratorAgent`. Mirrors the
Synthesis activity: one activity per run, full hook chain (trajectory writer +
token counter) wired up so the Curator event stream is persisted the same way
all other agents' streams are.
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

from worker.agents.curator import CuratorAgent
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


@activity.defn(name="run_curator")
async def run_curator(inp: dict[str, Any]) -> dict[str, Any]:
    """Run a single Curator scan session.

    Input:
        - project_id, workspace_id, user_id: str
        - max_orphans: int (optional, default 50)
        - max_duplicate_pairs: int (optional, default 20)
        - max_contradiction_pairs: int (optional, default 5)

    Output:
        - orphans_found: int
        - duplicates_found: int
        - contradictions_found: int
        - suggestions_created: int
    """
    run_id = activity.info().workflow_id

    activity.logger.info(
        "run_curator start: project=%s workspace=%s run=%s",
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
    agent = CuratorAgent(provider=provider, api=AgentApiClient())

    final_output: dict[str, Any] | None = None
    async for ev in agent.run(inp, ctx):
        await _emit(ev)
        if ev.type == "agent_end":
            final_output = dict(ev.output)  # type: ignore[arg-type]

    if final_output is None:
        final_output = {
            "orphans_found": 0,
            "duplicates_found": 0,
            "contradictions_found": 0,
            "suggestions_created": 0,
        }

    activity.logger.info(
        "run_curator done: orphans=%d duplicates=%d contradictions=%d suggestions=%d",
        final_output.get("orphans_found", 0),
        final_output.get("duplicates_found", 0),
        final_output.get("contradictions_found", 0),
        final_output.get("suggestions_created", 0),
    )
    return final_output
