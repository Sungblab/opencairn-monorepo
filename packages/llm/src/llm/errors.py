"""Provider error taxonomy for tool-calling runtime.

`ToolLoopExecutor` differentiates `ProviderRetryableError` (propagate to
Temporal retry) vs `ProviderFatalError` (terminate loop with
`provider_error` reason). Providers raise these from their
`generate_with_tools` implementations.
"""
from __future__ import annotations


class ProviderError(Exception):
    """Base for all provider-layer errors."""


class ProviderRetryableError(ProviderError):
    """429, 5xx, network timeout — Temporal activity retry is safe."""


class ProviderFatalError(ProviderError):
    """401, 400, 413 — retry will not help; terminate loop."""


class ToolCallingNotSupported(ProviderFatalError):
    """Provider does not implement tool calling. Set LLM_PROVIDER to one
    that does (e.g. gemini) or implement the method."""
