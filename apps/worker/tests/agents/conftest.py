"""Reset the tool registry between tests."""
from __future__ import annotations

from collections.abc import Iterator

import pytest

from runtime.tools import _clear_registry_for_tests


@pytest.fixture(autouse=True)
def _reset_tool_registry() -> Iterator[None]:
    _clear_registry_for_tests()
    yield
    _clear_registry_for_tests()
