"""Single source of truth for synthesis-export status PATCH calls.

The three activities (fetch / synthesize / compile) all flip
`synthesis_runs.status` at their boundaries so the apps/api SSE stream
can react. Keeping the helper in one place prevents drift across the
URL template and the (small but non-empty) status enum.
"""
from __future__ import annotations

from worker.lib.api_client import patch_internal


async def set_status(run_id: str, status: str) -> None:
    """PATCH /api/internal/synthesis-export/runs/{run_id} with the given status.

    `status` must be one of the values accepted by the API's Zod enum:
    pending | fetching | synthesizing | compiling | completed | failed | cancelled.
    Type narrowing is done on the API side so we keep this signature loose
    here — callers in this directory pass literals.
    """
    await patch_internal(
        f"/api/internal/synthesis-export/runs/{run_id}",
        {"status": status},
    )
