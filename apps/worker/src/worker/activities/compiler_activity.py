"""Compiler agent Temporal activity.

One activity wraps the full :class:`worker.agents.compiler.CompilerAgent` run
so that Temporal's retry/timeout policy applies to the whole concept-
extraction pass rather than each tool-level HTTP call. The activity does the
*non-deterministic* work; the workflow keeps a deterministic handle on the
outcome via the returned :class:`CompilerOutput`.

The activity also wires up the runtime hook chain — trajectory writer,
token counter, Sentry — so every event the agent emits is persisted
identically to how it would be under a future direct-invocation path
(e.g. a manual compile button in the UI).
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

from worker.agents.compiler import CompilerAgent, CompilerOutput
from worker.lib.api_client import AgentApiClient
from worker.lib.batch_submit import make_batch_submit


_TRAJECTORY_DIR = Path(
    os.environ.get("TRAJECTORY_DIR", "/var/opencairn/trajectories")
)


class _ActivityTrajectoryHook(TrajectoryWriterHook):
    """Trajectory writer that lands NDJSON files on the local filesystem
    at ``$TRAJECTORY_DIR/{workspace_id}/{run_id}.ndjson``. The storage
    layer creates parent directories eagerly.
    """

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


@activity.defn(name="compile_note")
async def compile_note(inp: dict[str, Any]) -> dict[str, Any]:
    """Compile a single source note.

    Input:
        - note_id: str (uuid of the triggering source note)
        - project_id, workspace_id, user_id: str

    Output: :class:`CompilerOutput` serialised via ``dataclasses.asdict``.

    Temporal retry policy (configured on the workflow side) handles
    transient HTTP 5xx / network errors via ``CompilerAgent`` marking
    them retryable. 4xx from the internal API surface as non-retryable
    and fail the activity immediately.
    """
    run_id = activity.info().workflow_id  # 1 workflow = 1 compile run
    ctx_ws = inp["workspace_id"]

    activity.logger.info(
        "compile_note start: note=%s project=%s workspace=%s run=%s",
        inp.get("note_id"),
        inp.get("project_id"),
        ctx_ws,
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
        workspace_id=ctx_ws,
        project_id=inp.get("project_id"),
        page_id=inp.get("note_id"),
        user_id=inp["user_id"],
        run_id=run_id,
        scope="project",
        emit=_emit,
    )

    provider = get_provider()
    # Plan 3b — the batch callback is always injected; embed_many() inside
    # the agent only exercises it when BATCH_EMBED_COMPILER_ENABLED=true
    # and the candidate count crosses BATCH_EMBED_MIN_ITEMS. Otherwise
    # it's unused and the sync provider.embed path runs unchanged.
    agent = CompilerAgent(
        provider=provider,
        api=AgentApiClient(),
        batch_submit=make_batch_submit(),
    )

    output: CompilerOutput | None = None
    async for ev in agent.run(inp, ctx):
        await _emit(ev)
        if ev.type == "agent_end":
            # AgentEnd.output is already a plain dict of CompilerOutput
            # fields; stash the whole thing so the workflow can return it.
            output = CompilerOutput(**ev.output)  # type: ignore[arg-type]

    # If the agent raised, the error event was already emitted; re-raising
    # below would lose the trajectory writer's close step. `finally` via
    # the hook ensures the writer always flushes. A missing output means
    # the agent ended without AgentEnd — treat as empty.
    if output is None:
        output = CompilerOutput(
            note_id=inp["note_id"],
            extracted_count=0,
            created_count=0,
            merged_count=0,
            linked_count=0,
            concept_ids=[],
        )

    activity.logger.info(
        "compile_note done: note=%s extracted=%d created=%d merged=%d linked=%d",
        output.note_id,
        output.extracted_count,
        output.created_count,
        output.merged_count,
        output.linked_count,
    )
    return asdict(output)
