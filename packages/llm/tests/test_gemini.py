import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from llm.gemini import GeminiProvider
from llm.base import EmbedInput


@pytest.fixture
def provider(gemini_config):
    return GeminiProvider(gemini_config)


@pytest.mark.asyncio
async def test_generate_returns_text(provider):
    mock_response = MagicMock()
    mock_response.text = "Hello, world!"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ):
        result = await provider.generate([{"role": "user", "content": "hi"}])
    assert result == "Hello, world!"


@pytest.mark.asyncio
async def test_embed_text_only(provider):
    mock_response = MagicMock()
    mock_response.embeddings = [MagicMock(values=[0.1, 0.2, 0.3])]
    with patch.object(
        provider._client.aio.models,
        "embed_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        result = await provider.embed([EmbedInput(text="hello")])
    assert result == [[0.1, 0.2, 0.3]]
    # contents must be a plain list[str], not list[Part]
    assert mocked.await_args.kwargs["contents"] == ["hello"]


@pytest.mark.asyncio
async def test_embed_empty_when_no_text(provider):
    # Non-text EmbedInputs are dropped — Gemini's embed endpoint is text-only.
    with patch.object(
        provider._client.aio.models,
        "embed_content",
        new=AsyncMock(),
    ) as mocked:
        result = await provider.embed([EmbedInput(image_bytes=b"x")])
    assert result == []
    mocked.assert_not_awaited()


@pytest.mark.asyncio
async def test_think_returns_thinking_result(provider):
    mock_response = MagicMock()
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].content.parts = [
        MagicMock(thought=True, text="step 1"),
        MagicMock(thought=False, text="final answer"),
    ]
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ):
        result = await provider.think("what is 2+2?")
    assert result is not None
    assert result.final_answer == "final answer"
    assert result.thinking == "step 1"


@pytest.mark.asyncio
async def test_cache_context_wraps_in_config(provider):
    # Must pass options via CreateCachedContentConfig, not top-level kwargs.
    from google.genai import types

    mock_cache = MagicMock()
    mock_cache.name = "cachedContents/abc"
    with patch.object(
        provider._client.aio.caches,
        "create",
        new=AsyncMock(return_value=mock_cache),
    ) as mocked:
        result = await provider.cache_context("long system prompt", ttl="3600s")
    assert result == "cachedContents/abc"
    kwargs = mocked.await_args.kwargs
    assert "contents" not in kwargs, "contents must be nested under config"
    assert isinstance(kwargs["config"], types.CreateCachedContentConfig)


@pytest.mark.asyncio
async def test_tts_returns_bytes(provider):
    # Real Gemini TTS response may lead with a text part before the audio
    # blob — we iterate parts, not blindly index [0].
    mock_response = MagicMock()
    text_part = MagicMock(inline_data=None)
    audio_part = MagicMock()
    audio_part.inline_data.data = b"audio-bytes"
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].content.parts = [text_part, audio_part]
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ):
        result = await provider.tts("Hello")
    assert result == b"audio-bytes"


@pytest.mark.asyncio
async def test_transcribe_returns_text(provider):
    mock_response = MagicMock()
    mock_response.text = "transcribed text"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ):
        result = await provider.transcribe(b"audio-data")
    assert result == "transcribed text"


@pytest.mark.asyncio
async def test_generate_multimodal_image_sends_inline_data(provider):
    from google.genai import types

    mock_response = MagicMock()
    mock_response.text = "a cat on a desk"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        result = await provider.generate_multimodal(
            "Describe this image.",
            image_bytes=b"\x89PNG\r\n",
            image_mime="image/png",
        )
    assert result == "a cat on a desk"
    parts = mocked.await_args.kwargs["contents"]
    # Must include an inline_data Part carrying the image mime + bytes.
    image_part = next(
        (p for p in parts if isinstance(p, types.Part) and p.inline_data),
        None,
    )
    assert image_part is not None
    assert image_part.inline_data.mime_type == "image/png"
    assert image_part.inline_data.data == b"\x89PNG\r\n"
    # Prompt part comes after the image part.
    assert parts[-1].text == "Describe this image."


@pytest.mark.asyncio
async def test_generate_multimodal_image_requires_mime(provider):
    # Bytes without mime is ambiguous; return None rather than guessing.
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(),
    ) as mocked:
        result = await provider.generate_multimodal(
            "describe", image_bytes=b"x", image_mime=None
        )
    assert result is None
    mocked.assert_not_awaited()


@pytest.mark.asyncio
async def test_generate_multimodal_pdf_sends_pdf_mime(provider):
    from google.genai import types

    mock_response = MagicMock()
    mock_response.text = "pdf summary"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        result = await provider.generate_multimodal(
            "Summarise.",
            pdf_bytes=b"%PDF-1.4 fake",
        )
    assert result == "pdf summary"
    parts = mocked.await_args.kwargs["contents"]
    pdf_part = next(
        (p for p in parts if isinstance(p, types.Part) and p.inline_data),
        None,
    )
    assert pdf_part is not None
    assert pdf_part.inline_data.mime_type == "application/pdf"
