import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.genai._interactions.types.interaction import Interaction

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


def _real_interaction(**overrides):
    """Build a real SDK ``Interaction`` instance from sane defaults.

    Using ``model_validate`` (rather than ``MagicMock`` with ad-hoc attrs)
    pins our boundary mapping to the actual SDK schema — wrong field names
    fail at validation time, in test, instead of at runtime in production.
    """
    payload = {
        "id": "int_run_xyz789",
        "status": "in_progress",
        "created": "2026-04-23T00:00:00Z",
        "updated": "2026-04-23T00:00:00Z",
    }
    payload.update(overrides)
    return Interaction.model_validate(payload)


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
            thinking_summaries="auto",
            visualization="auto",
        )
    call = mocked.await_args
    cfg = call.kwargs["agent_config"]
    assert cfg["type"] == "deep-research"
    assert cfg["thinking_summaries"] == "auto"
    assert cfg["visualization"] == "auto"


@pytest.mark.asyncio
async def test_get_interaction_running(provider):
    mock_response = _real_interaction(id="int_run_xyz789", status="in_progress")
    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        state = await provider.get_interaction("int_run_xyz789")
    assert state.id == "int_run_xyz789"
    assert state.status == "in_progress"
    assert state.outputs == []
    assert state.error is None
    mocked.assert_awaited_once_with(interaction_id="int_run_xyz789")


@pytest.mark.asyncio
async def test_get_interaction_completed_with_outputs(provider):
    # Build a real SDK Interaction with outputs as the discriminated Content
    # union (TextContent + ImageContent). Provider must model_dump these into
    # plain dicts so callers can do ``state.outputs[0]["type"]`` without
    # crashing on ``Content`` BaseModel instances.
    mock_response = _real_interaction(
        id="int_run_xyz789",
        status="completed",
        updated="2026-04-23T00:05:00Z",
        outputs=[
            {"type": "text", "text": "## TPU Generations\n..."},
            {"type": "image", "data": "BASE64PNG==", "mime_type": "image/png"},
        ],
    )
    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=mock_response),
    ):
        state = await provider.get_interaction("int_run_xyz789")
    assert state.status == "completed"
    assert len(state.outputs) == 2
    assert state.outputs[0]["type"] == "text"
    assert state.outputs[0]["text"].startswith("## TPU Generations")
    assert state.outputs[1]["type"] == "image"
    assert state.outputs[1]["mime_type"] == "image/png"
    # Pure dicts, never SDK BaseModel instances — callers depend on this.
    for o in state.outputs:
        assert isinstance(o, dict)


@pytest.mark.asyncio
async def test_stream_interaction_yields_events(provider):
    # Use real SDK SSE variant instances. Each variant carries the
    # ``event_type`` discriminator (becomes our ``kind``) plus variant-
    # specific payload fields (``delta`` / ``interaction`` / ``error`` / …).
    # The previous test fed MagicMock objects with hand-set ``kind`` and
    # ``payload`` attrs that don't exist on any SDK type — masking the
    # actual stream_interaction shape mismatch.
    from google.genai._interactions.types.content_delta import ContentDelta
    from google.genai._interactions.types.interaction_complete_event import (
        InteractionCompleteEvent,
    )
    from google.genai._interactions.types.interaction_start_event import (
        InteractionStartEvent,
    )

    interaction_payload = {
        "id": "int_run_xyz789",
        "status": "in_progress",
        "created": "2026-04-23T00:00:00Z",
        "updated": "2026-04-23T00:00:00Z",
    }
    events = [
        InteractionStartEvent.model_validate(
            {
                "event_type": "interaction.start",
                "event_id": "ev_0",
                "interaction": interaction_payload,
            }
        ),
        ContentDelta.model_validate(
            {
                "event_type": "content.delta",
                "event_id": "ev_1",
                "index": 0,
                "delta": {"type": "text", "text": "TPU v1 launched in 2016..."},
            }
        ),
        ContentDelta.model_validate(
            {
                "event_type": "content.delta",
                "event_id": "ev_2",
                "index": 0,
                "delta": {
                    "type": "image",
                    "data": "BASE64PNG==",
                    "mime_type": "image/png",
                },
            }
        ),
        InteractionCompleteEvent.model_validate(
            {
                "event_type": "interaction.complete",
                "event_id": "ev_3",
                "interaction": {
                    **interaction_payload,
                    "status": "completed",
                    "updated": "2026-04-23T00:05:00Z",
                },
            }
        ),
    ]

    async def _gen():
        for ev in events:
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
    # ``kind`` is the SDK ``event_type`` verbatim — not the legacy
    # ContentDelta sub-type ("text"/"image") we previously assumed.
    assert [e.kind for e in collected] == [
        "interaction.start",
        "content.delta",
        "content.delta",
        "interaction.complete",
    ]
    # Payload is plain dict; variant-specific fields stay accessible.
    assert collected[1].payload["delta"]["type"] == "text"
    assert collected[2].payload["delta"]["mime_type"] == "image/png"
    assert collected[0].payload["interaction"]["id"] == "int_run_xyz789"
    # ``event_type`` and ``event_id`` are lifted to ``kind`` / ``event_id``
    # so we don't double-store them in the payload dict.
    assert "event_type" not in collected[0].payload
    assert "event_id" not in collected[0].payload
    for e in collected:
        assert isinstance(e.payload, dict)

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
