"""Shared fixtures for runtime tests."""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def tmp_trajectory_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated trajectory dir per test."""
    d = tmp_path / "trajectories"
    d.mkdir()
    monkeypatch.setenv("TRAJECTORY_BACKEND", "local")
    monkeypatch.setenv("TRAJECTORY_DIR", str(d))
    return d
