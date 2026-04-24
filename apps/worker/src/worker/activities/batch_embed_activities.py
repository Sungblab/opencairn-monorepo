"""Temporal activities backing :class:`BatchEmbedWorkflow` (Plan 3b).

Each activity is a thin wrapper over a single provider call plus the
``embedding_batches`` bookkeeping write. Keeping them narrow lets the
workflow layer (``batch_embed_workflow.py``) own the durable polling
loop — a worker crash during sleep replays the workflow, not the
expensive submit.

Wire format: handles and polls travel between activities as plain dicts
(Temporal payload-safe). Dataclass-to-dict and back happens here so the
provider calls still see typed :class:`BatchEmbedHandle` objects.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from temporalio import activity

from llm import (
    BATCH_STATE_SUCCEEDED,
    BatchEmbedHandle,
    EmbedInput,
    get_provider,
)

# "timeout" is a local (OpenCairn) state — the caller gave up before the
# provider reached any terminal state. See embedding_batches enum.
_STATE_TIMEOUT = "timeout"
from worker.lib.api_client import AgentApiClient
from worker.lib.batch_metrics import emit_event
from worker.lib.s3_client import upload_jsonl

logger = logging.getLogger(__name__)


def _handle_from_dict(d: dict[str, Any]) -> BatchEmbedHandle:
    return BatchEmbedHandle(
        provider_batch_name=d["provider_batch_name"],
        submitted_at=float(d.get("submitted_at", 0.0)),
        input_count=int(d["input_count"]),
    )


def _handle_to_dict(h: BatchEmbedHandle) -> dict[str, Any]:
    return {
        "provider_batch_name": h.provider_batch_name,
        "submitted_at": h.submitted_at,
        "input_count": h.input_count,
    }


@activity.defn(name="submit_batch_embed")
async def submit_batch_embed(payload: dict[str, Any]) -> dict[str, Any]:
    """Submit a batch of text embeddings.

    ``payload`` keys:
      - ``items``: list[{"text": str, "task": str | None}]
      - ``workspace_id``: str | None
      - ``provider``: str (informational — we trust ``get_provider()`` to
        return the worker-configured provider)
      - ``input_s3_key``: str — where to store the request JSONL sidecar

    Returns ``{"handle": {...}, "batch_id": "<uuid>"}`` where ``batch_id``
    is the local ``embedding_batches`` row id. If the worker crashes
    before this activity completes, Temporal replays with at-most-once
    semantics guaranteed by our unique index on ``provider_batch_name``.
    """
    items = payload["items"]
    workspace_id: str | None = payload.get("workspace_id")
    input_s3_key: str = payload["input_s3_key"]

    inputs = [
        EmbedInput(
            text=i.get("text"),
            task=i.get("task") or "retrieval_document",
        )
        for i in items
    ]

    # 1. Upload the request JSONL before submitting so a later failure
    # still leaves an audit trail of what we tried to embed. Using
    # pure-text entries keeps PII exposure the same as the DB content
    # already has (embedded text originates from note bodies).
    upload_jsonl(
        input_s3_key,
        [
            {"index": i, "text": inp.text, "task": inp.task}
            for i, inp in enumerate(inputs)
        ],
    )

    provider = get_provider()
    display_name = f"opencairn-embed-{workspace_id or 'global'}-{int(payload.get('submitted_at', 0))}"
    handle = await provider.embed_batch_submit(inputs, display_name=display_name)

    api = AgentApiClient()
    batch_id, created = await api.create_embedding_batch(
        workspace_id=workspace_id,
        provider=payload.get("provider") or provider.config.provider,
        provider_batch_name=handle.provider_batch_name,
        input_count=handle.input_count,
        input_s3_key=input_s3_key,
    )
    if not created:
        # Idempotent replay — normal. Keep a breadcrumb so ops can spot
        # stuck batches where the workflow keeps re-submitting.
        activity.logger.info(
            "embedding_batches row %s already existed (replay?)", batch_id
        )

    emit_event(
        "batch_embed.submit",
        workspace_id=workspace_id,
        input_count=handle.input_count,
        provider_batch_name=handle.provider_batch_name,
        batch_id=batch_id,
    )

    return {
        "handle": _handle_to_dict(handle),
        "batch_id": batch_id,
    }


@activity.defn(name="poll_batch_embed")
async def poll_batch_embed(payload: dict[str, Any]) -> dict[str, Any]:
    """Fetch current state + write it through to ``embedding_batches``.

    Returns the poll as a plain dict so the workflow can keyword-branch
    on ``state``/``done`` without importing the typed dataclass.
    """
    handle = _handle_from_dict(payload["handle"])
    batch_id: str = payload["batch_id"]
    provider = get_provider()
    poll = await provider.embed_batch_poll(handle)
    api = AgentApiClient()
    await api.update_embedding_batch(
        batch_id=batch_id,
        state=poll.state,
        success_count=poll.successful_request_count,
        failure_count=poll.failed_request_count,
        pending_count=poll.pending_request_count,
    )
    if poll.done:
        emit_event(
            "batch_embed.poll_done",
            batch_id=batch_id,
            state=poll.state,
            success_count=poll.successful_request_count,
            failure_count=poll.failed_request_count,
        )
    return {
        "state": poll.state,
        "request_count": poll.request_count,
        "successful_request_count": poll.successful_request_count,
        "failed_request_count": poll.failed_request_count,
        "pending_request_count": poll.pending_request_count,
        "done": poll.done,
    }


@activity.defn(name="fetch_batch_embed_results")
async def fetch_batch_embed_results(payload: dict[str, Any]) -> dict[str, Any]:
    """Fetch aligned per-item vectors, persist to S3, mark row completed.

    Returns only ``{"output_s3_key", "batch_id", "success_count",
    "failure_count"}`` — **vectors never cross the Temporal payload
    boundary** (Plan 3b AD-3: 2000×768 vectors ≈ 6 MiB > 2 MiB cap).
    The caller-side ``make_batch_submit`` reads the JSONL from S3 and
    produces the aligned list.
    """
    handle = _handle_from_dict(payload["handle"])
    batch_id: str = payload["batch_id"]
    output_s3_key: str = payload["output_s3_key"]
    provider = get_provider()
    result = await provider.embed_batch_fetch(handle)

    upload_jsonl(
        output_s3_key,
        [
            {
                "index": i,
                "vector": v,
                "error": e,
            }
            for i, (v, e) in enumerate(zip(result.vectors, result.errors))
        ],
    )

    api = AgentApiClient()
    success = sum(1 for v in result.vectors if v is not None)
    failure = len(result.vectors) - success
    await api.update_embedding_batch(
        batch_id=batch_id,
        state=BATCH_STATE_SUCCEEDED,
        success_count=success,
        failure_count=failure,
        pending_count=0,
        output_s3_key=output_s3_key,
        mark_completed=True,
    )

    # Duration is submit → fetch (end-to-end Gemini time). handle carries
    # the submit timestamp. Missing/zero submitted_at yields a 0 duration
    # — dashboards can filter those out rather than mislead.
    submit_ts = handle.submitted_at or 0.0
    now = time.time()
    duration = max(0.0, now - submit_ts) if submit_ts else 0.0
    emit_event(
        "batch_embed.fetch",
        batch_id=batch_id,
        duration_seconds=duration,
        success_count=success,
        failure_count=failure,
    )

    return {
        "output_s3_key": output_s3_key,
        "batch_id": batch_id,
        "success_count": success,
        "failure_count": failure,
    }


@activity.defn(name="cancel_batch_embed")
async def cancel_batch_embed(payload: dict[str, Any]) -> None:
    """Best-effort cancel + row update. Called when the poll loop times
    out before the provider reached a terminal state. Failures are logged
    but not re-raised — the workflow has already decided to give up.
    """
    handle = _handle_from_dict(payload["handle"])
    batch_id: str = payload["batch_id"]
    reason: str = payload.get("reason") or "poll timeout"
    provider = get_provider()
    try:
        await provider.embed_batch_cancel(handle)
    except Exception as exc:  # noqa: BLE001
        activity.logger.warning(
            "cancel_batch_embed: provider cancel failed: %s", exc
        )
    api = AgentApiClient()
    await api.update_embedding_batch(
        batch_id=batch_id,
        state=_STATE_TIMEOUT,
        error=reason[:2000],
        mark_completed=True,
    )
