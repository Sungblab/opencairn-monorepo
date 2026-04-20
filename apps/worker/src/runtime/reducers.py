"""Custom LangGraph reducers."""
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def keep_last_n(n: int) -> Callable[[list[T], list[T] | T], list[T]]:
    """Return a LangGraph reducer that appends updates and keeps the last N items.

    Usage in state TypedDict:
        messages: Annotated[list[Message], keep_last_n(50)]
    """
    if n <= 0:
        raise ValueError(f"keep_last_n requires n > 0, got {n}")

    def reducer(state: list[T], updates: list[T] | T) -> list[T]:
        if isinstance(updates, list):
            merged = list(state) + list(updates)
        else:
            merged = list(state) + [updates]
        return merged[-n:]

    reducer.__name__ = f"keep_last_{n}"
    return reducer


__all__ = ["keep_last_n"]
