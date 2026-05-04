"""Synthesis agent Temporal activity.

Thin wrapper around :class:`worker.agents.synthesis.SynthesisAgent`. Mirrors
the Research activity: one activity per run, full hook chain (trajectory
writer + token counter) wired up so the Synthesis event stream is persisted
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
from worker.agents.synthesis import SynthesisAgent
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


@activity.defn(name="run_synthesis")
async def run_synthesis(inp: dict[str, Any]) -> dict[str, Any]:
    """Run a single Synthesis session.

    Input:
        - note_ids: list[str]  (UUIDs of source notes to synthesize)
        - project_id, workspace_id, user_id: str
        - title: str (optional, default "Synthesis")
        - style: str (optional, default "")

    Output: ``SynthesisOutput`` serialised as a plain dict:
        - note_id: str
        - word_count: int
        - source_note_ids: list[str]
    """
    run_id = activity.info().workflow_id or activity.info().activity_id

    activity.logger.info(
        "run_synthesis start: note_ids=%r project=%s workspace=%s run=%s",
        inp.get("note_ids"),
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
    api = AgentApiClient()
    run_tracker = make_agent_run_tracker(
        api=api,
        agent_name="synthesis",
        inp=inp,
        workflow_id=run_id,
    )
    await run_tracker.start()
    agent = SynthesisAgent(provider=provider, api=api)

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
            "note_id": "",
            "word_count": 0,
            "source_note_ids": inp.get("note_ids", []),
        }

    activity.logger.info(
        "run_synthesis done: note_id=%s word_count=%d",
        final_output.get("note_id"),
        final_output.get("word_count", 0),
    )
    await run_tracker.finish(status="completed", token_hook=token_hook)
    return final_output
