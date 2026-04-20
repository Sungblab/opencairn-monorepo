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
async def test_tts_returns_bytes(provider):
    # Real Gemini TTS response path: candidates[0].content.parts[0].inline_data.data
    mock_response = MagicMock()
    part = MagicMock()
    part.inline_data.data = b"audio-bytes"
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].content.parts = [part]
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
