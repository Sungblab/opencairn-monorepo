"""IngestWorkflow MIME-dispatch tests for the Plan 3 Office/HWP follow-up.

The original IngestWorkflow only handled pdf / audio / video / image /
youtube / web-url and raised ``ValueError`` for everything else, so the
API allowlist could accept docx / hwp / etc. and silently fail later.
These tests pin the new dispatch so any regression that drops a branch
turns red instead of silent.
"""
from __future__ import annotations

import logging
from unittest.mock import patch

import pytest

_TEST_LOGGER = logging.getLogger("test_ingest_office_hwp_dispatch")


def _inp(mime: str):
    from worker.workflows.ingest_workflow import IngestInput

    return IngestInput(
        object_key="uploads/u/x.bin",
        file_name="x.bin",
        mime_type=mime,
        user_id="user-1",
        project_id="proj-1",
        note_id=None,
        workspace_id="ws-1",
    )


@pytest.mark.parametrize("mime,expected_activity", [
    (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "parse_office",
    ),
    (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "parse_office",
    ),
    (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "parse_office",
    ),
    ("application/msword", "parse_office"),
    ("application/vnd.ms-powerpoint", "parse_office"),
    ("application/vnd.ms-excel", "parse_office"),
    ("application/x-hwp", "parse_hwp"),
    ("application/haansofthwp", "parse_hwp"),
    ("application/vnd.hancom.hwp", "parse_hwp"),
    ("application/vnd.hancom.hwpx", "parse_hwp"),
])
@pytest.mark.asyncio
async def test_office_hwp_mimes_dispatch_to_correct_activity(
    monkeypatch, mime: str, expected_activity: str
):
    """Each office and HWP MIME from the API allowlist must route to the
    matching parser. Without this, missing branches silently fall through
    to ``raise ValueError`` after a 202 was already returned to the user."""
    monkeypatch.delenv("FEATURE_CONTENT_ENRICHMENT", raising=False)

    from worker.workflows.ingest_workflow import IngestWorkflow

    called: list[str] = []

    async def fake_activity(name, *args, **kwargs):
        called.append(name)
        if name in {"parse_office", "parse_hwp"}:
            return {
                "text": "hello",
                "viewer_pdf_object_key": None,
                "has_complex_layout": False,
            }
        if name == "create_source_note":
            return "note-1"
        return {}

    wf = IngestWorkflow()
    with patch(
        "temporalio.workflow.execute_activity", side_effect=fake_activity
    ), patch("temporalio.workflow.logger", _TEST_LOGGER):
        note_id = await wf._run_pipeline(_inp(mime), "wf-disp", 0)

    assert expected_activity in called, (
        f"MIME {mime} should dispatch {expected_activity}, called={called}"
    )
    assert note_id == "note-1"
