import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from llm.base import EmbedInput
from llm.gemini import GEMINI_MODELS, GeminiProvider, _normalise_embed_task_type


@pytest.fixture
def provider(gemini_config):
    return GeminiProvider(gemini_config)


def test_flash_lite_alias_uses_stable_model():
    assert GEMINI_MODELS["flash_lite"] == "gemini-3.1-flash-lite"


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
        await provider.generate(
            [
                {"role": "system", "content": "Be terse."},
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ]
        )
    kwargs = mocked.await_args.kwargs
    assert [c.role for c in kwargs["contents"]] == ["user", "model"]
    config = kwargs["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.system_instruction == "Be terse."


@pytest.mark.asyncio
async def test_generate_forwards_configured_service_tier(gemini_config):
    gemini_config.service_tier = "priority"
    provider = GeminiProvider(gemini_config)
    mock_response = MagicMock()
    mock_response.text = "Hello, world!"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.generate([{"role": "user", "content": "hi"}])
    config = mocked.await_args.kwargs["config"]
    assert config.service_tier == "priority"


@pytest.mark.asyncio
async def test_generate_call_service_tier_overrides_config(gemini_config):
    gemini_config.service_tier = "flex"
    provider = GeminiProvider(gemini_config)
    mock_response = MagicMock()
    mock_response.text = "Hello, world!"
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.generate(
            [{"role": "user", "content": "hi"}],
            service_tier="priority",
        )
    config = mocked.await_args.kwargs["config"]
    assert config.service_tier == "priority"


def test_gemini_provider_rejects_invalid_service_tier(gemini_config):
    gemini_config.service_tier = "turbo"  # type: ignore[assignment]
    with pytest.raises(ValueError, match="Invalid Gemini service tier"):
        GeminiProvider(gemini_config)


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
async def test_embed_forwards_vector_dim_as_output_dimensionality(provider, monkeypatch):
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
        await provider.embed(
            [EmbedInput(text="hello", task="retrieval_document", title="Note title")]
        )
    assert mocked.await_args.kwargs["config"].title == "Note title"
    assert mocked.await_args.kwargs["config"].task_type == "RETRIEVAL_DOCUMENT"


def test_embed_task_type_normalises_legacy_lowercase_values():
    assert _normalise_embed_task_type("retrieval_document") == "RETRIEVAL_DOCUMENT"
    assert _normalise_embed_task_type("retrieval_query") == "RETRIEVAL_QUERY"
    assert _normalise_embed_task_type("RETRIEVAL_QUERY") == "RETRIEVAL_QUERY"


@pytest.mark.asyncio
async def test_embed_gemini_embedding_2_uses_task_prefix_not_task_type(provider, monkeypatch):
    from google.genai import types

    provider.config.embed_model = "gemini-embedding-2"
    monkeypatch.setenv("VECTOR_DIM", "768")
    mock_response = MagicMock()
    mock_response.embeddings = [MagicMock(values=[0.1] * 768)]
    with patch.object(
        provider._client.aio.models,
        "embed_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.embed([EmbedInput(text="hello", task="retrieval_query")])
    contents = mocked.await_args.kwargs["contents"]
    assert isinstance(contents[0], types.Content)
    assert contents[0].parts[0].text == "task: search result | query: hello"
    config = mocked.await_args.kwargs["config"]
    assert config.output_dimensionality == 768
    assert config.task_type is None
    assert config.title is None


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
async def test_think_forwards_service_tier(gemini_config):
    gemini_config.service_tier = "flex"
    provider = GeminiProvider(gemini_config)
    mock_response = MagicMock()
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].content.parts = [
        MagicMock(thought=False, text="final"),
    ]
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.think("what is 2+2?")
    config = mocked.await_args.kwargs["config"]
    assert config.service_tier == "flex"


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
    assert result is not None
    assert result.text == "transcribed text"
    assert result.provider == "gemini"
    assert result.model == provider.config.model
    assert result.segments == []


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
        result = await provider.generate_multimodal("describe", image_bytes=b"x", image_mime=None)
    assert result is None
    mocked.assert_not_awaited()


@pytest.mark.asyncio
async def test_generate_image_returns_inline_image_bytes(provider):
    from google.genai import types

    image_part = MagicMock()
    image_part.text = None
    image_part.inline_data = MagicMock(data=b"\x89PNG\r\nimage", mime_type="image/png")
    mock_response = MagicMock()
    mock_response.parts = [MagicMock(text="metadata"), image_part]
    with patch.object(
        provider._client.aio.models,
        "generate_content",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        result = await provider.generate_image("draw a source-aware figure")

    assert result is not None
    assert result.image_bytes.startswith(b"\x89PNG")
    assert result.mime_type == "image/png"
    assert result.model == "gemini-2.5-flash-image"
    assert result.text == "metadata"
    assert mocked.await_args.kwargs["model"] == "gemini-2.5-flash-image"
    config = mocked.await_args.kwargs["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.response_modalities == ["TEXT", "IMAGE"]


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


@pytest.mark.asyncio
async def test_start_interaction_forwards_service_tier(gemini_config):
    gemini_config.service_tier = "priority"
    provider = GeminiProvider(gemini_config)
    mock_interaction = MagicMock()
    mock_interaction.id = "interactions/1"
    mock_interaction.agent = "deep-research"
    mock_interaction.background = True
    with patch.object(
        provider._client.aio.interactions,
        "create",
        new=AsyncMock(return_value=mock_interaction),
    ) as mocked:
        await provider.start_interaction(
            input="research this",
            agent="deep-research",
            background=True,
        )
    assert mocked.await_args.kwargs["service_tier"] == "priority"
