"""Tests for ``build_worker_config`` registration of the Code Agent
behind the ``FEATURE_CODE_AGENT`` flag (Plan 7 Phase 2 Task 7).

Mirrors the Deep Research feature-flag pattern exercised by the worker
entrypoint at ``worker.temporal_main``.
"""
from __future__ import annotations

import pytest

from worker.temporal_main import build_worker_config


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
