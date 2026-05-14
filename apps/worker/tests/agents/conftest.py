"""Reset the tool registry between tests."""
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
