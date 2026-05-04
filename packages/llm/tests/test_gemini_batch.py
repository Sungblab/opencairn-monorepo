"""Tests for the Plan 3b batch embedding surface on :class:`GeminiProvider`.

Mocks ``client.aio.batches.*`` at the SDK boundary so we validate shape
transformations (JobState → normalised state, inlined responses → aligned
vectors with ``None`` on per-item error) without hitting the network.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.genai import types

from llm.base import EmbedInput
from llm.batch_types import (
    BATCH_STATE_CANCELLED,
    BATCH_STATE_EXPIRED,
    BATCH_STATE_FAILED,
    BATCH_STATE_PENDING,
    BATCH_STATE_RUNNING,
    BATCH_STATE_SUCCEEDED,
)
from llm.gemini import GeminiProvider, _normalise_state


@pytest.fixture
def provider(gemini_config):
    return GeminiProvider(gemini_config)


# ── state normalisation ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("JOB_STATE_UNSPECIFIED", BATCH_STATE_PENDING),
        ("JOB_STATE_QUEUED", BATCH_STATE_PENDING),
        ("JOB_STATE_PENDING", BATCH_STATE_PENDING),
        ("JOB_STATE_RUNNING", BATCH_STATE_RUNNING),
        ("JOB_STATE_UPDATING", BATCH_STATE_RUNNING),
        ("JOB_STATE_PAUSED", BATCH_STATE_RUNNING),
        ("JOB_STATE_SUCCEEDED", BATCH_STATE_SUCCEEDED),
        ("JOB_STATE_PARTIALLY_SUCCEEDED", BATCH_STATE_SUCCEEDED),
        ("JOB_STATE_FAILED", BATCH_STATE_FAILED),
        ("JOB_STATE_CANCELLING", BATCH_STATE_CANCELLED),
        ("JOB_STATE_CANCELLED", BATCH_STATE_CANCELLED),
        ("JOB_STATE_EXPIRED", BATCH_STATE_EXPIRED),
    ],
)
def test_normalise_state_from_string(raw, expected):
    assert _normalise_state(raw) == expected


def test_normalise_state_from_enum():
    assert _normalise_state(types.JobState.JOB_STATE_SUCCEEDED) == BATCH_STATE_SUCCEEDED
    assert _normalise_state(types.JobState.JOB_STATE_EXPIRED) == BATCH_STATE_EXPIRED


def test_normalise_state_unknown_falls_back_to_pending():
    # New enum values shipped by the SDK shouldn't break the poll loop —
    # we treat unknowns as "not yet terminal" so the workflow keeps
    # polling rather than crashing.
    assert _normalise_state("JOB_STATE_WHATEVER_NEW") == BATCH_STATE_PENDING
    assert _normalise_state(None) == BATCH_STATE_PENDING


# ── supports_batch_embed ─────────────────────────────────────────────────


def test_gemini_supports_batch_embed(provider):
    assert provider.supports_batch_embed is True


# ── embed_batch_submit ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_embed_batch_submit_returns_handle(provider, monkeypatch):
    monkeypatch.setenv("VECTOR_DIM", "768")
    job = MagicMock()
    job.name = "batches/abc123"
    with patch.object(
        provider._client.aio.batches,
        "create_embeddings",
        new=AsyncMock(return_value=job),
    ) as mocked:
        handle = await provider.embed_batch_submit(
            [EmbedInput(text="a"), EmbedInput(text="b"), EmbedInput(text="c")],
            display_name="test-run",
        )
    assert handle.provider_batch_name == "batches/abc123"
    assert handle.input_count == 3
    assert handle.submitted_at > 0

    # Verify the SDK was called with inlined requests containing our texts
    # and the output dimensionality forwarded from VECTOR_DIM.
    call = mocked.await_args
    src = call.kwargs["src"]
    assert isinstance(src, types.EmbeddingsBatchJobSource)
    assert src.inlined_requests.contents == ["a", "b", "c"]
    assert src.inlined_requests.config.output_dimensionality == 768
    assert src.inlined_requests.config.task_type == "RETRIEVAL_DOCUMENT"
    assert call.kwargs["config"].display_name == "test-run"


@pytest.mark.asyncio
async def test_embed_batch_submit_gemini_embedding_2_uses_content_prefixes(provider, monkeypatch):
    provider.config.embed_model = "gemini-embedding-2"
    monkeypatch.setenv("VECTOR_DIM", "768")
    job = MagicMock()
    job.name = "batches/abc123"
    with patch.object(
        provider._client.aio.batches,
        "create_embeddings",
        new=AsyncMock(return_value=job),
    ) as mocked:
        await provider.embed_batch_submit(
            [
                EmbedInput(text="query", task="retrieval_query"),
                EmbedInput(text="doc", task="retrieval_document", title="Doc title"),
            ]
        )
    src = mocked.await_args.kwargs["src"]
    contents = src.inlined_requests.contents
    assert contents[0].parts[0].text == "task: search result | query: query"
    assert contents[1].parts[0].text == "title: Doc title | text: doc"
    assert src.inlined_requests.config.output_dimensionality == 768
    assert src.inlined_requests.config.task_type is None


@pytest.mark.asyncio
async def test_embed_batch_submit_skips_empty_text(provider):
    # Gemini's batch API rejects empty content; filter client-side and
    # fail fast when nothing is left to send.
    with pytest.raises(ValueError, match="requires at least one text"):
        await provider.embed_batch_submit([EmbedInput(text=None), EmbedInput(text="")])


@pytest.mark.asyncio
async def test_embed_batch_submit_default_display_name(provider):
    job = MagicMock()
    job.name = "batches/xyz"
    with patch.object(
        provider._client.aio.batches,
        "create_embeddings",
        new=AsyncMock(return_value=job),
    ) as mocked:
        await provider.embed_batch_submit([EmbedInput(text="a")])
    cfg = mocked.await_args.kwargs["config"]
    assert cfg.display_name.startswith("opencairn-embed-")


@pytest.mark.asyncio
async def test_embed_batch_submit_raises_on_missing_name(provider):
    # The SDK shouldn't, in practice, return a BatchJob without .name; but
    # if it ever does we want a loud failure rather than a useless handle
    # that the poll loop will spin on forever.
    job = MagicMock()
    job.name = None
    with patch.object(
        provider._client.aio.batches,
        "create_embeddings",
        new=AsyncMock(return_value=job),
    ):
        with pytest.raises(RuntimeError, match="no .name"):
            await provider.embed_batch_submit([EmbedInput(text="a")])


# ── embed_batch_poll ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_embed_batch_poll_running_is_not_done(provider):
    job = MagicMock()
    job.state = types.JobState.JOB_STATE_RUNNING
    job.dest = None
    with patch.object(
        provider._client.aio.batches,
        "get",
        new=AsyncMock(return_value=job),
    ):
        handle = _handle(input_count=3)
        poll = await provider.embed_batch_poll(handle)
    assert poll.state == BATCH_STATE_RUNNING
    assert poll.done is False
    assert poll.request_count == 3
    assert poll.pending_request_count == 3


@pytest.mark.asyncio
async def test_embed_batch_poll_succeeded_counts_success_and_failure(provider):
    job = MagicMock()
    job.state = types.JobState.JOB_STATE_SUCCEEDED
    # Two successes + one error
    r_ok = types.InlinedEmbedContentResponse(
        response=types.SingleEmbedContentResponse(
            embedding=types.ContentEmbedding(values=[0.1, 0.2])
        ),
    )
    r_err = types.InlinedEmbedContentResponse(error=types.JobError(code=13, message="internal"))
    job.dest = types.BatchJobDestination(inlined_embed_content_responses=[r_ok, r_ok, r_err])
    with patch.object(
        provider._client.aio.batches,
        "get",
        new=AsyncMock(return_value=job),
    ):
        poll = await provider.embed_batch_poll(_handle(input_count=3))
    assert poll.state == BATCH_STATE_SUCCEEDED
    assert poll.done is True
    assert poll.successful_request_count == 2
    assert poll.failed_request_count == 1
    assert poll.pending_request_count == 0


@pytest.mark.asyncio
async def test_embed_batch_poll_expired_is_terminal(provider):
    job = MagicMock()
    job.state = types.JobState.JOB_STATE_EXPIRED
    job.dest = None
    with patch.object(
        provider._client.aio.batches,
        "get",
        new=AsyncMock(return_value=job),
    ):
        poll = await provider.embed_batch_poll(_handle(input_count=3))
    assert poll.state == BATCH_STATE_EXPIRED
    assert poll.done is True


# ── embed_batch_fetch ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_embed_batch_fetch_aligns_vectors_and_errors(provider):
    job = MagicMock()
    job.state = types.JobState.JOB_STATE_SUCCEEDED
    r_ok_a = types.InlinedEmbedContentResponse(
        response=types.SingleEmbedContentResponse(
            embedding=types.ContentEmbedding(values=[0.1, 0.2])
        ),
    )
    r_err = types.InlinedEmbedContentResponse(
        error=types.JobError(code=7, message="permission denied")
    )
    r_ok_b = types.InlinedEmbedContentResponse(
        response=types.SingleEmbedContentResponse(
            embedding=types.ContentEmbedding(values=[0.3, 0.4])
        ),
    )
    job.dest = types.BatchJobDestination(inlined_embed_content_responses=[r_ok_a, r_err, r_ok_b])
    with patch.object(
        provider._client.aio.batches,
        "get",
        new=AsyncMock(return_value=job),
    ):
        result = await provider.embed_batch_fetch(_handle(input_count=3))
    assert result.vectors == [[0.1, 0.2], None, [0.3, 0.4]]
    assert result.errors[0] is None
    assert "permission denied" in result.errors[1]
    assert result.errors[2] is None


@pytest.mark.asyncio
async def test_embed_batch_fetch_refuses_unfinished_batch(provider):
    job = MagicMock()
    job.state = types.JobState.JOB_STATE_RUNNING
    with patch.object(
        provider._client.aio.batches,
        "get",
        new=AsyncMock(return_value=job),
    ):
        with pytest.raises(RuntimeError, match="non-succeeded"):
            await provider.embed_batch_fetch(_handle())


@pytest.mark.asyncio
async def test_embed_batch_fetch_flags_empty_response(provider):
    # Defensive: the SDK might return an InlinedEmbedContentResponse whose
    # .response and .error are both None (shouldn't happen, but we'd
    # rather emit a placeholder than KeyError silently).
    job = MagicMock()
    job.state = types.JobState.JOB_STATE_SUCCEEDED
    r_weird = types.InlinedEmbedContentResponse()
    job.dest = types.BatchJobDestination(inlined_embed_content_responses=[r_weird])
    with patch.object(
        provider._client.aio.batches,
        "get",
        new=AsyncMock(return_value=job),
    ):
        result = await provider.embed_batch_fetch(_handle(input_count=1))
    assert result.vectors == [None]
    assert result.errors == ["empty response"]


# ── embed_batch_cancel ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_embed_batch_cancel_delegates(provider):
    with patch.object(
        provider._client.aio.batches,
        "cancel",
        new=AsyncMock(return_value=None),
    ) as mocked:
        await provider.embed_batch_cancel(_handle("batches/doomed"))
    assert mocked.await_args.kwargs["name"] == "batches/doomed"


# ── helpers ──────────────────────────────────────────────────────────────


def _handle(name: str = "batches/test", input_count: int = 1):
    from llm.batch_types import BatchEmbedHandle

    return BatchEmbedHandle(provider_batch_name=name, submitted_at=0.0, input_count=input_count)
