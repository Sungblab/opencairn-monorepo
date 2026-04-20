from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ProviderConfig:
    provider: str
    api_key: str | None
    model: str
    embed_model: str
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

    async def cache_context(self, content: str) -> str | None:
        return None

    async def think(self, prompt: str) -> ThinkingResult | None:
        return None

    async def ground_search(self, query: str) -> SearchResult | None:
        return None

    async def tts(self, text: str, model: str | None = None) -> bytes | None:
        return None

    async def transcribe(self, audio: bytes) -> str | None:
        return None
