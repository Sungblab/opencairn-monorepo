from __future__ import annotations

import base64
import os
from typing import Any

import httpx

from .base import EmbedInput, LLMProvider, ProviderConfig
from .errors import ToolCallingNotSupported

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

    async def generate_multimodal(
        self,
        prompt: str,
        *,
        image_bytes: bytes | None = None,
        image_mime: str | None = None,
        pdf_bytes: bytes | None = None,
    ) -> str | None:
        """Image-grounded generation via an Ollama vision model.

        Ollama's ``/api/generate`` accepts an ``images`` array of base64
        strings and has no native PDF handler — so PDFs short-circuit to
        ``None`` for the ingest pipeline to fall back to another path.

        The vision model is chosen from ``OLLAMA_VISION_MODEL`` if set,
        otherwise we reuse ``config.model``; when the configured model has
        no vision head, Ollama returns an empty/garbled string, which is
        still preferable to a hard failure inside a Temporal activity.
        """
        if pdf_bytes or not image_bytes:
            return None
        vision_model = os.environ.get("OLLAMA_VISION_MODEL", self.config.model)
        response = await self._http.post(
            "/api/generate",
            json={
                "model": vision_model,
                "prompt": prompt,
                "images": [base64.b64encode(image_bytes).decode()],
                "stream": False,
            },
        )
        response.raise_for_status()
        return response.json().get("response")

    def build_tool_declarations(self, tools: list[Any]) -> list[dict[str, Any]]:
        # Lazy import keeps packages/llm free of a module-load dependency
        # on the agent runtime; the concrete type is runtime.tools.Tool.
        from runtime.tool_declarations import build_ollama_declarations

        return build_ollama_declarations(tools)

    # Ollama tool calling is deferred to a later sub-project. The stub
    # raises an explicit error so callers that route an agent requiring
    # tools to LLM_PROVIDER=ollama fail fast with a useful message
    # instead of silently returning no tool calls.

    def supports_tool_calling(self) -> bool:
        return False

    async def generate_with_tools(self, *args, **kwargs):
        raise ToolCallingNotSupported(
            "OllamaProvider.generate_with_tools is not implemented yet. "
            "Set LLM_PROVIDER=gemini or implement this method."
        )

    def tool_result_to_message(self, result):
        raise ToolCallingNotSupported(
            "OllamaProvider.tool_result_to_message is not implemented yet."
        )
