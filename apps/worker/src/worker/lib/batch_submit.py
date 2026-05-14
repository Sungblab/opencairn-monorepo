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
from contextlib import suppress
from typing import TYPE_CHECKING

from temporalio import activity
from temporalio.client import Client

from worker.lib.s3_client import download_jsonl
from worker.workflows.batch_embed_workflow import (
    BatchEmbedInput,
    BatchEmbedOutput,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from llm import EmbedInput

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
    """Flatten chunk-aligned results into an original-aligned list.

    ``_run_one_chunk`` already returns a list of length ``len(chunk)``
    with ``None`` in each empty-text slot. ``_chunk_inputs`` produces
    contiguous non-overlapping slices of ``original``, so concatenating
    the chunk results is already aligned 1:1 with ``original``.

    The previous implementation re-walked ``original`` with a cursor
    that skipped empty-text slots, effectively double-accounting the
    empties: every non-empty input that followed an empty one pulled
    the wrong (usually ``None``) slot from the flat list. See PR #25
    review (Gemini CRITICAL) and the regression tests
    ``test_preserves_none_placeholders_for_empty_text`` and
    ``test_multi_chunk_with_interleaved_empties``.

    ``original`` stays in the signature for a length-invariant check
    — anything other than ``sum(len(chunk)) == len(original)`` is a
    ``_run_one_chunk`` bug and we'd rather fail loud than return a
    silently-shortened list.
    """
    flat: list[list[float] | None] = []
    for chunk in chunk_results:
        flat.extend(chunk)
    if len(flat) != len(original):
        raise ValueError(
            f"chunk results total {len(flat)} but original has {len(original)}"
        )
    return flat


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
            with suppress(RuntimeError):
                activity.heartbeat("batch_embed_waiting")
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
        # Run chunks concurrently. Each chunk's workflow can legally
        # block up to BATCH_EMBED_MAX_WAIT_SECONDS (default 24h) —
        # sequential execution would multiply that by len(chunks) and
        # blow past the caller activity's start_to_close_timeout
        # envelope (24h + 10m, see batch_timeouts.py). Gemini's batch
        # API accepts concurrent submissions; running in parallel
        # also compresses total latency to ~max(chunk_latencies).
        # Exceptions from any chunk propagate — embed_helper catches
        # and falls back to sync for the whole input. (PR #25 review —
        # Gemini HIGH.)
        chunk_results = list(
            await asyncio.gather(
                *(
                    _run_one_chunk(
                        client, chunk, workspace_id=workspace_id, queue=queue
                    )
                    for chunk in chunks
                )
            )
        )

        return _align_from_chunks(inputs, chunk_results)

    return batch_submit
