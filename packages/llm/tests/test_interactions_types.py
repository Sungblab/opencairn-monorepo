from llm.interactions import (
    InteractionEvent,
    InteractionHandle,
    InteractionState,
)


def test_handle_has_id_agent_background():
    h = InteractionHandle(id="int_1", agent="deep-research-preview-04-2026", background=True)
    assert h.id == "int_1"
    assert h.agent == "deep-research-preview-04-2026"
    assert h.background is True


def test_state_has_status_outputs_error():
    s = InteractionState(
        id="int_1",
        status="completed",
        outputs=[{"type": "text", "text": "hi"}],
    )
    assert s.status == "completed"
    assert s.outputs == [{"type": "text", "text": "hi"}]
    assert s.error is None


def test_state_error_shape():
    s = InteractionState(
        id="int_1",
        status="failed",
        outputs=[],
        error={"code": "quota_exhausted", "message": "…"},
    )
    assert s.status == "failed"
    assert s.error == {"code": "quota_exhausted", "message": "…"}


def test_event_payload_is_dict():
    ev = InteractionEvent(
        event_id="ev_1",
        kind="thought_summary",
        payload={"text": "decomposing"},
    )
    assert ev.event_id == "ev_1"
    assert ev.kind == "thought_summary"
    assert ev.payload["text"] == "decomposing"
