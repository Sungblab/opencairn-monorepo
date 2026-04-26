"""VisualizeWorkflow — 1-activity wrapper around ``build_view`` (Plan 5 Phase 2).

Why a workflow at all: the Temporal TS client cannot start raw activities;
its only entry point is ``client.workflow.start``. The Vis Agent's heartbeat
loop is intrinsic to the activity, so we don't gain anything from a richer
workflow body — just a thin pass-through that lets the API layer get a
``WorkflowHandle`` (which ``streamBuildView`` polls via ``describe()`` and
awaits via ``result()``).

Timeouts mirror Task 7 (``build_view`` heartbeats every <30s; LLM tool turns
typically <15s). 60s start_to_close caps a runaway agent before the SSE
stream client gives up — the API streams Heartbeat events so a slow run is
visible to the user well before this fires.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow


@workflow.defn(name="VisualizeWorkflow")
class VisualizeWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        return await workflow.execute_activity(
            "build_view",
            req,
            start_to_close_timeout=timedelta(seconds=60),
            heartbeat_timeout=timedelta(seconds=30),
        )
