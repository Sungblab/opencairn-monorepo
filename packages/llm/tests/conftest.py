import pytest
from llm.base import ProviderConfig


@pytest.fixture
def gemini_config() -> ProviderConfig:
    return ProviderConfig(
        provider="gemini",
        api_key="test-gemini-key",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-001",
    )


@pytest.fixture
def ollama_config() -> ProviderConfig:
    return ProviderConfig(
        provider="ollama",
        api_key=None,
        model="llama3",
        embed_model="nomic-embed-text",
        base_url="http://localhost:11434",
    )
