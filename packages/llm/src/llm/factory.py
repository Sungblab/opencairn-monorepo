from __future__ import annotations

import os

from .base import LLMProvider, ProviderConfig
from .gemini import GeminiProvider
from .ollama import OllamaProvider


REQUIRED_ENV = ("LLM_PROVIDER", "LLM_MODEL", "EMBED_MODEL")


def get_provider(config: ProviderConfig | None = None) -> LLMProvider:
    if config is None:
        missing = [k for k in REQUIRED_ENV if not os.getenv(k)]
        if missing:
            raise RuntimeError(
                f"Missing required env vars: {', '.join(missing)}. "
                "Expected LLM_PROVIDER=gemini|ollama, LLM_MODEL, EMBED_MODEL. "
                "See .env.example."
            )
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
