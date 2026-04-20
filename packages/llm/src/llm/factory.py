from __future__ import annotations

import os

from .base import LLMProvider, ProviderConfig
from .gemini import GeminiProvider
from .ollama import OllamaProvider


def get_provider(config: ProviderConfig | None = None) -> LLMProvider:
    if config is None:
        config = ProviderConfig(
            provider=os.environ["LLM_PROVIDER"],
            api_key=os.getenv("LLM_API_KEY"),
            model=os.environ["LLM_MODEL"],
            embed_model=os.environ["EMBED_MODEL"],
            tts_model=os.getenv("TTS_MODEL"),
            base_url=os.getenv("OLLAMA_BASE_URL"),
        )
    match config.provider:
        case "gemini":
            return GeminiProvider(config)
        case "ollama":
            return OllamaProvider(config)
        case _:
            raise ValueError(f"Unknown provider: {config.provider}")
