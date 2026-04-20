"""Shared fixtures for runtime tests."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from runtime.tools import _clear_registry_for_tests


@pytest.fixture(autouse=True)
def _reset_tool_registry() -> Iterator[None]:
    _clear_registry_for_tests()
    yield
    _clear_registry_for_tests()


@pytest.fixture
def tmp_trajectory_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated trajectory dir per test."""
    d = tmp_path / "trajectories"
    d.mkdir()
    monkeypatch.setenv("TRAJECTORY_BACKEND", "local")
    monkeypatch.setenv("TRAJECTORY_DIR", str(d))
    return d
