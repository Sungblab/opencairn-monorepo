"""Tests for ``build_worker_config`` registration of the Code Agent
behind the ``FEATURE_CODE_AGENT`` flag (Plan 7 Phase 2 Task 7).

Mirrors the Deep Research feature-flag pattern exercised by the worker
entrypoint at ``worker.temporal_main``.
"""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from worker.temporal_main import build_worker_config

if TYPE_CHECKING:
    import pytest


def test_deep_research_registered_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FEATURE_DEEP_RESEARCH", raising=False)
    cfg = build_worker_config()
    assert "DeepResearchWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "create_deep_research_plan" in activity_names
    assert "finalize_deep_research" in activity_names


def test_deep_research_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "false")
    cfg = build_worker_config()
    assert "DeepResearchWorkflow" not in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "create_deep_research_plan" not in activity_names
    assert "finalize_deep_research" not in activity_names


def test_code_agent_omitted_when_flag_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FEATURE_CODE_AGENT", "false")
    cfg = build_worker_config()
    assert "CodeAgentWorkflow" not in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "generate_code_activity" not in activity_names
    assert "analyze_feedback_activity" not in activity_names


def test_code_agent_registered_when_flag_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FEATURE_CODE_AGENT", "true")
    cfg = build_worker_config()
    assert "CodeAgentWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "generate_code_activity" in activity_names
    assert "analyze_feedback_activity" in activity_names


def test_code_workspace_commands_omitted_when_flag_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("FEATURE_CODE_WORKSPACE_COMMANDS", raising=False)
    cfg = build_worker_config()
    activity_names = [a.__name__ for a in cfg.activities]
    assert "run_code_workspace_command_activity" not in activity_names


def test_code_workspace_commands_registered_when_flag_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEATURE_CODE_WORKSPACE_COMMANDS", "true")
    cfg = build_worker_config()
    assert "CodeWorkspaceCommandWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "run_code_workspace_command_activity" in activity_names


def test_code_workspace_repair_omitted_when_flag_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("FEATURE_CODE_WORKSPACE_REPAIR", raising=False)
    cfg = build_worker_config()
    assert "CodeWorkspaceRepairWorkflow" not in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "plan_code_workspace_repair" not in activity_names


def test_code_workspace_repair_registered_when_flag_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEATURE_CODE_WORKSPACE_REPAIR", "true")
    cfg = build_worker_config()
    assert "CodeWorkspaceRepairWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "plan_code_workspace_repair" in activity_names


def test_text_ingest_activity_registered() -> None:
    cfg = build_worker_config()
    activity_names = [a.__name__ for a in cfg.activities]
    assert "read_text_object" in activity_names


def test_chat_agent_workflow_registered() -> None:
    cfg = build_worker_config()
    assert "ChatAgentWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "execute_chat_run" in activity_names


def test_chat_agent_activity_has_no_heartbeat_timeout() -> None:
    source = Path("src/worker/workflows/chat_run_workflow.py").read_text()
    assert "heartbeat_timeout" not in source


def test_document_generation_omitted_when_flag_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FEATURE_DOCUMENT_GENERATION", raising=False)
    cfg = build_worker_config()
    assert "DocumentGenerationWorkflow" not in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "generate_document_artifact" not in activity_names
    assert "hydrate_document_generation_sources" not in activity_names
    assert "register_document_generation_result" not in activity_names


def test_document_generation_registered_when_flag_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FEATURE_DOCUMENT_GENERATION", "true")
    cfg = build_worker_config()
    assert "DocumentGenerationWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "hydrate_document_generation_sources" in activity_names
    assert "generate_document_artifact" in activity_names
    assert "register_document_generation_result" in activity_names


def test_google_workspace_export_omitted_when_flag_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("FEATURE_GOOGLE_WORKSPACE_EXPORT", raising=False)
    cfg = build_worker_config()
    assert "GoogleWorkspaceExportWorkflow" not in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "export_project_object_to_google_workspace" not in activity_names
    assert "finalize_google_workspace_export" not in activity_names


def test_google_workspace_export_registered_when_flag_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEATURE_GOOGLE_WORKSPACE_EXPORT", "true")
    cfg = build_worker_config()
    assert "GoogleWorkspaceExportWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "export_project_object_to_google_workspace" in activity_names
    assert "finalize_google_workspace_export" in activity_names


def test_enrichment_activities_omitted_when_flag_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("FEATURE_CONTENT_ENRICHMENT", raising=False)
    cfg = build_worker_config()
    activity_names = [a.__name__ for a in cfg.activities]
    assert "detect_content_type" not in activity_names
    assert "enrich_document" not in activity_names
    assert "store_enrichment_artifact" not in activity_names


def test_enrichment_activities_registered_when_flag_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEATURE_CONTENT_ENRICHMENT", "true")
    cfg = build_worker_config()
    activity_names = [a.__name__ for a in cfg.activities]
    assert "detect_content_type" in activity_names
    assert "enrich_document" in activity_names
    assert "store_enrichment_artifact" in activity_names
