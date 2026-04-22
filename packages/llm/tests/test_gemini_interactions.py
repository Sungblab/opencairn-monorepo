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
