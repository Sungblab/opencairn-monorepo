from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from llm.base import ProviderConfig
from llm.gemini import GeminiProvider
from llm.tool_types import ToolResult


def _make_provider() -> GeminiProvider:
    return GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))


def test_tool_result_to_message_success():
    p = _make_provider()
    msg = p.tool_result_to_message(
        ToolResult(tool_use_id="abc", name="search", data={"rows": 3})
    )
    assert msg.role == "user"
    assert len(msg.parts) == 1
    fr = msg.parts[0].function_response
    assert fr.id == "abc"
    assert fr.name == "search"
    assert fr.response == {"result": {"rows": 3}}


def test_tool_result_to_message_error():
    p = _make_provider()
    msg = p.tool_result_to_message(
        ToolResult(tool_use_id="abc", name="search", data="boom", is_error=True)
    )
    fr = msg.parts[0].function_response
    assert fr.response == {"error": "boom"}


async def test_mode_any_with_allowed_names():
    p = _make_provider()
    fake = SimpleNamespace(
        candidates=[SimpleNamespace(
            content=SimpleNamespace(parts=[]),
            finish_reason="STOP",
        )],
        usage_metadata=SimpleNamespace(
            prompt_token_count=0,
            candidates_token_count=0,
            cached_content_token_count=0,
        ),
    )
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    await p.generate_with_tools(
        messages=[], tools=[],
        mode="any", allowed_tool_names=["search_concepts"],
    )
    kwargs = mock_models.generate_content.call_args.kwargs
    tc = kwargs["config"].tool_config.function_calling_config
    assert tc.mode == "ANY"
    assert tc.allowed_function_names == ["search_concepts"]


async def test_cached_context_id_passed_through():
    p = _make_provider()
    fake = SimpleNamespace(
        candidates=[SimpleNamespace(
            content=SimpleNamespace(parts=[]),
            finish_reason="STOP",
        )],
        usage_metadata=SimpleNamespace(
            prompt_token_count=0,
            candidates_token_count=0,
            cached_content_token_count=0,
        ),
    )
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    await p.generate_with_tools(
        messages=[], tools=[], cached_context_id="cache-xyz",
    )
    kwargs = mock_models.generate_content.call_args.kwargs
    assert kwargs["config"].cached_content == "cache-xyz"
