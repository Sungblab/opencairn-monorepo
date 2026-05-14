"""Fixtures for Sub-project A integration tests.

Gated by GEMINI_API_KEY_CI; real fixtures (seeded_project, postgres_url)
are wired to the existing Plan 4 harness when the environment is ready.
Until then, the fixtures raise `NotImplementedError` if invoked — the
whole suite is module-level skipped when the env var is absent, so this
never fires in CI.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from runtime.tools import _clear_registry_for_tests

if TYPE_CHECKING:
    from collections.abc import Iterator


@pytest.fixture(autouse=True)
def _reset_tool_registry() -> Iterator[None]:
    _clear_registry_for_tests()
    yield
    _clear_registry_for_tests()


@pytest.fixture
def postgres_url() -> str:
    raise NotImplementedError(
        "Wire to existing Plan 4 postgres harness once GEMINI_API_KEY_CI lands."
    )


@pytest.fixture
async def seeded_project(postgres_url) -> str:  # noqa: ARG001
    raise NotImplementedError(
        "Seed a workspace+project with 3 concepts + 3 notes. "
        "Reuse Plan 4 fixture harness when present."
    )
