from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from llm.base import ProviderConfig
from llm.errors import ProviderFatalError, ProviderRetryableError
from llm.gemini import GeminiProvider


def _make_provider() -> GeminiProvider:
    return GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))


def _fake_part_text(text: str):
    return SimpleNamespace(text=text, function_call=None, thought_signature=None)


def _fake_part_function_call(id: str, name: str, args: dict):
    fc = SimpleNamespace(id=id, name=name, args=args)
    return SimpleNamespace(text=None, function_call=fc, thought_signature=None)


def _fake_response(parts, finish_reason="STOP", usage=None):
    content = SimpleNamespace(parts=parts)
    candidate = SimpleNamespace(content=content, finish_reason=finish_reason)
    um = usage or SimpleNamespace(
        prompt_token_count=10,
        candidates_token_count=5,
        cached_content_token_count=0,
    )
    return SimpleNamespace(candidates=[candidate], usage_metadata=um)


async def test_pure_text_response_no_tool_uses():
    p = _make_provider()
    fake = _fake_response([_fake_part_text("hello")])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    turn = await p.generate_with_tools(messages=[], tools=[])

    assert turn.tool_uses == ()
    assert turn.final_text == "hello"
    assert turn.stop_reason == "STOP"
    assert turn.usage.input_tokens == 10
    assert turn.usage.output_tokens == 5


async def test_generate_with_tools_maps_full_usage_metadata():
    p = _make_provider()
    fake = _fake_response(
        [_fake_part_text("hello")],
        usage=SimpleNamespace(
            prompt_token_count=100,
            cached_content_token_count=25,
            candidates_token_count=20,
            thoughts_token_count=8,
            tool_use_prompt_token_count=12,
            total_token_count=140,
        ),
    )
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    turn = await p.generate_with_tools(messages=[], tools=[])

    assert turn.usage.input_tokens == 112
    assert turn.usage.output_tokens == 28
    assert turn.usage.cached_input_tokens == 25
    assert turn.usage.thought_tokens == 8
    assert turn.usage.tool_use_prompt_tokens == 12
    assert turn.usage.total_tokens == 140


async def test_single_function_call_parsed():
    p = _make_provider()
    fake = _fake_response([
        _fake_part_function_call("f1", "search_concepts", {"query": "rope", "k": 3}),
    ])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    turn = await p.generate_with_tools(messages=[], tools=[])

    assert len(turn.tool_uses) == 1
    assert turn.tool_uses[0].id == "f1"
    assert turn.tool_uses[0].name == "search_concepts"
    assert turn.tool_uses[0].args == {"query": "rope", "k": 3}


async def test_mixed_text_and_function_call():
    p = _make_provider()
    fake = _fake_response([
        _fake_part_text("Let me search."),
        _fake_part_function_call("f1", "search_concepts", {"query": "x"}),
    ])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    turn = await p.generate_with_tools(messages=[], tools=[])

    assert turn.final_text == "Let me search."
    assert len(turn.tool_uses) == 1


async def test_api_429_maps_to_retryable():
    from google.genai import errors as genai_errors

    p = _make_provider()
    mock_models = MagicMock()
    err = genai_errors.APIError(
        code=429,
        response_json={"error": {"message": "rate limited"}},
        response=MagicMock(),
    )
    mock_models.generate_content = AsyncMock(side_effect=err)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    with pytest.raises(ProviderRetryableError):
        await p.generate_with_tools(messages=[], tools=[])


async def test_api_401_maps_to_fatal():
    from google.genai import errors as genai_errors

    p = _make_provider()
    mock_models = MagicMock()
    err = genai_errors.APIError(
        code=401,
        response_json={"error": {"message": "unauthorized"}},
        response=MagicMock(),
    )
    mock_models.generate_content = AsyncMock(side_effect=err)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    with pytest.raises(ProviderFatalError):
        await p.generate_with_tools(messages=[], tools=[])


async def test_auto_function_calling_always_disabled():
    """CRITICAL: runtime owns the loop. SDK must never auto-execute tools."""
    p = _make_provider()
    fake = _fake_response([_fake_part_text("ok")])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    await p.generate_with_tools(messages=[], tools=[])

    kwargs = mock_models.generate_content.call_args.kwargs
    config = kwargs["config"]
    assert config.automatic_function_calling.disable is True


async def test_generate_with_tools_maps_system_messages_to_system_instruction():
    p = _make_provider()
    fake = _fake_response([_fake_part_text("ok")])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    await p.generate_with_tools(
        messages=[
            {"role": "system", "content": "Use tools carefully."},
            {"role": "user", "content": "run it"},
        ],
        tools=[],
    )

    kwargs = mock_models.generate_content.call_args.kwargs
    assert [c.role for c in kwargs["contents"]] == ["user"]
    assert kwargs["config"].system_instruction == "Use tools carefully."


async def test_generate_with_tools_forwards_service_tier():
    p = GeminiProvider(ProviderConfig(
        provider="gemini",
        model="gemini-3-flash-preview",
        api_key="k",
        service_tier="priority",
    ))
    fake = _fake_response([_fake_part_text("ok")])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    await p.generate_with_tools(messages=[], tools=[])

    kwargs = mock_models.generate_content.call_args.kwargs
    assert kwargs["config"].service_tier == "priority"
