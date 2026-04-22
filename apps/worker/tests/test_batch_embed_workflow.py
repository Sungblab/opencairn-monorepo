"""End-to-end tests for :class:`BatchEmbedWorkflow` using the
time-skipping Temporal test env, plus targeted scenarios that pin down
the poll loop's backoff, timeout, and non-success terminal states.

The activity implementations are replaced with in-test stubs so we
don't need MinIO / the Hono internal API running. The workflow logic
itself is what we're validating.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from temporalio import activity
from temporalio.client import WorkflowFailureError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from worker.workflows.batch_embed_workflow import (
    BatchEmbedInput,
    BatchEmbedOutput,
    BatchEmbedWorkflow,
)


# Activity stubs live at module scope so the worker can register them by
# name — names match the real ``@activity.defn`` registrations.


@activity.defn(name="submit_batch_embed")
async def _stub_submit(payload: dict) -> dict:
    return {
        "handle": {
            "provider_batch_name": "batches/stub",
            "submitted_at": 0.0,
            "input_count": len(payload["items"]),
        },
        "batch_id": "row-1",
    }


# Poll state is controlled via a module-level dial — tests mutate it
# between runs. Keeping state module-scoped is ugly but lets us share
# one worker across the whole file.
_poll_states: list[dict] = []


@activity.defn(name="poll_batch_embed")
async def _stub_poll(payload: dict) -> dict:
    if not _poll_states:
        return {
            "state": "succeeded",
            "request_count": 1,
            "successful_request_count": 1,
            "failed_request_count": 0,
            "pending_request_count": 0,
            "done": True,
        }
    return _poll_states.pop(0)


@activity.defn(name="fetch_batch_embed_results")
async def _stub_fetch(payload: dict) -> dict:
    # Post-review fix: fetch now returns only metadata; vectors live in
    # the S3 JSONL sidecar addressed by output_s3_key.
    return {
        "output_s3_key": payload["output_s3_key"],
        "batch_id": payload["batch_id"],
        "success_count": 1,
        "failure_count": 0,
    }


_cancel_calls: list[dict] = []


@activity.defn(name="cancel_batch_embed")
async def _stub_cancel(payload: dict) -> None:
    _cancel_calls.append(payload)


@pytest.fixture(autouse=True)
def _reset_state():
    _poll_states.clear()
    _cancel_calls.clear()
    yield


@pytest.mark.asyncio
async def test_batch_embed_workflow_happy_path(monkeypatch):
    # Short-circuit the poll loop — first poll reports done, workflow
    # proceeds straight to fetch.
    monkeypatch.setenv("BATCH_EMBED_INITIAL_POLL_SECONDS", "1")
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"batch-test-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[BatchEmbedWorkflow],
            activities=[_stub_submit, _stub_poll, _stub_fetch, _stub_cancel],
        ):
            result = await env.client.execute_workflow(
                BatchEmbedWorkflow.run,
                BatchEmbedInput(items=[{"text": "hello", "task": None}]),
                id=f"wf-{uuid.uuid4().hex}",
                task_queue=task_queue,
            )
    assert isinstance(result, BatchEmbedOutput)
    assert result.batch_id == "row-1"
    assert result.output_s3_key.endswith("/output.jsonl")
    assert result.success_count == 1
    assert _cancel_calls == []


@pytest.mark.asyncio
async def test_batch_embed_workflow_polls_until_done(monkeypatch):
    monkeypatch.setenv("BATCH_EMBED_INITIAL_POLL_SECONDS", "1")
    # Running, running, then succeeded — workflow should keep polling.
    running = {
        "state": "running",
        "request_count": 1,
        "successful_request_count": 0,
        "failed_request_count": 0,
        "pending_request_count": 1,
        "done": False,
    }
    succeeded = {
        "state": "succeeded",
        "request_count": 1,
        "successful_request_count": 1,
        "failed_request_count": 0,
        "pending_request_count": 0,
        "done": True,
    }
    _poll_states.extend([running, running, succeeded])

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"batch-test-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[BatchEmbedWorkflow],
            activities=[_stub_submit, _stub_poll, _stub_fetch, _stub_cancel],
        ):
            result = await env.client.execute_workflow(
                BatchEmbedWorkflow.run,
                BatchEmbedInput(items=[{"text": "hello", "task": None}]),
                id=f"wf-{uuid.uuid4().hex}",
                task_queue=task_queue,
            )
    assert result.success_count == 1
    assert result.output_s3_key.endswith("/output.jsonl")


@pytest.mark.asyncio
async def test_batch_embed_workflow_failed_state_raises(monkeypatch):
    monkeypatch.setenv("BATCH_EMBED_INITIAL_POLL_SECONDS", "1")
    _poll_states.append(
        {
            "state": "failed",
            "request_count": 1,
            "successful_request_count": 0,
            "failed_request_count": 1,
            "pending_request_count": 0,
            "done": True,
        }
    )

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"batch-test-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[BatchEmbedWorkflow],
            activities=[_stub_submit, _stub_poll, _stub_fetch, _stub_cancel],
        ):
            with pytest.raises(WorkflowFailureError):
                await env.client.execute_workflow(
                    BatchEmbedWorkflow.run,
                    BatchEmbedInput(items=[{"text": "hello", "task": None}]),
                    id=f"wf-{uuid.uuid4().hex}",
                    task_queue=task_queue,
                )
    # Failed state triggers a cancel attempt so the provider-side job
    # doesn't leak if it's still racing; the DB row is already marked
    # failed by poll_batch_embed's bookkeeping.
    assert _cancel_calls, "cancel_batch_embed should fire on terminal non-success"


@pytest.mark.asyncio
async def test_batch_embed_workflow_empty_input_returns_empty():
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"batch-test-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[BatchEmbedWorkflow],
            activities=[_stub_submit, _stub_poll, _stub_fetch, _stub_cancel],
        ):
            result = await env.client.execute_workflow(
                BatchEmbedWorkflow.run,
                BatchEmbedInput(items=[]),
                id=f"wf-{uuid.uuid4().hex}",
                task_queue=task_queue,
            )
    assert result.input_count == 0
    assert result.batch_id == ""
    assert result.output_s3_key == ""
