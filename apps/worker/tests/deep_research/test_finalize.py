"""Unit tests for ``finalize_deep_research`` activity (Plan 2C Task 7).

Pure activity — no DB. Verifies the HTTP body it builds for each status
branch and that ``patch_internal`` is invoked exactly once.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

from worker.activities.deep_research.finalize import (
    FinalizeInput,
    _run_finalize,
)


async def test_finalize_completed_passes_note_id():
    patch_internal = AsyncMock(return_value={"ok": True, "alreadyFinalized": False})
    out = await _run_finalize(
        FinalizeInput(run_id="run-1", status="completed", note_id="note-1"),
        patch_internal=patch_internal,
    )
    patch_internal.assert_called_once()
    args, _ = patch_internal.call_args
    assert args[0] == "/api/internal/research/runs/run-1/finalize"
    assert args[1] == {"status": "completed", "noteId": "note-1"}
    assert out["ok"] is True


async def test_finalize_failed_passes_error_fields():
    patch_internal = AsyncMock(return_value={"ok": True, "alreadyFinalized": False})
    await _run_finalize(
        FinalizeInput(
            run_id="run-1",
            status="failed",
            error_code="rate_limit",
            error_message="429",
        ),
        patch_internal=patch_internal,
    )
    args, _ = patch_internal.call_args
    assert args[0] == "/api/internal/research/runs/run-1/finalize"
    assert args[1] == {
        "status": "failed",
        "errorCode": "rate_limit",
        "errorMessage": "429",
    }


async def test_finalize_cancelled_minimal_payload():
    patch_internal = AsyncMock(return_value={"ok": True, "alreadyFinalized": False})
    await _run_finalize(
        FinalizeInput(run_id="run-1", status="cancelled"),
        patch_internal=patch_internal,
    )
    args, _ = patch_internal.call_args
    assert args[0] == "/api/internal/research/runs/run-1/finalize"
    assert args[1] == {"status": "cancelled"}
