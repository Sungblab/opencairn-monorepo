"""Staleness agent Temporal activity.

Thin wrapper around :class:`worker.agents.temporal_agent.StalenessAgent`.
Mirrors the Curator/Research activity pattern: one activity per run, full
hook chain (trajectory writer + token counter) wired up so the Staleness
event stream is persisted the same way the other agents' streams are.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

from llm import get_provider
from temporalio import activity

from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.hooks import HookRegistry
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter
from worker.agents.temporal_agent import StalenessAgent
from worker.lib.agent_run_tracking import make_agent_run_tracker
from worker.lib.api_client import AgentApiClient

if TYPE_CHECKING:
    from runtime.events import AgentEvent

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


@activity.defn(name="run_staleness")
async def run_staleness(inp: dict[str, Any]) -> dict[str, Any]:
    """Run a single Staleness scan.

    Input:
        - workspace_id, project_id, user_id: str
        - stale_days: int (optional, default 90)
        - max_notes: int (optional, default 20)
        - score_threshold: float (optional, default 0.5)

    Output: ``{"candidates": int, "notes_checked": int, "alerts_created": int}``
    """
    run_id = activity.info().workflow_id or activity.info().activity_id

    activity.logger.info(
        "run_staleness start: project=%s workspace=%s stale_days=%s run=%s",
        inp.get("project_id"),
        inp.get("workspace_id"),
        inp.get("stale_days", 90),
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
    api = AgentApiClient()
    run_tracker = make_agent_run_tracker(
        api=api,
        agent_name="staleness",
        inp=inp,
        workflow_id=run_id,
    )
    await run_tracker.start()
    agent = StalenessAgent(provider=provider, api=api)

    final_output: dict[str, Any] | None = None
    try:
        async for ev in agent.run(inp, ctx):
            await _emit(ev)
            if ev.type == "agent_end":
                final_output = dict(ev.output)  # type: ignore[arg-type]
    except Exception as exc:
        await run_tracker.finish(status="failed", token_hook=token_hook, error=exc)
        raise

    if final_output is None:
        final_output = {
            "candidates": 0,
            "notes_checked": 0,
            "alerts_created": 0,
        }

    activity.logger.info(
        "run_staleness done: candidates=%d notes_checked=%d alerts_created=%d",
        final_output.get("candidates", 0),
        final_output.get("notes_checked", 0),
        final_output.get("alerts_created", 0),
    )
    await run_tracker.finish(status="completed", token_hook=token_hook)
    return final_output
