from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from .batch_types import (
    BatchEmbedHandle,
    BatchEmbedPoll,
    BatchEmbedResult,
    BatchNotSupported,
)


@dataclass
class ProviderConfig:
    provider: str
    api_key: str | None = field(default=None, repr=False)  # never leak keys via repr/logs
    model: str = ""
    embed_model: str = ""
    tts_model: str | None = None
    base_url: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmbedInput:
    text: str | None = None
    image_bytes: bytes | None = None
    audio_bytes: bytes | None = None
    pdf_bytes: bytes | None = None
    task: str = "retrieval_document"


@dataclass
class ThinkingResult:
    thinking: str
    final_answer: str


@dataclass
class SearchResult:
    answer: str
    sources: list[dict[str, str]]


class LLMProvider(ABC):
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def generate(self, messages: list[dict], **kwargs) -> str: ...

    @abstractmethod
    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]: ...

    async def cache_context(self, content: str, ttl: str | None = None) -> str | None:
        return None

    async def think(self, prompt: str) -> ThinkingResult | None:
        return None

    async def ground_search(self, query: str) -> SearchResult | None:
        return None

    async def tts(self, text: str, model: str | None = None) -> bytes | None:
        return None

    async def transcribe(self, audio: bytes) -> str | None:
        return None

    async def generate_multimodal(
        self,
        prompt: str,
        *,
        image_bytes: bytes | None = None,
        image_mime: str | None = None,
        pdf_bytes: bytes | None = None,
    ) -> str | None:
        """Multimodal generation with an image or PDF attached.

        Returns None if the provider doesn't support the requested modality.
        Providers must override to opt in. Exactly one of image_bytes / pdf_bytes
        should be set — behavior when both are set is provider-defined.
        """
        return None

    # Providers that support tool calling override this. The `tools` list is
    # typed loosely (`list[Any]`) because `packages/llm` must not import the
    # agent runtime at module load time — the concrete type is
    # `list[runtime.tools.Tool]` but that import happens inside the subclass.
    def build_tool_declarations(self, tools: list[Any]) -> list[dict[str, Any]]:
        """Return tool schemas in this provider's expected format."""
        raise NotImplementedError(
            f"{type(self).__name__} does not support tool calling"
        )

    # ── Batch embedding surface (Plan 3b) ────────────────────────────────
    # Providers that support async batch embedding override these. The
    # default behaviour raises :class:`BatchNotSupported` so callers can
    # catch once and fall back to the synchronous ``embed()`` path.
    #
    # Lifecycle: submit → poll (until done) → fetch. ``cancel`` is best-
    # effort; providers that can't cancel raise ``BatchNotSupported``.
    @property
    def supports_batch_embed(self) -> bool:
        return False

    async def embed_batch_submit(
        self,
        inputs: list[EmbedInput],
        *,
        display_name: str | None = None,
    ) -> BatchEmbedHandle:
        raise BatchNotSupported(
            f"{type(self).__name__} does not support batch embeddings"
        )

    async def embed_batch_poll(self, handle: BatchEmbedHandle) -> BatchEmbedPoll:
        raise BatchNotSupported(
            f"{type(self).__name__} does not support batch embeddings"
        )

    async def embed_batch_fetch(self, handle: BatchEmbedHandle) -> BatchEmbedResult:
        """Return per-item results. Must only be called after a poll whose
        :attr:`BatchEmbedPoll.done` is ``True`` and ``state`` is succeeded.
        """
        raise BatchNotSupported(
            f"{type(self).__name__} does not support batch embeddings"
        )

    async def embed_batch_cancel(self, handle: BatchEmbedHandle) -> None:
        raise BatchNotSupported(
            f"{type(self).__name__} does not support batch embeddings"
        )
