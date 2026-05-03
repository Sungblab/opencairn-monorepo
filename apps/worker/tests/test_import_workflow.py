"""Integration test scaffold for the ImportWorkflow.

Full black-box coverage depends on the internal_api stub infrastructure
that lands alongside Task 11 — until that exists, running the workflow
against the real Temporal test env hangs on the first HTTP call out.
Kept here as a marker so the test file shows up in plan tracking and
the import line catches any future symbol rename.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.mark.skip(
    reason="internal_api stub scaffolding lands in Task 11 — revisit then",
)
def test_import_notion_fixture_placeholder() -> None:
    """Placeholder — full workflow replay will go here once Task 11 ships
    the httpx stub backend that simulates projects/notes/import-jobs tables.
    Assert: finalize_import_job receives status=completed with expected
    per-kind counts from the Notion small-fixture tree (2 pages, 2 binaries).
    """


def test_import_workflow_module_imports() -> None:
    """Smoke test that the workflow module loads cleanly and Temporal
    registration doesn't break on a fresh clone — catches missing deps
    (googleapiclient, markdown_it) before the worker boots in prod."""
    from worker.workflows.import_workflow import ImportInput, ImportWorkflow

    assert ImportWorkflow is not None
    inp = ImportInput(
        job_id="00000000-0000-0000-0000-000000000000",
        user_id="u",
        workspace_id="ws",
        source="notion_zip",
        source_metadata={"zip_object_key": "k"},
    )
    assert inp.source == "notion_zip"


@pytest.mark.asyncio
async def test_import_workflow_threads_workspace_id_to_child_ingest() -> None:
    from worker.workflows.import_workflow import ImportInput, ImportWorkflow

    inp = ImportInput(
        job_id="job-1",
        user_id="user-1",
        workspace_id="ws-1",
        source="notion_zip",
        source_metadata={"zip_object_key": "k"},
    )
    node = {
        "idx": 7,
        "kind": "binary",
        "display_name": "notes.md",
        "meta": {"staged_path": "notes.md", "mime": "text/markdown"},
    }
    captured: dict[str, object] = {}

    async def fake_activity(name, *args, **_kwargs):
        assert name == "upload_staging_to_minio"
        return {"object_key": "imports/notion/job-1/notes.md", "mime": "text/markdown"}

    async def fake_child(_run, child_input, **_kwargs):
        captured["child_input"] = child_input
        return "note-1"

    wf = ImportWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity), patch(
        "temporalio.workflow.execute_child_workflow", side_effect=fake_child
    ):
        await wf._run_binary(inp, node, "parent-1", {"project_id": "proj-1"})

    child_input = captured["child_input"]
    assert child_input.workspace_id == "ws-1"


@pytest.mark.asyncio
async def test_import_workflow_routes_markdown_zip_branch() -> None:
    from worker.workflows.import_workflow import ImportInput, ImportWorkflow

    inp = ImportInput(
        job_id="job-1",
        user_id="user-1",
        workspace_id="ws-1",
        source="markdown_zip",
        source_metadata={
            "zip_object_key": "imports/markdown/ws-1/user-1/vault.zip",
            "original_name": "vault.zip",
            "max_concurrent_items": 1,
        },
    )
    manifest = {
        "nodes": [
            {
                "idx": 0,
                "kind": "page",
                "path": "Index.md",
                "display_name": "Index",
                "meta": {"md_path": "Index.md"},
            },
            {
                "idx": 1,
                "kind": "binary",
                "path": "assets/a.png",
                "display_name": "a.png",
                "meta": {"staged_path": "assets/a.png", "mime": "image/png"},
            },
        ],
        "uuid_link_map": {},
        "link_title_map": {"index": 0},
    }
    calls: list[tuple[str, dict]] = []
    captured_child: dict[str, object] = {}

    async def fake_activity(name, payload, **_kwargs):
        calls.append((name, payload))
        if name == "resolve_target":
            return {"project_id": "proj-1", "parent_note_id": None}
        if name == "unzip_markdown_export":
            return manifest
        if name == "materialize_page_tree":
            return {
                "idx_to_note_id": {"0": "note-1"},
                "binary_effective_parent": {"1": "note-1"},
            }
        if name == "convert_notion_md_to_plate":
            assert payload["source_type"] == "markdown"
            assert payload["link_title_map"] == {"index": 0}
            return None
        if name == "upload_staging_to_minio":
            assert payload["object_key"] == "imports/markdown/job-1/assets/a.png"
            return {"object_key": payload["object_key"], "mime": "image/png"}
        if name == "finalize_import_job":
            return None
        raise AssertionError(f"unexpected activity {name}")

    async def fake_child(_run, child_input, **_kwargs):
        captured_child["child_input"] = child_input
        return "ok"

    wf = ImportWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity), patch(
        "temporalio.workflow.execute_child_workflow", side_effect=fake_child
    ):
        result = await wf.run(inp)

    assert result == {"total": 2, "completed": 2, "failed": 0}
    assert [name for name, _ in calls].count("unzip_markdown_export") == 1
    child_input = captured_child["child_input"]
    assert child_input.workspace_id == "ws-1"
    assert child_input.note_id == "note-1"
