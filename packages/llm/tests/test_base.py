import pytest
from llm.base import (
    ProviderConfig,
    EmbedInput,
    ThinkingResult,
    SearchResult,
    LLMProvider,
)


def test_provider_config_gemini():
    config = ProviderConfig(
        provider="gemini",
        api_key="key",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-001",
    )
    assert config.provider == "gemini"
    assert config.base_url is None


def test_provider_config_ollama_requires_base_url():
    config = ProviderConfig(
        provider="ollama",
        api_key=None,
        model="llama3",
        embed_model="nomic-embed-text",
        base_url="http://localhost:11434",
    )
    assert config.base_url == "http://localhost:11434"


def test_embed_input_text_only():
    inp = EmbedInput(text="hello world")
    assert inp.text == "hello world"
    assert inp.image_bytes is None


def test_thinking_result():
    result = ThinkingResult(thinking="step 1...", final_answer="answer")
    assert result.final_answer == "answer"


def test_search_result():
    result = SearchResult(
        answer="Paris",
        sources=[{"title": "Wiki", "url": "https://en.wikipedia.org"}],
    )
    assert result.answer == "Paris"
    assert len(result.sources) == 1


class ConcreteProvider(LLMProvider):
    async def generate(self, messages, **kwargs):
        return "ok"

    async def embed(self, inputs):
        return [[0.1] * 3]


@pytest.mark.asyncio
async def test_base_defaults_return_none():
    p = ConcreteProvider(
        ProviderConfig(
            provider="ollama",
            api_key=None,
            model="llama3",
            embed_model="nomic-embed-text",
        )
    )
    assert await p.cache_context("content") is None
    assert await p.think("prompt") is None
    assert await p.ground_search("query") is None
    assert await p.tts("text") is None
    assert await p.transcribe(b"audio") is None
    assert (
        await p.generate_multimodal(
            "describe", image_bytes=b"x", image_mime="image/png"
        )
        is None
    )


class _StubProvider(LLMProvider):
    async def generate(self, messages, **kwargs):
        return ""

    async def embed(self, inputs):
        return []


@pytest.mark.asyncio
async def test_start_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        await p.start_interaction(input="x", agent="deep-research-preview-04-2026")


@pytest.mark.asyncio
async def test_get_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        await p.get_interaction("int_1")


@pytest.mark.asyncio
async def test_stream_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        async for _ in p.stream_interaction("int_1"):
            pass


@pytest.mark.asyncio
async def test_cancel_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        await p.cancel_interaction("int_1")
