"""Spec B — IngestWorkflow integration with content-aware enrichment.

The enrichment branch is gated by IngestInput.content_enrichment_enabled. Failures
inside the enrichment compute / store path are caught so the parent
note still gets created.
"""

from __future__ import annotations

import logging
from unittest.mock import patch

import pytest

# Outside Temporal's workflow event loop, ``temporalio.workflow.logger``
# raises. Substitute a plain stdlib logger for unit tests.
_TEST_LOGGER = logging.getLogger("test_ingest_enrichment")


def _make_inp(*, content_enrichment_enabled: bool = False):
    from worker.workflows.ingest_workflow import IngestInput

    return IngestInput(
        object_key="test.pdf",
        file_name="test.pdf",
        mime_type="application/pdf",
        user_id="user-1",
        project_id="proj-1",
        note_id=None,
        workspace_id="ws-1",
        content_enrichment_enabled=content_enrichment_enabled,
    )


@pytest.mark.asyncio
async def test_workspace_id_field_exists():
    from worker.workflows.ingest_workflow import IngestInput

    inp = IngestInput(
        object_key="x",
        file_name="x",
        mime_type="application/pdf",
        user_id="u",
        project_id="p",
        note_id=None,
        workspace_id="ws-1",
    )
    assert inp.workspace_id == "ws-1"
    assert inp.content_enrichment_enabled is False


@pytest.mark.asyncio
async def test_enrichment_activities_called_when_flag_on():
    from worker.workflows.ingest_workflow import IngestWorkflow

    called: list[str] = []

    async def fake_activity(name, *args, **kwargs):
        called.append(name)
        if name == "parse_pdf":
            return {
                "text": "hello",
                "has_complex_layout": False,
                "is_scan": False,
                "pages": [],
            }
        if name == "detect_content_type":
            return {
                "content_type": "document",
                "confidence": 0.9,
                "used_llm": False,
            }
        if name == "enrich_document":
            return {
                "artifact": {},
                "content_type": "document",
                "provider": "gemini",
                "skip_reasons": [],
            }
        if name == "create_source_note":
            return "note-abc"
        if name == "store_enrichment_artifact":
            return {"ok": True}
        return {}

    wf = IngestWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity):
        note_id = await wf._run_pipeline(
            _make_inp(content_enrichment_enabled=True), "wf-test", 0
        )

    assert "detect_content_type" in called
    assert "enrich_document" in called
    assert "store_enrichment_artifact" in called
    assert note_id == "note-abc"


@pytest.mark.asyncio
async def test_enrichment_failure_does_not_block_note_creation():
    from temporalio.exceptions import ApplicationError

    from worker.workflows.ingest_workflow import IngestWorkflow

    call_seq: list[str] = []

    async def fake_activity(name, *args, **kwargs):
        call_seq.append(name)
        if name == "parse_pdf":
            return {
                "text": "hello",
                "has_complex_layout": False,
                "is_scan": False,
                "pages": [],
            }
        if name == "detect_content_type":
            # Real Temporal wraps activity exceptions in ActivityError;
            # ApplicationError is the canonical activity-side raise and
            # is also in the workflow's narrow catch list.
            raise ApplicationError("boom", non_retryable=True)
        if name == "create_source_note":
            return "note-xyz"
        return {}

    wf = IngestWorkflow()
    with patch(
        "temporalio.workflow.execute_activity", side_effect=fake_activity
    ), patch("temporalio.workflow.logger", _TEST_LOGGER):
        note_id = await wf._run_pipeline(
            _make_inp(content_enrichment_enabled=True), "wf-test", 0
        )

    assert note_id == "note-xyz"
    assert "create_source_note" in call_seq


@pytest.mark.asyncio
async def test_enrichment_not_called_when_flag_off():
    from worker.workflows.ingest_workflow import IngestWorkflow

    called: list[str] = []

    async def fake_activity(name, *args, **kwargs):
        called.append(name)
        if name == "parse_pdf":
            return {
                "text": "hi",
                "has_complex_layout": False,
                "is_scan": False,
                "pages": [],
            }
        if name == "create_source_note":
            return "note-000"
        return {}

    wf = IngestWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity):
        note_id = await wf._run_pipeline(_make_inp(), "wf-test", 0)

    assert "detect_content_type" not in called
    assert "enrich_document" not in called
    assert note_id == "note-000"
