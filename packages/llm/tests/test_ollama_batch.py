"""Ollama is a no-op on the batch surface; callers must see
:class:`BatchNotSupported` so the fallback path can take over cleanly.
"""
from __future__ import annotations

import pytest

from llm.base import EmbedInput
from llm.batch_types import BatchEmbedHandle, BatchNotSupported
from llm.ollama import OllamaProvider


@pytest.fixture
def provider(ollama_config):
    return OllamaProvider(ollama_config)


def test_ollama_does_not_support_batch(provider):
    assert provider.supports_batch_embed is False


@pytest.mark.asyncio
async def test_embed_batch_submit_raises(provider):
    with pytest.raises(BatchNotSupported):
        await provider.embed_batch_submit([EmbedInput(text="a")])


@pytest.mark.asyncio
async def test_embed_batch_poll_raises(provider):
    with pytest.raises(BatchNotSupported):
        await provider.embed_batch_poll(
            BatchEmbedHandle(
                provider_batch_name="batches/x",
                submitted_at=0.0,
                input_count=1,
            )
        )


@pytest.mark.asyncio
async def test_embed_batch_fetch_raises(provider):
    with pytest.raises(BatchNotSupported):
        await provider.embed_batch_fetch(
            BatchEmbedHandle(
                provider_batch_name="batches/x",
                submitted_at=0.0,
                input_count=1,
            )
        )


@pytest.mark.asyncio
async def test_embed_batch_cancel_raises(provider):
    with pytest.raises(BatchNotSupported):
        await provider.embed_batch_cancel(
            BatchEmbedHandle(
                provider_batch_name="batches/x",
                submitted_at=0.0,
                input_count=1,
            )
        )
