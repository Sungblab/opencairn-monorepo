import pytest
import respx
import httpx
from llm.ollama import OllamaProvider
from llm.base import EmbedInput


@pytest.fixture
def provider(ollama_config):
    return OllamaProvider(ollama_config)


@pytest.mark.asyncio
async def test_generate_returns_text(provider):
    with respx.mock:
        respx.post("http://localhost:11434/api/chat").mock(
            return_value=httpx.Response(
                200,
                json={"message": {"role": "assistant", "content": "Hello from Ollama"}},
            )
        )
        result = await provider.generate([{"role": "user", "content": "hi"}])
    assert result == "Hello from Ollama"


@pytest.mark.asyncio
async def test_embed_returns_vectors(provider):
    with respx.mock:
        respx.post("http://localhost:11434/api/embed").mock(
            return_value=httpx.Response(
                200,
                json={"embeddings": [[0.1, 0.2, 0.3]]},
            )
        )
        result = await provider.embed([EmbedInput(text="hello")])
    assert result == [[0.1, 0.2, 0.3]]


@pytest.mark.asyncio
async def test_premium_features_return_none(provider):
    assert await provider.think("prompt") is None
    assert await provider.tts("text") is None
    assert await provider.transcribe(b"audio") is None
    assert await provider.cache_context("content") is None
    assert await provider.ground_search("query") is None
