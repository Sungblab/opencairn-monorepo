"""Helper: compute an activity ``start_to_close_timeout`` that accommodates
the Plan 3b batch-embed path when its flag is on.

Caller activities (``compile_note``, ``run_librarian``) hand off embedding
work to :class:`BatchEmbedWorkflow` via :func:`make_batch_submit`. That
workflow legally waits up to ``BATCH_EMBED_MAX_WAIT_SECONDS`` (default
24 h) on Gemini's async batch API. The caller activity slot must outlast
that wait, per ``worker/lib/batch_submit.py:17``. Otherwise, turning the
``BATCH_EMBED_*_ENABLED`` flag on instantly breaks production.

This helper is env-driven + pure so workflow modules can compute the
right constant at import time (inside Temporal's deterministic sandbox).
"""
from __future__ import annotations

import os
from datetime import timedelta
from typing import Mapping

# Safety buffer between the batch-workflow's own wait cap and the caller
# activity's timeout. Covers submit/poll/fetch latency plus the
# client-connect overhead of :func:`make_batch_submit`.
_SAFETY_BUFFER = timedelta(minutes=10)
_DEFAULT_MAX_WAIT_SECONDS = 24 * 60 * 60


def _is_truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _max_wait_seconds(env: Mapping[str, str]) -> int:
    raw = env.get("BATCH_EMBED_MAX_WAIT_SECONDS")
    if not raw:
        return _DEFAULT_MAX_WAIT_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_MAX_WAIT_SECONDS
    return value if value > 0 else _DEFAULT_MAX_WAIT_SECONDS


def batch_aware_start_timeout(
    base: timedelta,
    *,
    flag_env: str,
    env: Mapping[str, str] | None = None,
) -> timedelta:
    """Return ``base`` extended to cover the batch-embed wait cap when on.

    Args:
        base: The caller's natural activity timeout (e.g. 10 min for
            Compiler, 1 h for Librarian). Applied unchanged when the
            feature flag is off — we don't want to widen the activity's
            liveness envelope when the batch path isn't in use.
        flag_env: Name of the per-caller feature flag env var
            (``BATCH_EMBED_COMPILER_ENABLED`` or
            ``BATCH_EMBED_LIBRARIAN_ENABLED``). Each caller rolls out
            independently (Compiler has 24 h indexing SLA cost that
            Librarian doesn't), so we don't short-circuit from a single
            global env var.
        env: Env mapping. Defaults to :data:`os.environ`. Accepting an
            injected mapping keeps the function pure for tests and
            avoids a hidden :mod:`os` import at workflow-module time.

    Returns:
        ``base`` when the flag is off, otherwise
        ``max(base, BATCH_EMBED_MAX_WAIT_SECONDS + 10 min)``. The
        watchdog responsibility stays with ``heartbeat_timeout`` — a
        genuinely stuck activity still gets killed on the first missed
        heartbeat regardless of this ceiling.
    """
    env = env if env is not None else os.environ
    if not _is_truthy(env.get(flag_env)):
        return base
    batch_envelope = timedelta(seconds=_max_wait_seconds(env)) + _SAFETY_BUFFER
    return batch_envelope if batch_envelope > base else base
