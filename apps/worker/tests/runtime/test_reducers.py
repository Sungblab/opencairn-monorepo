"""Tests for keep_last_n reducer."""
from __future__ import annotations

import pytest

from runtime.reducers import keep_last_n


def test_keeps_most_recent() -> None:
    reducer = keep_last_n(3)
    state = [1, 2]
    updates = [3, 4, 5]
    merged = reducer(state, updates)
    assert merged == [3, 4, 5]


def test_preserves_order_when_under_cap() -> None:
    reducer = keep_last_n(5)
    merged = reducer([1, 2], [3])
    assert merged == [1, 2, 3]


def test_empty_state() -> None:
    reducer = keep_last_n(2)
    assert reducer([], [1, 2, 3]) == [2, 3]


def test_empty_update_returns_state() -> None:
    reducer = keep_last_n(3)
    assert reducer([1, 2, 3], []) == [1, 2, 3]


def test_n_must_be_positive() -> None:
    with pytest.raises(ValueError):
        keep_last_n(0)
    with pytest.raises(ValueError):
        keep_last_n(-1)


def test_handles_single_update_not_list() -> None:
    """Reducer must tolerate a single-item update (not just lists)."""
    reducer = keep_last_n(3)
    merged = reducer([1, 2], 3)
    assert merged == [1, 2, 3]
