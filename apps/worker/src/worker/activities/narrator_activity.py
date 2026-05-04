"""Narrator agent Temporal activity.

Thin wrapper around :class:`worker.agents.narrator.NarratorAgent`. Mirrors
the Synthesis activity: one activity per run, full hook chain (trajectory
writer + token counter) wired up so the Narrator event stream is persisted
the same way all other agents' streams are.
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
from worker.agents.narrator import NarratorAgent
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


@activity.defn(name="run_narrator")
async def run_narrator(inp: dict[str, Any]) -> dict[str, Any]:
    """Run a single Narrator session.

    Input:
        - note_id: str  (UUID of the source note to narrate)
        - project_id, workspace_id, user_id: str
        - style: str (optional, default "conversational")
        - max_duration_sec: int (optional)

    Output: NarratorAgent end payload:
        - script: list[dict]  (speaker turns)
        - has_audio: bool
        - audio_file_id: str  (present only when has_audio=True)
        - r2_key: str         (present only when has_audio=True)
    """
    run_id = activity.info().workflow_id or activity.info().activity_id

    activity.logger.info(
        "run_narrator start: note_id=%r workspace=%s run=%s",
        inp.get("note_id"),
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
    api = AgentApiClient()
    run_tracker = make_agent_run_tracker(
        api=api,
        agent_name="narrator",
        inp=inp,
        workflow_id=run_id,
        page_id=inp.get("note_id"),
    )
    await run_tracker.start()
    agent = NarratorAgent(provider=provider, api=api)

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
            "script": [],
            "has_audio": False,
        }

    activity.logger.info(
        "run_narrator done: has_audio=%s script_turns=%d",
        final_output.get("has_audio", False),
        len(final_output.get("script", [])),
    )
    await run_tracker.finish(status="completed", token_hook=token_hook)
    return final_output
