"""SocraticWorkflow — thin Temporal wrapper for Socratic activities (Plan 6).

Two workflow classes (one per activity) keep the workflowId namespace clean
and make it easy to cancel or query individual operations. Both are short-lived
(<10s) — the Temporal TS client awaits result() synchronously.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow


@workflow.defn(name="SocraticGenerateWorkflow")
class SocraticGenerateWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        return await workflow.execute_activity(
            "socratic_generate",
            req,
            start_to_close_timeout=timedelta(seconds=30),
        )


@workflow.defn(name="SocraticEvaluateWorkflow")
class SocraticEvaluateWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        return await workflow.execute_activity(
            "socratic_evaluate",
            req,
            start_to_close_timeout=timedelta(seconds=30),
        )
