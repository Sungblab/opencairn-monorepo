"""``finalize_deep_research`` Temporal activity.

Tells the API the workflow has reached a terminal state. The API route
flips ``researchRuns.status``, stamps ``completedAt``, and fires the
``research_complete`` notification (only on ``status='completed'``,
exactly once even under workflow retries).

Pure HTTP activity — no DB access here. Runs with maximum_attempts=5 so
a transient API outage doesn't drop a final-state update on the floor.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from temporalio import activity


@dataclass
class FinalizeInput:
    run_id: str
    status: str  # "completed" | "failed" | "cancelled"
    note_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None


PatchInternal = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


async def _run_finalize(
    inp: FinalizeInput,
    *,
    patch_internal: PatchInternal,
) -> dict[str, Any]:
    """Build the PATCH body and dispatch — separated from the activity
    decorator so unit tests can inject a mock ``patch_internal`` without
    needing the Temporal sandbox.
    """
    body: dict[str, Any] = {"status": inp.status}
    if inp.note_id is not None:
        body["noteId"] = inp.note_id
    if inp.error_code is not None:
        body["errorCode"] = inp.error_code
    if inp.error_message is not None:
        body["errorMessage"] = inp.error_message
    return await patch_internal(
        f"/api/internal/research/runs/{inp.run_id}/finalize",
        body,
    )


async def _default_patch_internal(
    path: str, body: dict[str, Any]
) -> dict[str, Any]:
    # Lazy import keeps the unit test free of httpx/env coupling.
    from worker.lib.api_client import patch_internal

    return await patch_internal(path, body)


@activity.defn(name="finalize_deep_research")
async def finalize_deep_research(inp: FinalizeInput) -> dict[str, Any]:
    return await _run_finalize(inp, patch_internal=_default_patch_internal)
