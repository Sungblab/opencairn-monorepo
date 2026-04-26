"""Tests for ``build_worker_config`` registration of the Code Agent
behind the ``FEATURE_CODE_AGENT`` flag (Plan 7 Phase 2 Task 7).

Mirrors the Deep Research feature-flag pattern exercised by the worker
entrypoint at ``worker.temporal_main``.
"""
from __future__ import annotations

import pytest

from worker.temporal_main import build_worker_config


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
