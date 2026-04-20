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
async def test_embed_rejects_non_text_inputs(provider):
    with pytest.raises(NotImplementedError, match="text only"):
        await provider.embed([EmbedInput(image_bytes=b"x")])


@pytest.mark.asyncio
async def test_premium_features_return_none(provider):
    assert await provider.think("prompt") is None
    assert await provider.tts("text") is None
    assert await provider.transcribe(b"audio") is None
    assert await provider.cache_context("content") is None
    assert await provider.ground_search("query") is None


@pytest.mark.asyncio
async def test_generate_multimodal_sends_base64_images(provider, monkeypatch):
    import base64

    # Pin the vision model so the assertion doesn't depend on config defaults.
    monkeypatch.setenv("OLLAMA_VISION_MODEL", "llava")
    captured: dict = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        import json

        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, json={"response": "a chart of Q1 revenue"})

    with respx.mock:
        respx.post("http://localhost:11434/api/generate").mock(side_effect=_capture)
        result = await provider.generate_multimodal(
            "Describe this image.",
            image_bytes=b"\x89PNG\r\n",
            image_mime="image/png",
        )
    assert result == "a chart of Q1 revenue"
    assert captured["payload"]["model"] == "llava"
    assert captured["payload"]["images"] == [
        base64.b64encode(b"\x89PNG\r\n").decode()
    ]
    assert captured["payload"]["stream"] is False


@pytest.mark.asyncio
async def test_generate_multimodal_pdf_returns_none(provider):
    # Ollama has no native PDF handling — short-circuit without hitting HTTP.
    with respx.mock(assert_all_called=False) as router:
        route = router.post("http://localhost:11434/api/generate")
        result = await provider.generate_multimodal(
            "Summarise.", pdf_bytes=b"%PDF"
        )
    assert result is None
    assert not route.called


@pytest.mark.asyncio
async def test_generate_multimodal_no_input_returns_none(provider):
    with respx.mock(assert_all_called=False) as router:
        route = router.post("http://localhost:11434/api/generate")
        result = await provider.generate_multimodal("no image")
    assert result is None
    assert not route.called
