"""Batch-embedding surface types for :class:`~llm.base.LLMProvider`.

Kept in a separate module from :mod:`llm.base` so callers (workflows,
activities, helpers) can import the lightweight dataclasses without pulling
in the provider ABC or SDK dependencies.

State strings are normalised provider-agnostic values so downstream callers
don't have to import Gemini's :class:`~google.genai.types.JobState` enum.
"""
from __future__ import annotations

from dataclasses import dataclass


# Normalised, provider-agnostic state strings. Kept as str not Enum so the
# values are trivially JSON/Temporal-payload safe and so the DB enum
# (`embedding_batches.state`) can use the same vocabulary.
BATCH_STATE_PENDING = "pending"
BATCH_STATE_RUNNING = "running"
BATCH_STATE_SUCCEEDED = "succeeded"
BATCH_STATE_FAILED = "failed"
BATCH_STATE_CANCELLED = "cancelled"
BATCH_STATE_EXPIRED = "expired"

BATCH_TERMINAL_STATES = frozenset(
    {
        BATCH_STATE_SUCCEEDED,
        BATCH_STATE_FAILED,
        BATCH_STATE_CANCELLED,
        BATCH_STATE_EXPIRED,
    }
)


@dataclass(frozen=True)
class BatchEmbedHandle:
    """Opaque reference to a submitted batch job.

    The handle is workflow-safe (no bytes, no SDK objects) so Temporal can
    persist it between activity invocations. ``provider_batch_name`` is the
    provider's native identifier — for Gemini it looks like ``batches/abc123``.
    """

    provider_batch_name: str
    submitted_at: float
    input_count: int


@dataclass(frozen=True)
class BatchEmbedPoll:
    """Point-in-time status snapshot for a batch.

    ``done`` is true when the batch has reached a terminal state — callers
    should check this first and only read per-item counts afterwards.
    """

    state: str
    request_count: int
    successful_request_count: int
    failed_request_count: int
    pending_request_count: int
    done: bool


@dataclass(frozen=True)
class BatchEmbedResult:
    """Aligned per-item results.

    ``vectors[i] is None`` means item ``i`` failed at the provider; the
    corresponding ``errors[i]`` is a human-readable string (never ``None``
    in that case, to simplify downstream ``if errors[i]:`` checks).
    """

    vectors: list[list[float] | None]
    errors: list[str | None]


class BatchNotSupported(RuntimeError):
    """Raised when a provider cannot run the batch embed surface.

    Callers (e.g. :func:`llm.embed_helper.embed_many`) catch this to fall
    back to the synchronous :meth:`~llm.base.LLMProvider.embed` path without
    treating it as a hard error.
    """
