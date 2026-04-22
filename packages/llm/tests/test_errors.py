from __future__ import annotations

import pytest

from llm.errors import (
    ProviderError,
    ProviderFatalError,
    ProviderRetryableError,
    ToolCallingNotSupported,
)


def test_hierarchy():
    assert issubclass(ProviderRetryableError, ProviderError)
    assert issubclass(ProviderFatalError, ProviderError)
    assert issubclass(ToolCallingNotSupported, ProviderFatalError)


def test_retryable_vs_fatal_are_distinct():
    with pytest.raises(ProviderRetryableError):
        raise ProviderRetryableError("rate limit")

    with pytest.raises(ProviderFatalError):
        raise ProviderFatalError("unauthorized")


def test_tool_not_supported_is_fatal():
    with pytest.raises(ProviderFatalError):
        raise ToolCallingNotSupported("ollama stub")
