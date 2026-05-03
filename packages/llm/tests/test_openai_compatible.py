from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import respx

from llm.base import EmbedInput, ProviderConfig
from llm.openai_compatible import OpenAICompatibleProvider
from llm.tool_types import ToolResult


def make_provider(**overrides) -> OpenAICompatibleProvider:
    config = ProviderConfig(
        provider="openai_compatible",
        api_key=overrides.get("api_key", "test-key"),
        model=overrides.get("model", "qwen2.5"),
        embed_model=overrides.get("embed_model", "text-embedding"),
        base_url=overrides.get("base_url", "http://localhost:8000"),
    )
    return OpenAICompatibleProvider(config)


def test_normalizes_base_url_to_v1():
    assert make_provider(base_url="http://localhost:8000").base_url == (
        "http://localhost:8000/v1"
    )
    assert make_provider(base_url="http://localhost:8000/v1").base_url == (
        "http://localhost:8000/v1"
    )


@pytest.mark.asyncio
async def test_generate_posts_chat_completion():
    provider = make_provider()
    captured: dict = {}

    def capture(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        captured["authorization"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "hello"}}]},
        )

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(
            side_effect=capture
        )
        out = await provider.generate(
            [{"role": "user", "content": "hi"}],
            temperature=0.2,
        )

    assert out == "hello"
    assert captured["authorization"] == "Bearer test-key"
    assert captured["payload"]["model"] == "qwen2.5"
    assert captured["payload"]["messages"] == [{"role": "user", "content": "hi"}]
    assert captured["payload"]["temperature"] == 0.2


@pytest.mark.asyncio
async def test_generate_returns_empty_string_when_no_choices():
    provider = make_provider()

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": []})
        )
        out = await provider.generate([{"role": "user", "content": "hi"}])

    assert out == ""


@pytest.mark.asyncio
async def test_embed_posts_embeddings_endpoint():
    provider = make_provider()
    captured: dict = {}

    def capture(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "data": [
                    {"embedding": [0.1, 0.2]},
                    {"embedding": [0.3, 0.4]},
                ]
            },
        )

    with respx.mock:
        respx.post("http://localhost:8000/v1/embeddings").mock(side_effect=capture)
        out = await provider.embed([EmbedInput(text="a"), EmbedInput(text="b")])

    assert captured["payload"] == {
        "model": "text-embedding",
        "input": ["a", "b"],
    }
    assert out == [[0.1, 0.2], [0.3, 0.4]]


def test_embed_without_model_fails_clearly():
    provider = make_provider(embed_model="")
    with pytest.raises(NotImplementedError, match="OPENAI_COMPAT_EMBED_MODEL"):
        asyncio.run(provider.embed([EmbedInput(text="a")]))


@pytest.mark.asyncio
async def test_embed_rejects_multimodal_inputs():
    provider = make_provider()
    with pytest.raises(NotImplementedError, match="text only"):
        await provider.embed([EmbedInput(image_bytes=b"png")])


@pytest.mark.asyncio
async def test_generate_with_tools_parses_openai_tool_calls(monkeypatch):
    provider = make_provider()
    monkeypatch.setattr(
        provider,
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

    def capture(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "search_notes",
                                        "arguments": '{"query":"rope"}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 2},
            },
        )

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(
            side_effect=capture
        )
        turn = await provider.generate_with_tools(
            messages=[{"role": "user", "content": "search"}],
            tools=[object()],
            allowed_tool_names=["search_notes"],
            temperature=0.2,
            max_output_tokens=128,
        )

    assert captured["payload"]["tools"][0]["function"]["name"] == "search_notes"
    assert captured["payload"]["tool_choice"] == "auto"
    assert captured["payload"]["temperature"] == 0.2
    assert captured["payload"]["max_tokens"] == 128
    assert turn.tool_uses[0].id == "call_1"
    assert turn.tool_uses[0].name == "search_notes"
    assert turn.tool_uses[0].args == {"query": "rope"}
    assert turn.usage.input_tokens == 10
    assert turn.usage.output_tokens == 2


@pytest.mark.asyncio
async def test_generate_with_tools_rejects_empty_choices(monkeypatch):
    provider = make_provider()
    monkeypatch.setattr(provider, "build_tool_declarations", lambda tools: [])

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": []})
        )
        with pytest.raises(RuntimeError, match="returned no choices"):
            await provider.generate_with_tools(
                messages=[{"role": "user", "content": "search"}],
                tools=[],
            )


@pytest.mark.asyncio
async def test_generate_with_tools_reports_malformed_tool_arguments(monkeypatch):
    provider = make_provider()
    monkeypatch.setattr(
        provider,
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

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "tool_calls": [
                                    {
                                        "id": "call_1",
                                        "function": {
                                            "name": "search_notes",
                                            "arguments": "{not-json}",
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                },
            )
        )
        with pytest.raises(RuntimeError, match="malformed tool arguments"):
            await provider.generate_with_tools(
                messages=[{"role": "user", "content": "search"}],
                tools=[object()],
            )


@pytest.mark.asyncio
async def test_generate_with_tools_honors_none_mode(monkeypatch):
    provider = make_provider()
    monkeypatch.setattr(
        provider,
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

    def capture(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "done"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(
            side_effect=capture
        )
        turn = await provider.generate_with_tools(
            messages=[{"role": "user", "content": "answer"}],
            tools=[object()],
            mode="none",
        )

    assert "tools" not in captured["payload"]
    assert "tool_choice" not in captured["payload"]
    assert turn.final_text == "done"
    assert turn.tool_uses == ()


def test_tool_result_to_message_uses_openai_tool_role():
    provider = make_provider()
    msg = provider.tool_result_to_message(
        ToolResult(tool_use_id="call_1", name="search_notes", data={"rows": 1})
    )
    assert msg == {
        "role": "tool",
        "tool_call_id": "call_1",
        "name": "search_notes",
        "content": '{"rows": 1}',
    }


def test_tool_result_to_message_serializes_errors():
    provider = make_provider()
    msg = provider.tool_result_to_message(
        ToolResult(
            tool_use_id="call_1",
            name="search_notes",
            data="boom",
            is_error=True,
        )
    )
    assert msg == {
        "role": "tool",
        "tool_call_id": "call_1",
        "name": "search_notes",
        "content": '{"error": "boom"}',
    }


def test_gemini_native_capabilities_remain_unsupported():
    provider = make_provider()
    assert provider.supports_ocr() is False
    with pytest.raises(NotImplementedError, match="Interactions API"):
        asyncio.run(provider.get_interaction("x"))
