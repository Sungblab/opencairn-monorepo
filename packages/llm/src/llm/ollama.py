from __future__ import annotations

from typing import Any

import httpx

from .base import EmbedInput, LLMProvider, ProviderConfig

OLLAMA_DEFAULT_URL = "http://localhost:11434"


class OllamaProvider(LLMProvider):
    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._base = (config.base_url or OLLAMA_DEFAULT_URL).rstrip("/")
        # Single shared client — ingest embeds thousands of chunks per doc,
        # so a new AsyncClient per call would burn TLS handshakes + FDs.
        # `connect` is short; `read` is long to cover CPU-bound local generates.
        self._http = httpx.AsyncClient(
            base_url=self._base,
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0),
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def generate(self, messages: list[dict], **kwargs) -> str:
        response = await self._http.post(
            "/api/chat",
            json={
                "model": self.config.model,
                "messages": messages,
                "stream": False,
            },
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        # Ollama's embed endpoint is text-only. Fail loudly rather than
        # silently padding image/audio/pdf inputs with empty strings.
        for inp in inputs:
            if inp.image_bytes or inp.audio_bytes or inp.pdf_bytes:
                raise NotImplementedError(
                    "OllamaProvider.embed supports text only; "
                    "route multimodal inputs through GeminiProvider or ingest."
                )
        texts = [inp.text or "" for inp in inputs]
        response = await self._http.post(
            "/api/embed",
            json={"model": self.config.embed_model, "input": texts},
        )
        response.raise_for_status()
        return response.json()["embeddings"]

    def build_tool_declarations(self, tools: list[Any]) -> list[dict[str, Any]]:
        # Lazy import keeps packages/llm free of a module-load dependency
        # on the agent runtime; the concrete type is runtime.tools.Tool.
        from runtime.tool_declarations import build_ollama_declarations

        return build_ollama_declarations(tools)
