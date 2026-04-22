"""Tests for :mod:`worker.activities.batch_embed_activities`.

Each activity is tested via :class:`temporalio.testing.ActivityEnvironment`
so we can run them in isolation with a controllable event loop. The
provider and API client are mocked at the import-boundary — no network,
no real Temporal server.
"""
from __future__ import annotations

import time
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from temporalio.testing import ActivityEnvironment

from llm.batch_types import BatchEmbedPoll, BatchEmbedResult
from worker.activities import batch_embed_activities as bea


def _stub_provider(
    *,
    submit_handle=None,
    poll_result: BatchEmbedPoll | None = None,
    fetch_result: BatchEmbedResult | None = None,
):
    """Minimal provider stub. Only the methods a given test touches need
    real values — the rest stay as plain MagicMocks that will raise if
    accidentally called.
    """
    from llm.batch_types import BatchEmbedHandle

    class _P:
        config = type(
            "Cfg", (), {"provider": "gemini", "embed_model": "gemini-embedding-001"}
        )()
        embed_batch_submit = AsyncMock(
            return_value=submit_handle
            or BatchEmbedHandle(
                provider_batch_name="batches/test-submit",
                submitted_at=time.time(),
                input_count=3,
            )
        )
        embed_batch_poll = AsyncMock(return_value=poll_result)
        embed_batch_fetch = AsyncMock(return_value=fetch_result)
        embed_batch_cancel = AsyncMock(return_value=None)

    return _P()


def _stub_api():
    api = AsyncMock()
    api.create_embedding_batch = AsyncMock(return_value=("batch-row-id", True))
    api.update_embedding_batch = AsyncMock(return_value=None)
    return api


@pytest.mark.asyncio
async def test_submit_batch_embed_uploads_jsonl_and_persists_row(monkeypatch):
    provider = _stub_provider()
    api = _stub_api()
    uploaded: dict[str, Any] = {}

    def fake_upload(key, lines):
        uploaded["key"] = key
        uploaded["lines"] = lines

    with patch.object(bea, "get_provider", return_value=provider), patch.object(
        bea, "AgentApiClient", return_value=api
    ), patch.object(bea, "upload_jsonl", side_effect=fake_upload):
        env = ActivityEnvironment()
        result = await env.run(
            bea.submit_batch_embed,
            {
                "items": [
                    {"text": "a", "task": None},
                    {"text": "b", "task": None},
                    {"text": "c", "task": None},
                ],
                "workspace_id": "ws1",
                "provider": "gemini",
                "input_s3_key": "embeddings/batch/run-1/input.jsonl",
                "submitted_at": 1_700_000_000,
            },
        )

    assert result["handle"]["provider_batch_name"] == "batches/test-submit"
    assert result["batch_id"] == "batch-row-id"
    # Input JSONL captures the index + text so we can audit what was sent.
    assert uploaded["key"] == "embeddings/batch/run-1/input.jsonl"
    assert [ln["text"] for ln in uploaded["lines"]] == ["a", "b", "c"]
    assert api.create_embedding_batch.await_args.kwargs["workspace_id"] == "ws1"


@pytest.mark.asyncio
async def test_poll_batch_embed_writes_state_counts():
    provider = _stub_provider(
        poll_result=BatchEmbedPoll(
            state="running",
            request_count=10,
            successful_request_count=0,
            failed_request_count=0,
            pending_request_count=10,
            done=False,
        )
    )
    api = _stub_api()
    with patch.object(bea, "get_provider", return_value=provider), patch.object(
        bea, "AgentApiClient", return_value=api
    ):
        env = ActivityEnvironment()
        out = await env.run(
            bea.poll_batch_embed,
            {
                "handle": {
                    "provider_batch_name": "batches/x",
                    "submitted_at": 0.0,
                    "input_count": 10,
                },
                "batch_id": "row-id",
            },
        )
    assert out["state"] == "running"
    assert out["done"] is False
    call = api.update_embedding_batch.await_args
    assert call.kwargs["state"] == "running"
    assert call.kwargs["pending_count"] == 10


@pytest.mark.asyncio
async def test_fetch_batch_embed_results_marks_succeeded():
    provider = _stub_provider(
        fetch_result=BatchEmbedResult(
            vectors=[[0.1, 0.2], None, [0.3, 0.4]],
            errors=[None, "transient", None],
        )
    )
    api = _stub_api()
    uploaded_keys: list[str] = []
    with patch.object(bea, "get_provider", return_value=provider), patch.object(
        bea, "AgentApiClient", return_value=api
    ), patch.object(bea, "upload_jsonl", side_effect=lambda k, ls: uploaded_keys.append(k)):
        env = ActivityEnvironment()
        out = await env.run(
            bea.fetch_batch_embed_results,
            {
                "handle": {
                    "provider_batch_name": "batches/x",
                    "submitted_at": 0.0,
                    "input_count": 3,
                },
                "batch_id": "row-id",
                "output_s3_key": "embeddings/batch/run-1/output.jsonl",
            },
        )
    # Post-review: vectors no longer cross the Temporal boundary — they
    # live in the S3 JSONL sidecar referenced by output_s3_key.
    assert out["output_s3_key"] == "embeddings/batch/run-1/output.jsonl"
    assert out["success_count"] == 2
    assert out["failure_count"] == 1
    assert uploaded_keys == ["embeddings/batch/run-1/output.jsonl"]
    call = api.update_embedding_batch.await_args
    assert call.kwargs["state"] == "succeeded"
    assert call.kwargs["success_count"] == 2
    assert call.kwargs["failure_count"] == 1
    assert call.kwargs["mark_completed"] is True


@pytest.mark.asyncio
async def test_cancel_batch_embed_marks_timeout_even_if_provider_cancel_fails():
    provider = _stub_provider()
    # Simulate a provider that rejects the cancel (already terminal, etc.).
    provider.embed_batch_cancel = AsyncMock(side_effect=RuntimeError("too late"))
    api = _stub_api()
    with patch.object(bea, "get_provider", return_value=provider), patch.object(
        bea, "AgentApiClient", return_value=api
    ):
        env = ActivityEnvironment()
        await env.run(
            bea.cancel_batch_embed,
            {
                "handle": {
                    "provider_batch_name": "batches/x",
                    "submitted_at": 0.0,
                    "input_count": 3,
                },
                "batch_id": "row-id",
                "reason": "poll timeout",
            },
        )
    # Row still flipped to timeout + completed — ops visibility trumps
    # the provider-side failure.
    call = api.update_embedding_batch.await_args
    assert call.kwargs["state"] == "timeout"
    assert call.kwargs["mark_completed"] is True
    assert "poll timeout" in call.kwargs["error"]
