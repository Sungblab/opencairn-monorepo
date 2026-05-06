"""Temporal workflow for scheduled note analysis queue draining."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow


@workflow.defn(name="NoteAnalysisDrainWorkflow")
class NoteAnalysisDrainWorkflow:
    """Run one bounded drain pass for due note analysis jobs."""

    @workflow.run
    async def run(self, request: dict[str, Any]) -> dict[str, Any]:
        batch_size = int(request.get("batchSize") or 25)
        bounded_batch_size = max(1, min(batch_size, 100))
        return await workflow.execute_activity(
            "drain_note_analysis_jobs",
            {"batchSize": bounded_batch_size},
            schedule_to_close_timeout=timedelta(minutes=10),
        )
