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
async def test_generate_maps_system_messages_to_system_instruction(provider):
    from google.genai import types

    mock_response = MagicMock()
    mock_response.text = "Hello, world!"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.generate([
            {"role": "system", "content": "Be terse."},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ])
    kwargs = mocked.await_args.kwargs
    assert [c.role for c in kwargs["contents"]] == ["user", "model"]
    config = kwargs["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.system_instruction == "Be terse."


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
async def test_embed_forwards_vector_dim_as_output_dimensionality(
    provider, monkeypatch
):
    # gemini-embedding-001은 3072 native지만 MRL로 앞 N dim을 잘라 쓸 수 있음.
    # VECTOR_DIM 환경변수를 EmbedContentConfig.output_dimensionality로 전달해
    # 저장할 pgvector 컬럼 폭(768 기본)에 맞춰야 ADR-005 정책대로 동작.
    from google.genai import types

    monkeypatch.setenv("VECTOR_DIM", "768")
    mock_response = MagicMock()
    mock_response.embeddings = [MagicMock(values=[0.1] * 768)]
    with patch.object(
        provider._client.aio.models,
        "embed_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.embed([EmbedInput(text="hello")])
    config = mocked.await_args.kwargs["config"]
    assert isinstance(config, types.EmbedContentConfig)
    assert config.output_dimensionality == 768


@pytest.mark.asyncio
async def test_embed_forwards_single_document_title(provider):
    mock_response = MagicMock()
    mock_response.embeddings = [MagicMock(values=[0.1, 0.2, 0.3])]
    with patch.object(
        provider._client.aio.models,
        "embed_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.embed([
            EmbedInput(text="hello", task="retrieval_document", title="Note title")
        ])
    assert mocked.await_args.kwargs["config"].title == "Note title"


@pytest.mark.asyncio
async def test_embed_skips_output_dim_when_env_unset(provider, monkeypatch):
    # VECTOR_DIM 미설정 시 native 차원(3072) 유지 — 명시적으로 API에 안 보냄.
    monkeypatch.delenv("VECTOR_DIM", raising=False)
    mock_response = MagicMock()
    mock_response.embeddings = [MagicMock(values=[0.1] * 3072)]
    with patch.object(
        provider._client.aio.models,
        "embed_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.embed([EmbedInput(text="hello")])
    config = mocked.await_args.kwargs["config"]
    assert config.output_dimensionality is None


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
async def test_think_accepts_gemini3_thinking_level(provider):
    mock_response = MagicMock()
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].content.parts = [
        MagicMock(thought=True, text="step"),
        MagicMock(thought=False, text="final"),
    ]
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.think("what is 2+2?", thinking_level="low")
    config = mocked.await_args.kwargs["config"]
    assert config.thinking_config.thinking_level == "LOW"


@pytest.mark.asyncio
async def test_think_rejects_mixed_budget_and_level(provider):
    with pytest.raises(ValueError, match="mutually exclusive"):
        await provider.think("what is 2+2?", thinking_level="low", thinking_budget=128)


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


@pytest.mark.asyncio
async def test_ocr_sends_image_inline_data_and_returns_text(provider):
    """Gemini OCR must inline image bytes + a text prompt, return response.text."""
    from google.genai import types

    mock_response = MagicMock()
    mock_response.text = "Page 1 line one\nPage 1 line two"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        result = await provider.ocr(b"\x89PNG\r\nfake", mime_type="image/png")
    assert result == "Page 1 line one\nPage 1 line two"
    parts = mocked.await_args.kwargs["contents"]
    image_part = next(
        (p for p in parts if isinstance(p, types.Part) and p.inline_data),
        None,
    )
    assert image_part is not None
    assert image_part.inline_data.mime_type == "image/png"
    assert image_part.inline_data.data == b"\x89PNG\r\nfake"
    text_part = next(
        (p for p in parts if isinstance(p, types.Part) and getattr(p, "text", None)),
        None,
    )
    assert text_part is not None
    # Must instruct extraction-only output (no commentary, no summarisation).
    assert "extract" in text_part.text.lower()


def test_gemini_supports_ocr_true(provider):
    assert provider.supports_ocr() is True
