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

import asyncio
import os
from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING, Any

from llm import get_provider
from temporalio import activity

from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.hooks import HookRegistry
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter
from worker.agents.compiler import CompilerAgent, CompilerOutput
from worker.lib.agent_run_tracking import make_agent_run_tracker
from worker.lib.api_client import AgentApiClient
from worker.lib.batch_submit import make_batch_submit

if TYPE_CHECKING:
    from runtime.events import AgentEvent


_TRAJECTORY_DIR = Path(
    os.environ.get("TRAJECTORY_DIR", "/var/opencairn/trajectories")
)
_EVIDENCE_CONCEPT_WRITE_CONCURRENCY = 8
_EVIDENCE_RELATION_WRITE_CONCURRENCY = 4
_EVIDENCE_RELATION_PAIR_LIMIT = 50


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
    run_id = activity.info().workflow_id or activity.info().activity_id
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
    api = AgentApiClient()
    run_tracker = make_agent_run_tracker(
        api=api,
        agent_name="compiler",
        inp=inp,
        workflow_id=run_id,
        page_id=inp.get("note_id"),
    )
    await run_tracker.start()
    agent = CompilerAgent(
        provider=provider,
        api=api,
        batch_submit=make_batch_submit(),
    )

    output: CompilerOutput | None = None
    try:
        async for ev in agent.run(inp, ctx):
            await _emit(ev)
            if ev.type == "agent_end":
                # AgentEnd.output is already a plain dict of CompilerOutput
                # fields; stash the whole thing so the workflow can return it.
                output = CompilerOutput(**ev.output)  # type: ignore[arg-type]
    except Exception as exc:
        await run_tracker.finish(status="failed", token_hook=token_hook, error=exc)
        raise

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
    try:
        await _record_concept_extraction_evidence(api, inp, output, run_id)
    except Exception as exc:  # noqa: BLE001 - evidence is best-effort
        activity.logger.warning(
            "compile_note evidence recording skipped: %s",
            exc,
        )
    await run_tracker.finish(status="completed", token_hook=token_hook)
    return asdict(output)


async def _record_concept_extraction_evidence(
    api: AgentApiClient,
    inp: dict[str, Any],
    output: CompilerOutput,
    run_id: str,
) -> None:
    """Persist chunk-backed concept extraction evidence for a compiler run.

    This path is intentionally best-effort. During rollout, source-note chunk
    indexing may lag behind source-note creation; in that case we skip rather
    than failing the compiler workflow.
    """
    concept_ids = list(dict.fromkeys(output.concept_ids))
    if not concept_ids:
        return

    chunks_payload = await api.list_note_chunks(
        note_id=output.note_id,
        workspace_id=inp["workspace_id"],
        project_id=inp["project_id"],
        limit=5,
    )
    chunks = list(chunks_payload.get("chunks", []))
    if not chunks:
        activity.logger.info(
            "compile_note evidence skipped: no indexed chunks for note=%s",
            output.note_id,
        )
        return

    note = chunks_payload.get("note", {})
    entries: list[dict[str, Any]] = []
    extraction_chunks: list[dict[str, Any]] = []
    for rank, chunk in enumerate(chunks, start=1):
        quote = str(chunk.get("quote") or chunk.get("contentText") or "")[:1200]
        if not quote:
            continue
        note_chunk_id = str(chunk["id"])
        entries.append(
            {
                "noteChunkId": note_chunk_id,
                "noteId": str(chunk.get("noteId") or output.note_id),
                "noteType": str(note.get("type") or "source"),
                "sourceType": note.get("sourceType"),
                "headingPath": str(chunk.get("headingPath") or ""),
                "sourceOffsets": chunk.get("sourceOffsets") or {"start": 0, "end": len(quote)},
                "score": 1.0,
                "rank": rank,
                "retrievalChannel": "generated",
                "quote": quote,
                "citation": {
                    "label": f"S{rank}",
                    "title": str(note.get("title") or "Source"),
                    "locator": str(chunk.get("headingPath") or f"chunk {rank}"),
                },
                "metadata": {"producer": "compiler"},
            }
        )
        extraction_chunks.append(
            {
                "noteChunkId": note_chunk_id,
                "supportScore": 1.0,
                "quote": quote,
            }
        )

    if not entries:
        return

    bundle = await api.create_evidence_bundle(
        workspace_id=inp["workspace_id"],
        project_id=inp["project_id"],
        purpose="concept_extraction",
        producer={"kind": "worker", "runId": run_id, "tool": "compile_note"},
        created_by=inp.get("user_id"),
        entries=entries,
    )
    bundle_id = str(bundle["id"])

    semaphore = asyncio.Semaphore(_EVIDENCE_CONCEPT_WRITE_CONCURRENCY)

    async def _record_one(concept_id: str) -> None:
        async with semaphore:
            await _record_one_concept_extraction(
                api=api,
                inp=inp,
                output=output,
                run_id=run_id,
                bundle_id=bundle_id,
                extraction_chunks=extraction_chunks,
                concept_id=concept_id,
            )

    await asyncio.gather(*(_record_one(concept_id) for concept_id in concept_ids))
    await _record_compiler_relation_claims(
        api=api,
        inp=inp,
        output=output,
        run_id=run_id,
        bundle_id=bundle_id,
        extraction_chunks=extraction_chunks,
        concept_ids=concept_ids,
    )


async def _record_one_concept_extraction(
    *,
    api: AgentApiClient,
    inp: dict[str, Any],
    output: CompilerOutput,
    run_id: str,
    bundle_id: str,
    extraction_chunks: list[dict[str, Any]],
    concept_id: str,
) -> None:
    try:
        concept = await api.get_concept(concept_id)
        name = str(concept.get("name") or concept_id)
        await api.create_concept_extraction(
            workspace_id=inp["workspace_id"],
            project_id=inp["project_id"],
            concept_id=concept_id,
            name=name,
            kind="concept",
            normalized_name=name.strip().lower(),
            description=str(concept.get("description") or ""),
            confidence=1.0,
            evidence_bundle_id=bundle_id,
            source_note_id=output.note_id,
            created_by_run_id=run_id,
            chunks=extraction_chunks,
        )
        description = str(concept.get("description") or "").strip()
        claim_text = (
            f"{name}: {description}"
            if description
            else f"{name} is a concept extracted from the source note."
        )
        await api.create_knowledge_claim(
            workspace_id=inp["workspace_id"],
            project_id=inp["project_id"],
            subject_concept_id=concept_id,
            claim_text=claim_text[:4000],
            claim_type="definition",
            status="active",
            confidence=1.0,
            evidence_bundle_id=bundle_id,
            produced_by="ingest",
            produced_by_run_id=run_id,
        )
    except Exception as exc:  # noqa: BLE001 - one concept must not block the rest
        activity.logger.warning(
            "compile_note concept extraction evidence skipped for concept=%s: %s",
            concept_id,
            exc,
        )


async def _record_compiler_relation_claims(
    *,
    api: AgentApiClient,
    inp: dict[str, Any],
    output: CompilerOutput,
    run_id: str,
    bundle_id: str,
    extraction_chunks: list[dict[str, Any]],
    concept_ids: list[str],
) -> None:
    """Create source-note co-mention relation claims for adjacent concepts."""
    if len(concept_ids) < 2 or not extraction_chunks:
        return

    pairs = list(zip(concept_ids, concept_ids[1:], strict=False))[
        :_EVIDENCE_RELATION_PAIR_LIMIT
    ]
    if not pairs:
        return

    semaphore = asyncio.Semaphore(_EVIDENCE_RELATION_WRITE_CONCURRENCY)

    async def _record_pair(source_id: str, target_id: str) -> None:
        async with semaphore:
            await _record_one_compiler_relation_claim(
                api=api,
                inp=inp,
                output=output,
                run_id=run_id,
                bundle_id=bundle_id,
                extraction_chunks=extraction_chunks,
                source_id=source_id,
                target_id=target_id,
            )

    await asyncio.gather(*(_record_pair(a, b) for a, b in pairs if a != b))


async def _record_one_compiler_relation_claim(
    *,
    api: AgentApiClient,
    inp: dict[str, Any],
    output: CompilerOutput,
    run_id: str,
    bundle_id: str,
    extraction_chunks: list[dict[str, Any]],
    source_id: str,
    target_id: str,
) -> None:
    try:
        source, target = await asyncio.gather(
            api.get_concept(source_id),
            api.get_concept(target_id),
        )
        source_name = str(source.get("name") or source_id)
        target_name = str(target.get("name") or target_id)
        edge_id, _created = await api.upsert_edge(
            source_id=source_id,
            target_id=target_id,
            relation_type="co-mentioned",
            weight=0.5,
            evidence_note_id=output.note_id,
        )
        chunk = extraction_chunks[0]
        await api.create_knowledge_claim(
            workspace_id=inp["workspace_id"],
            project_id=inp["project_id"],
            subject_concept_id=source_id,
            object_concept_id=target_id,
            claim_text=(
                f"{source_name} is co-mentioned with {target_name} "
                "in the source note."
            )[:4000],
            claim_type="relation",
            status="active",
            confidence=0.7,
            evidence_bundle_id=bundle_id,
            produced_by="ingest",
            produced_by_run_id=run_id,
            edge_evidence=[
                {
                    "conceptEdgeId": edge_id,
                    "noteChunkId": chunk["noteChunkId"],
                    "supportScore": 0.7,
                    "stance": "mentions",
                    "quote": chunk["quote"],
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001 - relation evidence is best-effort
        activity.logger.warning(
            "compile_note relation evidence skipped for %s -> %s: %s",
            source_id,
            target_id,
            exc,
        )
