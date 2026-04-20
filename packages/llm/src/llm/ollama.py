from __future__ import annotations

import httpx

from .base import EmbedInput, LLMProvider, ProviderConfig

OLLAMA_DEFAULT_URL = "http://localhost:11434"


class OllamaProvider(LLMProvider):
    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._base = (config.base_url or OLLAMA_DEFAULT_URL).rstrip("/")

    async def generate(self, messages: list[dict], **kwargs) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base}/api/chat",
                json={
                    "model": self.config.model,
                    "messages": messages,
                    "stream": False,
                },
                timeout=120,
            )
            response.raise_for_status()
            return response.json()["message"]["content"]

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        texts = [inp.text or "" for inp in inputs]
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base}/api/embed",
                json={"model": self.config.embed_model, "input": texts},
                timeout=60,
            )
            response.raise_for_status()
            return response.json()["embeddings"]
