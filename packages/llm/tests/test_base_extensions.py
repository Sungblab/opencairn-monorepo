from __future__ import annotations

import pytest

from llm.base import LLMProvider, ProviderConfig
from llm.tool_types import ToolResult


class _Dummy(LLMProvider):
    async def generate(self, messages, **kwargs):
        return ""

    async def embed(self, inputs):
        return []


def test_default_supports_flags_false():
    p = _Dummy(ProviderConfig(provider="dummy"))
    assert p.supports_tool_calling() is False
    assert p.supports_parallel_tool_calling() is False


async def test_default_generate_with_tools_raises():
    p = _Dummy(ProviderConfig(provider="dummy"))
    with pytest.raises(NotImplementedError):
        await p.generate_with_tools(messages=[], tools=[])


def test_default_tool_result_to_message_raises():
    p = _Dummy(ProviderConfig(provider="dummy"))
    with pytest.raises(NotImplementedError):
        p.tool_result_to_message(
            ToolResult(tool_use_id="t1", name="foo", data={"ok": True})
        )


def test_default_supports_ocr_false():
    p = _Dummy(ProviderConfig(provider="dummy"))
    assert p.supports_ocr() is False


async def test_default_ocr_raises():
    p = _Dummy(ProviderConfig(provider="dummy"))
    with pytest.raises(NotImplementedError):
        await p.ocr(b"\x89PNG\r\n", mime_type="image/png")
