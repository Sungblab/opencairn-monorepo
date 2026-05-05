from __future__ import annotations

from pathlib import Path


def test_google_workspace_export_workflow_imports() -> None:
    from worker.workflows.google_workspace_export_workflow import (
        GoogleWorkspaceExportWorkflow,
    )

    assert GoogleWorkspaceExportWorkflow.__name__ == "GoogleWorkspaceExportWorkflow"


def test_google_workspace_export_workflow_calls_export_activity() -> None:
    source = Path("src/worker/workflows/google_workspace_export_workflow.py").read_text()
    assert '"export_project_object_to_google_workspace"' in source
    assert '"finalize_google_workspace_export"' in source
    assert "RetryPolicy(maximum_attempts=3)" in source
    assert "GoogleWorkspaceExportResult" in source
    assert "GoogleWorkspaceExportErrorResult" in source
    assert "stable_google_export_error_code" in source
