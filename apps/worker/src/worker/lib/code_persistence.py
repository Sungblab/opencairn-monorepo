"""Persist code-run turns + status transitions via the internal API.

apps/api owns ALL business logic — the worker never touches Postgres
directly. Calls go through ``worker.lib.api_client`` so they reuse the
shared internal-secret header + httpx timeout policy.

Routes (added in Task 9):
- POST  /api/internal/code/turns                → insert one ``code_turns`` row
- PATCH /api/internal/code/runs/:id/status      → set ``code_runs.status``
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from worker.lib.api_client import patch_internal, post_internal

if TYPE_CHECKING:
    from worker.activities.code_status import CodeRunStatus


async def persist_turn(
    *,
    run_id: str,
    seq: int,
    kind: Literal["generate", "fix"],
    source: str,
    explanation: str,
    prev_error: str | None,
) -> None:
    """Insert one ``code_turns`` row for ``run_id``.

    Idempotency on (run_id, seq) is enforced server-side; the activity
    layer just sends the canonical fields. ``prev_error`` is null for
    the first turn (kind="generate") and carries the client-reported
    failure that triggered the fix on subsequent turns.
    """
    await post_internal(
        "/api/internal/code/turns",
        {
            "runId": run_id,
            "seq": seq,
            "kind": kind,
            "source": source,
            "explanation": explanation,
            "prevError": prev_error,
        },
    )


async def set_run_status(run_id: str, status: CodeRunStatus) -> None:
    """Patch ``code_runs.status`` for ``run_id``.

    Allowed transitions are validated server-side; callers pass the raw
    string (``running``, ``awaiting_feedback``, ``completed``,
    ``max_turns``, ``cancelled``, ``abandoned``, ``failed``).
    """
    await patch_internal(
        f"/api/internal/code/runs/{run_id}/status",
        {"status": status},
    )
