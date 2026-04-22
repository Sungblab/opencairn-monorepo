"""``DeepResearchWorkflow`` — orchestrates a full Deep Research run.

State machine:
    planning → awaiting_approval → researching → completed
    any → failed (non-retryable activity error)
    any (before researching completes) → cancelled (user signal or 24h abandon)

The workflow is the single source of truth for run state; the DB row
(Phase C) is a projection updated via the internal API after each
transition. On replay, signal history is replayed deterministically so
iteration order is preserved.

Activity returns are plain dicts (matches the convention established by
``batch_embed_activities`` and avoids cross-module dataclass registration
on the Temporal data converter).
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from worker.activities.deep_research.create_plan import CreatePlanInput
    from worker.activities.deep_research.iterate_plan import IteratePlanInput
    from worker.activities.deep_research.execute_research import (
        ExecuteResearchInput,
    )
    from worker.activities.deep_research.persist_report import (
        PersistReportInput,
    )


_PLAN_TIMEOUT = timedelta(minutes=15)
_EXEC_TIMEOUT = timedelta(minutes=70)
_PERSIST_TIMEOUT = timedelta(minutes=10)
_ABANDON_TIMEOUT = timedelta(hours=24)


@dataclass
class DeepResearchInput:
    run_id: str
    workspace_id: str
    project_id: str
    user_id: str
    topic: str
    model: str
    billing_path: str  # "byok" | "managed"


@dataclass
class DeepResearchOutput:
    status: str  # "completed" | "failed" | "cancelled"
    note_id: str | None = None
    total_cost_usd_cents: int | None = None
    error: dict[str, Any] | None = None


def _feature_disabled() -> DeepResearchOutput:
    return DeepResearchOutput(
        status="failed",
        error={
            "code": "feature_disabled",
            "message": "FEATURE_DEEP_RESEARCH=false",
            "retryable": False,
        },
    )


def _managed_disabled() -> DeepResearchOutput:
    return DeepResearchOutput(
        status="failed",
        error={
            "code": "managed_disabled",
            "message": "Managed path disabled — use BYOK.",
            "retryable": False,
        },
    )


@workflow.defn(name="DeepResearchWorkflow")
class DeepResearchWorkflow:
    def __init__(self) -> None:
        self._approved_plan: str | None = None
        self._feedback_queue: list[tuple[str, str]] = []
        self._cancelled: bool = False
        self._last_interaction_id: str | None = None

    @workflow.signal
    async def user_feedback(self, text: str, turn_id: str = "") -> None:
        """User asked for plan changes. Queued for the next iterate_plan."""
        self._feedback_queue.append((text, turn_id))

    @workflow.signal
    async def approve_plan(self, final_plan_text: str) -> None:
        """User approved the plan. Research can begin."""
        self._approved_plan = final_plan_text

    @workflow.signal
    async def cancel(self) -> None:
        self._cancelled = True

    @workflow.query
    def status_snapshot(self) -> dict[str, Any]:
        return {
            "approved": self._approved_plan is not None,
            "pending_feedback": len(self._feedback_queue),
            "cancelled": self._cancelled,
            "interaction_id": self._last_interaction_id,
        }

    @workflow.run
    async def run(self, inp: DeepResearchInput) -> DeepResearchOutput:
        if os.environ.get("FEATURE_DEEP_RESEARCH", "false").lower() != "true":
            return _feature_disabled()
        if (
            inp.billing_path == "managed"
            and os.environ.get(
                "FEATURE_MANAGED_DEEP_RESEARCH", "false"
            ).lower()
            != "true"
        ):
            return _managed_disabled()

        try:
            plan_out: dict[str, str] = await workflow.execute_activity(
                "create_deep_research_plan",
                CreatePlanInput(
                    run_id=inp.run_id,
                    user_id=inp.user_id,
                    topic=inp.topic,
                    model=inp.model,
                    billing_path=inp.billing_path,
                ),
                start_to_close_timeout=_PLAN_TIMEOUT,
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
            self._last_interaction_id = plan_out["interaction_id"]
            current_plan_text = plan_out["plan_text"]

            # Loop on feedback until user approves or abandons.
            while self._approved_plan is None and not self._cancelled:
                reached = await workflow.wait_condition(
                    lambda: self._approved_plan is not None
                    or self._cancelled
                    or bool(self._feedback_queue),
                    timeout=_ABANDON_TIMEOUT,
                )
                if not reached:
                    return DeepResearchOutput(
                        status="cancelled",
                        error={
                            "code": "abandoned",
                            "message": "No user action for 24h",
                            "retryable": False,
                        },
                    )
                if self._cancelled:
                    break
                if self._approved_plan is not None:
                    break
                feedback_text, _turn_id = self._feedback_queue.pop(0)
                iter_out: dict[str, str] = await workflow.execute_activity(
                    "iterate_deep_research_plan",
                    IteratePlanInput(
                        run_id=inp.run_id,
                        user_id=inp.user_id,
                        feedback=feedback_text,
                        model=inp.model,
                        billing_path=inp.billing_path,
                        previous_interaction_id=self._last_interaction_id or "",
                    ),
                    start_to_close_timeout=_PLAN_TIMEOUT,
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                self._last_interaction_id = iter_out["interaction_id"]
                current_plan_text = iter_out["plan_text"]

            if self._cancelled:
                return DeepResearchOutput(
                    status="cancelled",
                    error={
                        "code": "user_cancelled",
                        "message": "User cancelled run",
                        "retryable": False,
                    },
                )

            approved = self._approved_plan or current_plan_text

            exec_task = asyncio.ensure_future(
                workflow.execute_activity(
                    "execute_deep_research",
                    ExecuteResearchInput(
                        run_id=inp.run_id,
                        user_id=inp.user_id,
                        approved_plan=approved,
                        model=inp.model,
                        billing_path=inp.billing_path,
                        previous_interaction_id=self._last_interaction_id or "",
                    ),
                    start_to_close_timeout=_EXEC_TIMEOUT,
                    heartbeat_timeout=timedelta(seconds=60),
                    retry_policy=RetryPolicy(
                        maximum_attempts=2,
                        non_retryable_error_types=[
                            "quota_exceeded",
                            "invalid_byok_key",
                        ],
                    ),
                )
            )
            await workflow.wait_condition(
                lambda: self._cancelled or exec_task.done()
            )
            if self._cancelled and not exec_task.done():
                exec_task.cancel()
                try:
                    await exec_task
                except Exception:
                    pass
                return DeepResearchOutput(
                    status="cancelled",
                    error={
                        "code": "user_cancelled",
                        "message": "User cancelled run",
                        "retryable": False,
                    },
                )
            exec_out: dict[str, Any] = await exec_task

            persist_out: dict[str, Any] = await workflow.execute_activity(
                "persist_deep_research_report",
                PersistReportInput(
                    run_id=inp.run_id,
                    workspace_id=inp.workspace_id,
                    project_id=inp.project_id,
                    user_id=inp.user_id,
                    topic=inp.topic,
                    model=inp.model,
                    billing_path=inp.billing_path,
                    approved_plan=approved,
                    report_text=exec_out["report_text"],
                    images=exec_out["images"],
                    citations=exec_out["citations"],
                ),
                start_to_close_timeout=_PERSIST_TIMEOUT,
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            return DeepResearchOutput(
                status="completed",
                note_id=persist_out["note_id"],
                total_cost_usd_cents=persist_out["total_cost_usd_cents"],
            )

        except ActivityError as err:
            cause = err.cause
            code = "unknown"
            msg = str(cause)
            if isinstance(cause, ApplicationError):
                code = cause.type or code
                msg = cause.message
            return DeepResearchOutput(
                status="failed",
                error={"code": code, "message": msg, "retryable": False},
            )
