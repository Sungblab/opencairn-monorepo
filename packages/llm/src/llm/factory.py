from __future__ import annotations

import os

from .base import LLMProvider, ProviderConfig
from .gemini import GeminiProvider
from .openai_compatible import OpenAICompatibleProvider
from .ollama import OllamaProvider


REQUIRED_ENV = ("LLM_PROVIDER",)


def get_provider(config: ProviderConfig | None = None) -> LLMProvider:
    if config is None:
        missing = [k for k in REQUIRED_ENV if not os.getenv(k)]
        if missing:
            raise RuntimeError(
                f"Missing required env vars: {', '.join(missing)}. "
                "Expected LLM_PROVIDER=gemini|ollama|openai_compatible. "
                "See .env.example."
            )
        provider = os.environ["LLM_PROVIDER"]
        if provider == "openai_compatible":
            missing = [
                k
                for k in ("OPENAI_COMPAT_BASE_URL", "OPENAI_COMPAT_CHAT_MODEL")
                if not os.getenv(k)
            ]
            if missing:
                raise RuntimeError(
                    f"Missing required env vars: {', '.join(missing)}. "
                    "Expected OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_CHAT_MODEL "
                    "for LLM_PROVIDER=openai_compatible. See .env.example."
                )
            config = ProviderConfig(
                provider=provider,
                api_key=os.getenv("OPENAI_COMPAT_API_KEY"),
                model=os.environ["OPENAI_COMPAT_CHAT_MODEL"],
                embed_model=os.getenv("OPENAI_COMPAT_EMBED_MODEL", ""),
                base_url=os.getenv("OPENAI_COMPAT_BASE_URL"),
                extra={
                    "rerank_model": os.getenv("OPENAI_COMPAT_RERANK_MODEL"),
                    "vision_model": os.getenv("OPENAI_COMPAT_VISION_MODEL"),
                },
            )
        else:
            missing = [k for k in ("LLM_MODEL", "EMBED_MODEL") if not os.getenv(k)]
            if missing:
                raise RuntimeError(
                    f"Missing required env vars: {', '.join(missing)}. "
                    "Expected LLM_MODEL and EMBED_MODEL. See .env.example."
                )
            config = ProviderConfig(
                provider=provider,
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
        case "openai_compatible":
            return OpenAICompatibleProvider(config)
        case _:
            raise ValueError(f"Unknown provider: {config.provider}")
