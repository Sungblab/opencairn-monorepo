from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, Literal, Sequence

from pydantic import BaseModel

from .batch_types import (
    BatchEmbedHandle,
    BatchEmbedPoll,
    BatchEmbedResult,
    BatchNotSupported,
)
from .interactions import InteractionEvent, InteractionHandle, InteractionState
from .tool_types import ToolResult


@dataclass
class ProviderConfig:
    provider: str
    api_key: str | None = field(default=None, repr=False)  # never leak keys via repr/logs
    model: str = ""
    embed_model: str = ""
    tts_model: str | None = None
    base_url: str | None = None
    service_tier: Literal["standard", "flex", "priority"] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmbedInput:
    text: str | None = None
    image_bytes: bytes | None = None
    audio_bytes: bytes | None = None
    pdf_bytes: bytes | None = None
    task: str = "retrieval_document"
    title: str | None = None


@dataclass
class ThinkingResult:
    thinking: str
    final_answer: str


@dataclass
class SearchResult:
    answer: str
    sources: list[dict[str, str]]


@dataclass
class TranscriptionSegment:
    index: int
    start_sec: float
    end_sec: float
    text: str
    speaker: str | None = None
    language: str | None = None
    confidence: float | None = None


@dataclass
class TranscriptionResult:
    text: str
    provider: str
    model: str
    segments: list[TranscriptionSegment] = field(default_factory=list)


@dataclass
class ImageGenerationResult:
    image_bytes: bytes
    mime_type: str
    model: str
    text: str | None = None


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

    async def transcribe(self, audio: bytes) -> TranscriptionResult | str | None:
        return None

    def supports_ocr(self) -> bool:
        """True if the provider can extract text from a rendered page image.

        Used by ingest to decide whether scan PDFs (no embedded text layer)
        can be processed at all — Ollama returns False so the worker can
        surface a clear error instead of silently producing empty notes.
        """
        return False

    async def ocr(self, image_bytes: bytes, mime_type: str = "image/png") -> str:
        """Extract text from a single page image (스캔 PDF / 이미지 텍스트 추출).

        Providers that support vision OCR override this. The default raises
        ``NotImplementedError`` so scan-PDF callers fail fast instead of
        receiving an empty string they'd interpret as "no text on page".
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support OCR"
        )

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

    async def generate_image(
        self,
        prompt: str,
        *,
        model: str | None = None,
    ) -> ImageGenerationResult | None:
        """Generate an image from text.

        Providers return ``None`` when image generation is not supported or not
        configured. Callers decide whether to surface that as an error or use a
        deterministic renderer.
        """
        return None

    # --- Interactions API (Deep Research) -------------------------------
    # Providers that support Google's Interactions API (Gemini) override
    # these. The default raises NotImplementedError so callers can ``try``
    # the call and fall back to UI-layer gating ("Gemini 키가 필요합니다").

    async def start_interaction(
        self,
        *,
        input: str,
        agent: str,
        collaborative_planning: bool = False,
        background: bool = False,
        previous_interaction_id: str | None = None,
        thinking_summaries: Literal["auto", "none"] | None = None,
        visualization: Literal["auto", "off"] | None = None,
    ) -> InteractionHandle:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )

    async def get_interaction(self, interaction_id: str) -> InteractionState:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )

    async def stream_interaction(
        self,
        interaction_id: str,
        *,
        last_event_id: str | None = None,
    ) -> AsyncGenerator[InteractionEvent, None]:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )
        # Unreachable but required so the function is an async generator.
        if False:  # pragma: no cover
            yield  # type: ignore[unreachable]

    async def cancel_interaction(self, interaction_id: str) -> None:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )

    # Providers that support tool calling override this. The `tools` list is
    # typed loosely (`list[Any]`) because `packages/llm` must not import the
    # agent runtime at module load time — the concrete type is
    # `list[runtime.tools.Tool]` but that import happens inside the subclass.
    def build_tool_declarations(self, tools: list[Any]) -> list[dict[str, Any]]:
        """Return tool schemas in this provider's expected format."""
        raise NotImplementedError(
            f"{type(self).__name__} does not support tool calling"
        )

    # ── Tool-calling surface (Plan Agent Runtime v2 · A) ────────────────
    #
    # Providers that support tool calling override `supports_tool_calling`
    # to return True and implement `generate_with_tools` +
    # `tool_result_to_message`. The default raises so callers fail fast
    # when provisioned against a provider that does not support tools
    # (e.g. LLM_PROVIDER=ollama in A).
    #
    # Type of `messages` is intentionally `list` — each provider uses its
    # own native message type, and ToolLoopExecutor treats them as opaque
    # to preserve provider-specific metadata such as Gemini 3 thought
    # signatures.

    def supports_tool_calling(self) -> bool:
        return False

    def supports_parallel_tool_calling(self) -> bool:
        return False

    async def generate_with_tools(
        self,
        messages: list,
        tools: list,
        *,
        mode: Literal["auto", "any", "none"] = "auto",
        allowed_tool_names: Sequence[str] | None = None,
        final_response_schema: type[BaseModel] | None = None,
        cached_context_id: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
    ):
        raise NotImplementedError(
            f"{type(self).__name__} does not implement generate_with_tools"
        )

    def tool_result_to_message(self, result: ToolResult):
        raise NotImplementedError(
            f"{type(self).__name__} does not implement tool_result_to_message"
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
