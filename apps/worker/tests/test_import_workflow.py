"""Integration test scaffold for the ImportWorkflow.

Full black-box coverage depends on the internal_api stub infrastructure
that lands alongside Task 11 — until that exists, running the workflow
against the real Temporal test env hangs on the first HTTP call out.
Kept here as a marker so the test file shows up in plan tracking and
the import line catches any future symbol rename.
"""
from __future__ import annotations

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
