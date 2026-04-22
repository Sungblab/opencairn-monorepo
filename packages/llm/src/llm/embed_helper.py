"""``embed_many()`` — the single entry point agents use instead of
:meth:`LLMProvider.embed` directly.

Plan 3b routes document-time embedding traffic through Gemini's batch API
for the ~50 % cost saving, but only when the batch is large enough, the
feature flag is enabled, and the provider advertises batch support.
Everything else (Research, chat RAG, Ollama, small batches) goes through
the existing synchronous path unchanged.

This module deliberately **does not import Temporal**. ``packages/llm`` is
a shared contract used by both the worker (Temporal) and direct scripts,
so the caller passes ``batch_submit`` as a plain async callable. In the
worker, that callback wraps ``workflow.execute_child_workflow`` / the
Temporal Client start pattern — see
``apps/worker/src/worker/workflows/batch_embed_workflow.py``.
"""
from __future__ import annotations

import logging
import os
from typing import Awaitable, Callable, Protocol, Sequence

from .base import EmbedInput, LLMProvider
from .batch_types import BatchNotSupported

logger = logging.getLogger(__name__)

# Feature flags and thresholds. All callers share one env space; per-caller
# overrides (Compiler vs Librarian) live in the caller module, not here.
ENV_BATCH_ENABLED_COMPILER = "BATCH_EMBED_COMPILER_ENABLED"
ENV_BATCH_ENABLED_LIBRARIAN = "BATCH_EMBED_LIBRARIAN_ENABLED"
ENV_BATCH_MIN_ITEMS = "BATCH_EMBED_MIN_ITEMS"
DEFAULT_MIN_ITEMS = 8


class _BatchSubmit(Protocol):
    """Async callable the worker injects to run a :class:`BatchEmbedWorkflow`.

    Signature mirrors the workflow's public contract — the caller is
    responsible for durability, retry policy, and partial-failure
    reporting. A ``None`` slot in the returned list means that item failed
    at the provider; caller-specific policy (drop / retry-next-sweep)
    lives at the call site, not here.
    """

    async def __call__(
        self,
        inputs: Sequence[EmbedInput],
        *,
        workspace_id: str | None,
    ) -> list[list[float] | None]: ...


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _min_items() -> int:
    raw = os.getenv(ENV_BATCH_MIN_ITEMS)
    if not raw:
        return DEFAULT_MIN_ITEMS
    try:
        return max(1, int(raw))
    except ValueError:
        logger.warning(
            "Invalid %s=%r, falling back to %d",
            ENV_BATCH_MIN_ITEMS,
            raw,
            DEFAULT_MIN_ITEMS,
        )
        return DEFAULT_MIN_ITEMS


async def embed_many(
    provider: LLMProvider,
    inputs: Sequence[EmbedInput],
    *,
    workspace_id: str | None,
    batch_submit: _BatchSubmit | None = None,
    flag_env: str = ENV_BATCH_ENABLED_LIBRARIAN,
) -> list[list[float] | None]:
    """Embed ``inputs`` via the batch path when eligible, else synchronously.

    The batch path is taken when **all** of the following hold:

    1. ``batch_submit`` is not ``None`` (callers running outside the worker
       — tests, scripts — always get the sync path).
    2. The per-caller flag ``flag_env`` resolves truthy. Compiler and
       Librarian use different env vars so ops can roll them out
       independently (Compiler has a 24 h SLA cost that Librarian doesn't).
    3. ``len(inputs) >= BATCH_EMBED_MIN_ITEMS`` — below the threshold the
       batch-tier savings don't outweigh the orchestration overhead and
       the added latency is still up to hours.
    4. ``provider.supports_batch_embed`` is true (Ollama is always false).

    On any recoverable failure (``BatchNotSupported`` or the workflow
    raising), falls through to :meth:`provider.embed` silently so the
    caller's availability is unchanged; a WARNING log records the fallback
    reason. Hard errors from ``provider.embed`` propagate.

    Returns a list aligned 1:1 with ``inputs`` where ``result[i] is None``
    means item ``i`` failed at the provider — either the batch reported a
    per-item error or the fallback's ``embed`` raised on just that text.
    """
    items = list(inputs)
    if not items:
        return []

    take_batch = (
        batch_submit is not None
        and _env_flag(flag_env)
        and len(items) >= _min_items()
        and provider.supports_batch_embed
    )

    if take_batch:
        try:
            # batch_submit is the worker-injected callback; it runs the
            # Temporal workflow that owns submission, polling, and
            # JSONL-sidecar fetch. See batch_embed_workflow.py.
            assert batch_submit is not None  # narrow for type checker
            return await batch_submit(items, workspace_id=workspace_id)
        except BatchNotSupported as exc:
            logger.warning(
                "Batch path unsupported by provider, falling back to sync: %s",
                exc,
            )
        except Exception as exc:  # noqa: BLE001
            # Keep availability; the counter is emitted from the worker-
            # side callback, so we don't double-count here.
            logger.warning(
                "Batch embed failed (%s); falling back to sync path",
                exc,
            )

    # Sync fallback — same shape as batch path (list[list[float] | None]).
    # First try a single bulk call (efficient). If it raises, fall back
    # per-item so one bad input doesn't poison the whole list — this
    # preserves the pre-Plan-3b semantics where each caller loop had its
    # own try/except around one embedding.
    try:
        vecs = await provider.embed(list(items))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "provider.embed bulk call failed (%s); retrying per-item to isolate failures",
            exc,
        )
        return await _embed_per_item_fallback(provider, items)
    # provider.embed can return fewer items than inputs when some had no
    # text (EmbedInput.text is None/empty) — Gemini's implementation
    # filters those out. Re-align by index so the caller can zip safely.
    out: list[list[float] | None] = []
    vec_iter = iter(vecs)
    for inp in items:
        if inp.text:
            out.append(next(vec_iter, None))
        else:
            out.append(None)
    return out


async def _embed_per_item_fallback(
    provider: LLMProvider,
    items: list[EmbedInput],
) -> list[list[float] | None]:
    """One provider.embed call per item — isolates per-item failures.

    Used only after the bulk call raised. Slower (N round-trips) but
    preserves the pre-3b Compiler behaviour where one failed concept
    doesn't tank the whole note.
    """
    out: list[list[float] | None] = []
    for inp in items:
        if not inp.text:
            out.append(None)
            continue
        try:
            vec = await provider.embed([inp])
            out.append(vec[0] if vec else None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("per-item embed failed for text=%r: %s", inp.text[:60], exc)
            out.append(None)
    return out
