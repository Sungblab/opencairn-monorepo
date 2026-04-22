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


def make_batch_submit(*, task_queue: str | None = None):
    """Factory for an :class:`_BatchSubmit`-compatible callback."""
    queue = task_queue or os.environ.get("TEMPORAL_TASK_QUEUE", "ingest")

    async def batch_submit(
        inputs: Sequence[EmbedInput],
        *,
        workspace_id: str | None,
    ) -> list[list[float] | None]:
        # Convert provider-facing EmbedInput to the workflow's payload-
        # safe dicts. Bytes never cross the Temporal boundary — batch
        # embed is text-only by contract.
        items = [
            {"text": inp.text, "task": inp.task}
            for inp in inputs
            if inp.text
        ]
        if not items:
            return [None] * len(inputs)

        client = await _get_temporal_client()
        wf_id = f"BatchEmbedWorkflow-{workspace_id or 'global'}-{uuid.uuid4().hex[:12]}"
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

        # Vectors live in S3 (Plan 3b AD-3) — read the JSONL sidecar,
        # align the entries back to the caller's original input order
        # (we filtered empty texts when building `items`).
        sidecar_lines = download_jsonl(out.output_s3_key) if out.output_s3_key else []
        lookup: dict[int, list[float] | None] = {}
        for line in sidecar_lines:
            idx = line.get("index")
            if isinstance(idx, int):
                vec = line.get("vector")
                # Lists come back as-is; None stays None for per-item failures.
                lookup[idx] = list(vec) if vec else None

        aligned: list[list[float] | None] = []
        non_empty_idx = 0
        for inp_obj in inputs:
            if inp_obj.text:
                aligned.append(lookup.get(non_empty_idx))
                non_empty_idx += 1
            else:
                aligned.append(None)
        return aligned

    return batch_submit
