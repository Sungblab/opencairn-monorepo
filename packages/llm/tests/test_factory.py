import pytest
from llm.factory import get_provider
from llm.base import ProviderConfig
from llm.gemini import GeminiProvider
from llm.openai_compatible import OpenAICompatibleProvider
from llm.ollama import OllamaProvider


def test_get_provider_gemini():
    config = ProviderConfig(
        provider="gemini",
        api_key="key",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-2-preview",
    )
    provider = get_provider(config)
    assert isinstance(provider, GeminiProvider)


def test_get_provider_ollama():
    config = ProviderConfig(
        provider="ollama",
        api_key=None,
        model="llama3",
        embed_model="nomic-embed-text",
        base_url="http://localhost:11434",
    )
    provider = get_provider(config)
    assert isinstance(provider, OllamaProvider)


def test_get_provider_unknown_raises():
    config = ProviderConfig(
        provider="unknown",
        api_key=None,
        model="x",
        embed_model="x",
    )
    with pytest.raises(ValueError, match="Unknown provider: unknown"):
        get_provider(config)


def test_get_provider_openai_compatible():
    config = ProviderConfig(
        provider="openai_compatible",
        api_key="key",
        model="qwen",
        embed_model="embed",
        base_url="http://localhost:8000",
    )
    provider = get_provider(config)
    assert isinstance(provider, OpenAICompatibleProvider)


def test_get_provider_openai_raises():
    # OpenAI is intentionally unsupported (2026-04-15 decision)
    config = ProviderConfig(
        provider="openai",
        api_key="key",
        model="gpt-4o",
        embed_model="text-embedding-3-small",
    )
    with pytest.raises(ValueError, match="Unknown provider: openai"):
        get_provider(config)


def test_get_provider_from_env(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3")
    monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    provider = get_provider()
    assert isinstance(provider, OllamaProvider)


def test_get_provider_openai_compatible_from_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("OPENAI_COMPAT_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("OPENAI_COMPAT_CHAT_MODEL", "qwen")
    monkeypatch.setenv("OPENAI_COMPAT_EMBED_MODEL", "embed")
    monkeypatch.delenv("OPENAI_COMPAT_API_KEY", raising=False)
    provider = get_provider()
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.config.model == "qwen"
    assert provider.config.embed_model == "embed"
    assert provider.base_url == "http://localhost:8000/v1"


def test_get_provider_missing_env_raises(monkeypatch):
    for var in ("LLM_PROVIDER", "LLM_MODEL", "EMBED_MODEL"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(RuntimeError, match="Missing required env vars"):
        get_provider()
