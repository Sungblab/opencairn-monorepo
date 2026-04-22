import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from llm.gemini import GeminiProvider
from llm.interactions import InteractionHandle

FIXTURES = Path(__file__).parent / "fixtures" / "interactions"


def _fixture_as_obj(name: str):
    """Return a MagicMock whose attributes match the JSON fixture keys."""
    data = json.loads((FIXTURES / name).read_text())
    m = MagicMock()
    for k, v in data.items():
        setattr(m, k, v)
    return m, data


@pytest.fixture
def provider(gemini_config):
    return GeminiProvider(gemini_config)


@pytest.mark.asyncio
async def test_start_interaction_returns_handle(provider):
    mock_response, raw = _fixture_as_obj("plan_response.json")
    with patch.object(
        provider._client.aio.interactions,
        "create",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        handle = await provider.start_interaction(
            input="Research Google TPUs history",
            agent="deep-research-max-preview-04-2026",
            collaborative_planning=True,
            background=True,
        )
    assert isinstance(handle, InteractionHandle)
    assert handle.id == raw["id"]
    assert handle.agent == raw["agent"]
    assert handle.background is True
    # Verify the SDK call carried our arguments
    call = mocked.await_args
    assert call.kwargs["input"] == "Research Google TPUs history"
    assert call.kwargs["agent"] == "deep-research-max-preview-04-2026"
    assert call.kwargs["background"] is True
    # collaborative_planning lives inside agent_config
    assert call.kwargs["agent_config"]["collaborative_planning"] is True
    assert call.kwargs["agent_config"]["type"] == "deep-research"


@pytest.mark.asyncio
async def test_start_interaction_forwards_previous_id(provider):
    mock_response, _ = _fixture_as_obj("plan_response.json")
    with patch.object(
        provider._client.aio.interactions,
        "create",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.start_interaction(
            input="edit: focus on TPU v5",
            agent="deep-research-max-preview-04-2026",
            collaborative_planning=True,
            previous_interaction_id="int_plan_abc123",
        )
    call = mocked.await_args
    assert call.kwargs["previous_interaction_id"] == "int_plan_abc123"


@pytest.mark.asyncio
async def test_start_interaction_forwards_optional_agent_config(provider):
    mock_response, _ = _fixture_as_obj("plan_response.json")
    with patch.object(
        provider._client.aio.interactions,
        "create",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.start_interaction(
            input="x",
            agent="deep-research-max-preview-04-2026",
            stream=True,
            thinking_summaries="auto",
            visualization=True,
        )
    call = mocked.await_args
    cfg = call.kwargs["agent_config"]
    assert cfg["type"] == "deep-research"
    assert cfg["thinking_summaries"] == "auto"
    assert cfg["visualization"] is True
    assert call.kwargs["stream"] is True


@pytest.mark.asyncio
async def test_get_interaction_running(provider):
    mock_response, raw = _fixture_as_obj("running_state.json")
    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        state = await provider.get_interaction("int_run_xyz789")
    assert state.id == raw["id"]
    assert state.status == "running"
    assert state.outputs == []
    assert state.error is None
    mocked.assert_awaited_once_with(interaction_id="int_run_xyz789")


@pytest.mark.asyncio
async def test_get_interaction_completed_with_outputs(provider):
    mock_response, raw = _fixture_as_obj("completed_state.json")
    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=mock_response),
    ):
        state = await provider.get_interaction("int_run_xyz789")
    assert state.status == "completed"
    assert len(state.outputs) == 2
    assert state.outputs[0]["type"] == "text"
    assert state.outputs[1]["type"] == "image"


@pytest.mark.asyncio
async def test_stream_interaction_yields_events(provider):
    path = FIXTURES / "stream_events.jsonl"
    lines = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    async def _gen():
        for row in lines:
            ev = MagicMock()
            ev.event_id = row["event_id"]
            ev.kind = row["kind"]
            ev.payload = row["payload"]
            yield ev

    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=_gen()),
    ) as mocked:
        collected = []
        async for ev in provider.stream_interaction("int_run_xyz789"):
            collected.append(ev)

    assert [e.event_id for e in collected] == ["ev_0", "ev_1", "ev_2", "ev_3"]
    assert collected[0].kind == "thought_summary"
    assert collected[2].payload["mime_type"] == "image/png"
    mocked.assert_awaited_once()
    call_kwargs = mocked.await_args.kwargs
    assert call_kwargs["interaction_id"] == "int_run_xyz789"
    assert call_kwargs["stream"] is True


@pytest.mark.asyncio
async def test_stream_interaction_forwards_last_event_id(provider):
    async def _empty():
        if False:
            yield

    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=_empty()),
    ) as mocked:
        async for _ in provider.stream_interaction("int_run_xyz789", last_event_id="ev_2"):
            pass
    assert mocked.await_args.kwargs["last_event_id"] == "ev_2"
    assert mocked.await_args.kwargs["stream"] is True


@pytest.mark.asyncio
async def test_cancel_interaction_calls_sdk(provider):
    with patch.object(
        provider._client.aio.interactions,
        "cancel",
        new=AsyncMock(return_value=None),
    ) as mocked:
        result = await provider.cancel_interaction("int_run_xyz789")
    assert result is None
    mocked.assert_awaited_once_with(interaction_id="int_run_xyz789")
