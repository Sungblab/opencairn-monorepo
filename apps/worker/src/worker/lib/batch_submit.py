"""Bridges :func:`llm.embed_helper.embed_many` into the Temporal world.

``embed_many`` must not import Temporal (it's shared with scripts and
tests), so agents running inside Temporal activities inject this
``batch_submit`` callback which starts a sibling :class:`BatchEmbedWorkflow`
via the Temporal **Client** and awaits its result.

Why the Client and not ``workflow.execute_child_workflow``? Compilers
run inside an activity (``compile_note``, ``run_librarian``) — activities
cannot start child workflows. The activity layer creates a client
connection, starts the workflow, and polls for completion while sending
heartbeats so the activity timeout extends with each tick.

## Safety requirements when enabling BATCH_EMBED_*_ENABLED

The caller activity MUST be configured with:
  * ``start_to_close_timeout >= BATCH_EMBED_MAX_WAIT_SECONDS + 10m`` — the
    workflow can legally spend 24 h waiting on Gemini; the activity slot
    must outlast it.
  * ``heartbeat_timeout >= 2 * _HEARTBEAT_INTERVAL`` — the loop below
    heartbeats at ``_HEARTBEAT_INTERVAL``; any missed tick must still
    fit.

If the heartbeat raises ``CancelledError`` the outer activity is being
torn down; we abandon the await (the workflow keeps running — it owns
its own durable lifecycle, including its own cancel activity) and
propagate.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Sequence

from temporalio import activity
from temporalio.client import Client

from llm import EmbedInput

from worker.lib.s3_client import download_jsonl
from worker.workflows.batch_embed_workflow import (
    BatchEmbedInput,
    BatchEmbedOutput,
)

logger = logging.getLogger(__name__)


# How often to heartbeat while blocked on ``handle.result()``. 30s is a
# safe default against any heartbeat_timeout that's >= 1min (workflow
# layer configures the high end); tighten only if an activity's
# heartbeat_timeout must be < 1min for policy reasons.
_HEARTBEAT_INTERVAL = float(os.environ.get("BATCH_SUBMIT_HEARTBEAT_SECONDS", "30"))

# Plan 3b §AD-1: Gemini's ``InlinedRequests`` caps a single batch below
# ~2000 requests; bigger payloads also wedge the 6 MiB-ish JSONL
# sidecars. When the caller sends more than this we split here (caller-
# side) rather than inside the workflow — the workflow stays a simple
# one-batch primitive and the additional complexity (parallelism,
# error aggregation) lives with the orchestrator that already owns a
# Temporal Client connection.
def _max_items() -> int:
    raw = os.environ.get("BATCH_EMBED_MAX_ITEMS")
    if not raw:
        return 2000
    try:
        return int(raw)
    except ValueError:
        return 2000


def _chunk_inputs(
    inputs: Sequence[EmbedInput], max_items: int
) -> list[list[EmbedInput]]:
    """Split ``inputs`` into at-most-``max_items`` contiguous groups.

    Contract:
      * preserves original order within and across chunks
      * empty input → empty list (no empty chunks)
      * ``max_items <= 0`` degrades to a single chunk (defensive against
        malformed ``BATCH_EMBED_MAX_ITEMS`` from ops).
    """
    items = list(inputs)
    if not items:
        return []
    if max_items <= 0:
        return [items]
    return [items[i : i + max_items] for i in range(0, len(items), max_items)]


def _align_from_chunks(
    original: Sequence[EmbedInput],
    chunk_results: list[list[list[float] | None]],
) -> list[list[float] | None]:
    """Zip chunk results back to the original input order.

    ``EmbedInput`` with empty/None text are skipped before the workflow
    payload is built (bytes never cross Temporal's payload boundary),
    so their slot in the aligned list is always ``None``. Missing
    results (edge case where a chunk returns fewer vectors than it
    received — shouldn't happen post-fix but defensive) also resolve to
    ``None``.
    """
    flat: list[list[float] | None] = []
    for chunk in chunk_results:
        flat.extend(chunk)
    out: list[list[float] | None] = []
    cursor = 0
    for inp in original:
        if not inp.text:
            out.append(None)
            continue
        if cursor < len(flat):
            out.append(flat[cursor])
        else:
            out.append(None)
        cursor += 1
    return out


async def _get_temporal_client() -> Client:
    address = os.environ.get("TEMPORAL_ADDRESS", "localhost:7233")
    namespace = os.environ.get("TEMPORAL_NAMESPACE", "default")
    return await Client.connect(address, namespace=namespace)


async def _await_with_heartbeat(handle) -> BatchEmbedOutput:
    """Wait for ``handle.result()`` while heartbeating at a steady cadence.

    Activity heartbeats reset the ``heartbeat_timeout`` clock and also
    give Temporal a chance to signal cancellation. Without this loop,
    a batch workflow that legitimately runs for hours would appear
    stuck to the outer activity and get killed on the first heartbeat
    timeout.
    """
    result_task = asyncio.create_task(handle.result())
    try:
        while not result_task.done():
            try:
                activity.heartbeat("batch_embed_waiting")
            except RuntimeError:
                # Not inside an activity context (e.g. a pure script
                # using this helper). Heartbeat is a no-op in that case.
                pass
            done, _ = await asyncio.wait(
                {result_task}, timeout=_HEARTBEAT_INTERVAL
            )
            if result_task in done:
                break
        return await result_task
    except asyncio.CancelledError:
        # Outer activity is being torn down — abandon the wait. The
        # child workflow keeps running (it's durable); a follow-up
        # activity retry will attach via Temporal Client instead of
        # submitting a fresh job, provided the caller stashes the
        # workflow id for idempotent re-use. TODO: wire that in Phase 2.
        if not result_task.done():
            result_task.cancel()
        raise


async def _run_one_chunk(
    client,
    chunk: Sequence[EmbedInput],
    *,
    workspace_id: str | None,
    queue: str,
) -> list[list[float] | None]:
    """Run one BatchEmbedWorkflow and return its vectors aligned to
    ``chunk`` order. Empty-text inputs inside ``chunk`` stay None."""
    items = [
        {"text": inp.text, "task": inp.task}
        for inp in chunk
        if inp.text
    ]
    if not items:
        return [None] * len(chunk)

    wf_id = (
        f"BatchEmbedWorkflow-{workspace_id or 'global'}-"
        f"{uuid.uuid4().hex[:12]}"
    )
    wf_in = BatchEmbedInput(
        items=items, workspace_id=workspace_id, provider="gemini"
    )
    handle = await client.start_workflow(
        "BatchEmbedWorkflow",
        wf_in,
        id=wf_id,
        task_queue=queue,
    )
    out: BatchEmbedOutput = await _await_with_heartbeat(handle)

    sidecar_lines = download_jsonl(out.output_s3_key) if out.output_s3_key else []
    lookup: dict[int, list[float] | None] = {}
    for line in sidecar_lines:
        idx = line.get("index")
        if isinstance(idx, int):
            vec = line.get("vector")
            lookup[idx] = list(vec) if vec else None

    aligned: list[list[float] | None] = []
    non_empty_idx = 0
    for inp_obj in chunk:
        if inp_obj.text:
            aligned.append(lookup.get(non_empty_idx))
            non_empty_idx += 1
        else:
            aligned.append(None)
    return aligned


def make_batch_submit(*, task_queue: str | None = None):
    """Factory for an :class:`_BatchSubmit`-compatible callback."""
    queue = task_queue or os.environ.get("TEMPORAL_TASK_QUEUE", "ingest")

    async def batch_submit(
        inputs: Sequence[EmbedInput],
        *,
        workspace_id: str | None,
    ) -> list[list[float] | None]:
        if not inputs:
            return []

        # Plan 3b §AD-1: split >MAX_ITEMS here so the workflow stays a
        # single-batch primitive. Each chunk runs sequentially — one
        # embedding_batches row per chunk, simple error recovery
        # semantics (a mid-run failure leaves earlier chunks persisted).
        chunks = _chunk_inputs(inputs, _max_items())
        if not chunks:
            return [None] * len(inputs)

        client = await _get_temporal_client()
        chunk_results: list[list[list[float] | None]] = []
        for chunk in chunks:
            chunk_result = await _run_one_chunk(
                client, chunk, workspace_id=workspace_id, queue=queue
            )
            chunk_results.append(chunk_result)

        return _align_from_chunks(inputs, chunk_results)

    return batch_submit
