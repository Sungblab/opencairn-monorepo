from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.mark.asyncio
async def test_lit_import_workflow_threads_workspace_id_to_child_ingest() -> None:
    from worker.workflows.lit_import_workflow import LitImportInput, LitImportWorkflow

    inp = LitImportInput(
        job_id="job-1",
        user_id="user-1",
        workspace_id="ws-1",
        ids=["10.1234/test"],
    )
    paper = {
        "doi": "10.1234/test",
        "title": "A paper",
        "oa_pdf_url": "https://example.com/paper.pdf",
    }
    captured: dict[str, object] = {}

    async def fake_activity(name, *args, **_kwargs):
        assert name == "fetch_and_upload_oa_pdf"
        return {"object_key": "imports/literature/job-1/10.1234_test.pdf"}

    async def fake_child(_run, child_input, **_kwargs):
        captured["child_input"] = child_input
        return "note-1"

    wf = LitImportWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity), patch(
        "temporalio.workflow.execute_child_workflow", side_effect=fake_child
    ):
        await wf._handle_paper(inp, paper, "proj-1")

    child_input = captured["child_input"]
    assert child_input.workspace_id == "ws-1"
