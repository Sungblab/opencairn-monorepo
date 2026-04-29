from __future__ import annotations

import json

import httpx
import pytest
import respx

from llm.base import ProviderConfig
from llm.ollama import OllamaProvider
from llm.tool_types import ToolResult


def _make_provider() -> OllamaProvider:
    return OllamaProvider(
        ProviderConfig(
            provider="ollama",
            model="qwen3",
            embed_model="nomic-embed-text",
            base_url="http://localhost:11434",
        )
    )


def test_ollama_supports_tools():
    p = _make_provider()
    assert p.supports_tool_calling() is True
    assert p.supports_parallel_tool_calling() is False


@pytest.mark.asyncio
async def test_ollama_generate_with_tools_parses_tool_calls(monkeypatch):
    p = _make_provider()
    monkeypatch.setattr(
        p,
        "build_tool_declarations",
        lambda tools: [
            {
                "type": "function",
                "function": {
                    "name": "search_notes",
                    "description": "Search notes",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
    )

    captured: dict = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "message": {
                    "role": "assistant",
                    "content": "",
                    "thinking": "need search",
                    "tool_calls": [
                        {
                            "function": {
                                "index": 0,
                                "name": "search_notes",
                                "arguments": {"query": "rope"},
                            }
                        }
                    ],
                },
                "prompt_eval_count": 11,
                "eval_count": 3,
                "done_reason": "stop",
            },
        )

    with respx.mock:
        respx.post("http://localhost:11434/api/chat").mock(side_effect=_capture)
        turn = await p.generate_with_tools(
            messages=[{"role": "user", "content": "search"}],
            tools=[object()],
            allowed_tool_names=["search_notes"],
            temperature=0.2,
            max_output_tokens=128,
        )

    assert captured["payload"]["tools"][0]["function"]["name"] == "search_notes"
    assert captured["payload"]["options"] == {"temperature": 0.2, "num_predict": 128}
    assert turn.assistant_message["thinking"] == "need search"
    assert len(turn.tool_uses) == 1
    assert turn.tool_uses[0].id == "0"
    assert turn.tool_uses[0].name == "search_notes"
    assert turn.tool_uses[0].args == {"query": "rope"}
    assert turn.usage.input_tokens == 11
    assert turn.usage.output_tokens == 3


@pytest.mark.asyncio
async def test_ollama_generate_with_tools_honors_none_mode(monkeypatch):
    p = _make_provider()
    monkeypatch.setattr(
        p,
        "build_tool_declarations",
        lambda tools: [
            {
                "type": "function",
                "function": {
                    "name": "search_notes",
                    "description": "Search notes",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
    )

    captured: dict = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "message": {"role": "assistant", "content": "done"},
                "prompt_eval_count": 1,
                "eval_count": 1,
            },
        )

    with respx.mock:
        respx.post("http://localhost:11434/api/chat").mock(side_effect=_capture)
        turn = await p.generate_with_tools(
            messages=[{"role": "user", "content": "answer"}],
            tools=[object()],
            mode="none",
        )

    assert "tools" not in captured["payload"]
    assert turn.final_text == "done"
    assert turn.tool_uses == ()


def test_ollama_tool_result_to_message_serializes_result():
    p = _make_provider()
    msg = p.tool_result_to_message(
        ToolResult(tool_use_id="0", name="search_notes", data={"rows": 3})
    )
    assert msg == {
        "role": "tool",
        "tool_name": "search_notes",
        "content": '{"rows": 3}',
    }


def test_ollama_tool_result_to_message_serializes_error():
    p = _make_provider()
    msg = p.tool_result_to_message(
        ToolResult(tool_use_id="0", name="search_notes", data="boom", is_error=True)
    )
    assert msg == {
        "role": "tool",
        "tool_name": "search_notes",
        "content": '{"error": "boom"}',
    }
