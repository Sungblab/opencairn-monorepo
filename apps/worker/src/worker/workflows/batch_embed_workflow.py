"""BatchEmbedWorkflow — durable polling loop around Gemini's async batch
embed API (Plan 3b).

Lifecycle: ``submit_batch_embed`` → loop(``poll_batch_embed``) →
``fetch_batch_embed_results``. Poll cadence is exponential (60s → capped
at 30 min) bounded by ``BATCH_EMBED_MAX_WAIT_SECONDS`` (default 24h,
matching Gemini's documented SLA).

Workflow-level sleeps are free (no activity slot held) so this stays
polite during the multi-hour wait that's typical for batch tier.

Caller surface: ``apps/worker/src/worker/lib/batch_submit.py`` wraps
the child-workflow invocation in the ``_BatchSubmit`` protocol
``embed_many()`` expects.
"""
from __future__ import annotations

import os
import uuid
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


# Read at workflow-module import (inside the sandbox) — these must not
# change mid-run. Override via .env.example. Workflow determinism is
# preserved because the values don't depend on wall-clock.
_INITIAL_WAIT_SECONDS = _int_env("BATCH_EMBED_INITIAL_POLL_SECONDS", 60)
_MAX_WAIT_SECONDS_BETWEEN_POLLS = _int_env(
    "BATCH_EMBED_MAX_POLL_SECONDS", 30 * 60
)
_MAX_TOTAL_WAIT_SECONDS = _int_env(
    "BATCH_EMBED_MAX_WAIT_SECONDS", 24 * 60 * 60
)


_SUBMIT_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(minutes=1),
    maximum_attempts=3,
)
_POLL_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(minutes=1),
    maximum_attempts=5,
)
_FETCH_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(minutes=1),
    maximum_attempts=3,
)
_CANCEL_RETRY = RetryPolicy(maximum_attempts=2)


@dataclass
class BatchEmbedInput:
    """Input to :class:`BatchEmbedWorkflow`.

    ``items`` is a list of ``{"text": str, "task": str | None}`` dicts —
    plain JSON so Temporal payload validation doesn't need the
    ``EmbedInput`` dataclass registered. ``workspace_id`` is nullable for
    Librarian cross-workspace maintenance sweeps.
    """

    items: list[dict[str, Any]] = field(default_factory=list)
    workspace_id: str | None = None
    provider: str = "gemini"


@dataclass
class BatchEmbedOutput:
    # Vectors live in S3 (``output_s3_key`` JSONL sidecar) — not in this
    # dataclass. See Plan 3b AD-3 + ADR-008: passing raw vectors through
    # Temporal's default 2 MiB gRPC payload breaks for batches beyond a
    # few hundred items. The caller reads the sidecar to align vectors
    # with their inputs.
    batch_id: str = ""
    output_s3_key: str = ""
    input_count: int = 0
    success_count: int = 0
    failure_count: int = 0


@workflow.defn(name="BatchEmbedWorkflow")
class BatchEmbedWorkflow:
    @workflow.run
    async def run(self, inp: BatchEmbedInput) -> BatchEmbedOutput:
        items = inp.items
        if not items:
            return BatchEmbedOutput()

        # One S3 prefix per workflow run — Temporal's workflow id is not
        # accessible as a str constant at workflow-module import, but
        # ``workflow.info()`` gives us a deterministic identifier we can
        # embed in the object key. Fall back to a uuid if info is absent
        # (tests that don't run inside a Temporal env).
        #
        # M-5 fix (post-hoc review 2026-04-23): the earlier ``run_id[:8]``
        # slice collapsed the 128-bit run_id into a 32-bit space, and
        # workflow_id is deterministic (e.g. ``compiler-{noteId}``) so
        # two retries of the same compile_note could share a prefix and
        # clobber each other's JSONL sidecars. Use the full run_id.
        try:
            info = workflow.info()
            run_prefix = f"{info.workflow_id}-{info.run_id}"
        except Exception:  # noqa: BLE001
            run_prefix = uuid.uuid4().hex
        input_s3_key = f"embeddings/batch/{run_prefix}/input.jsonl"
        output_s3_key = f"embeddings/batch/{run_prefix}/output.jsonl"

        # 1. Submit
        submit_payload: dict[str, Any] = {
            "items": items,
            "workspace_id": inp.workspace_id,
            "provider": inp.provider,
            "input_s3_key": input_s3_key,
            "submitted_at": int(workflow.time()),
        }
        submit_result = await workflow.execute_activity(
            "submit_batch_embed",
            submit_payload,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=_SUBMIT_RETRY,
        )
        handle = submit_result["handle"]
        batch_id = submit_result["batch_id"]

        # 2. Poll with exponential backoff. We compute the elapsed time
        # against `workflow.time()` so replay is deterministic — the
        # sandbox's clock progresses with logical events only.
        wait = _INITIAL_WAIT_SECONDS
        total_waited = 0
        poll: dict[str, Any] | None = None
        while total_waited < _MAX_TOTAL_WAIT_SECONDS:
            await workflow.sleep(timedelta(seconds=wait))
            total_waited += wait
            poll = await workflow.execute_activity(
                "poll_batch_embed",
                {"handle": handle, "batch_id": batch_id},
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=_POLL_RETRY,
            )
            if poll.get("done"):
                break
            wait = min(wait * 2, _MAX_WAIT_SECONDS_BETWEEN_POLLS)
        else:
            # Timeout: best-effort cancel and raise a *non-retryable*
            # error. The caller (embed_many) catches and falls back to
            # the sync path; we don't want Temporal retrying the whole
            # workflow because a 24h spin won't help.
            await workflow.execute_activity(
                "cancel_batch_embed",
                {
                    "handle": handle,
                    "batch_id": batch_id,
                    "reason": f"poll exceeded {_MAX_TOTAL_WAIT_SECONDS}s",
                },
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=_CANCEL_RETRY,
            )
            raise ApplicationError(
                "batch embed poll timed out",
                non_retryable=True,
            )

        assert poll is not None  # narrow for type checker
        state = poll.get("state", "unknown")
        if state != "succeeded":
            # Failed / cancelled / expired — let Temporal's retry policy
            # decide. EXPIRED is non-retryable (stale batch is useless).
            with suppress(ActivityError):
                await workflow.execute_activity(
                    "cancel_batch_embed",
                    {
                        "handle": handle,
                        "batch_id": batch_id,
                        "reason": f"non-success state: {state}",
                    },
                    start_to_close_timeout=timedelta(minutes=2),
                    retry_policy=_CANCEL_RETRY,
                )
            raise ApplicationError(
                f"batch embed ended in state {state!r}",
                non_retryable=state in ("expired", "cancelled", "timeout"),
            )

        # 3. Fetch — only reachable on succeeded.
        fetch_payload = {
            "handle": handle,
            "batch_id": batch_id,
            "output_s3_key": output_s3_key,
        }
        fetch_result = await workflow.execute_activity(
            "fetch_batch_embed_results",
            fetch_payload,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=_FETCH_RETRY,
        )
        return BatchEmbedOutput(
            batch_id=fetch_result["batch_id"],
            output_s3_key=fetch_result["output_s3_key"],
            input_count=len(items),
            success_count=fetch_result.get("success_count", 0),
            failure_count=fetch_result.get("failure_count", 0),
        )
