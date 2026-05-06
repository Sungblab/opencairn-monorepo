"""Drain durable note analysis jobs through the API-owned runner."""

from __future__ import annotations

from typing import Any

from temporalio import activity

from worker.lib.api_client import post_internal


async def drain_note_analysis_jobs(request: dict[str, Any]) -> dict[str, Any]:
    batch_size = int(request.get("batchSize") or 25)
    bounded_batch_size = max(1, min(batch_size, 100))
    return await post_internal(
        "/api/internal/note-analysis-jobs/drain",
        {"batchSize": bounded_batch_size},
    )


@activity.defn(name="drain_note_analysis_jobs")
async def drain_note_analysis_jobs_activity(request: dict[str, Any]) -> dict[str, Any]:
    return await drain_note_analysis_jobs(request)
