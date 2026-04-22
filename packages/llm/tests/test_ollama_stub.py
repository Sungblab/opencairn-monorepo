from __future__ import annotations

import pytest

from llm.base import ProviderConfig
from llm.errors import ToolCallingNotSupported
from llm.ollama import OllamaProvider


def test_ollama_does_not_support_tools():
    p = OllamaProvider(ProviderConfig(provider="ollama", model="qwen2.5:7b"))
    assert p.supports_tool_calling() is False
    assert p.supports_parallel_tool_calling() is False


async def test_ollama_generate_with_tools_raises():
    p = OllamaProvider(ProviderConfig(provider="ollama", model="qwen2.5:7b"))
    with pytest.raises(ToolCallingNotSupported):
        await p.generate_with_tools(messages=[], tools=[])


def test_ollama_tool_result_to_message_raises():
    p = OllamaProvider(ProviderConfig(provider="ollama", model="qwen2.5:7b"))
    with pytest.raises(ToolCallingNotSupported):
        p.tool_result_to_message(None)
