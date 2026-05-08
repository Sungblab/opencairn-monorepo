"""CodeAgentWorkflow — Plan 7 Phase 2 Task 6.

Drives the Code Agent's self-healing loop: one ``generate`` turn followed
by up to three ``fix`` turns, gated on user feedback delivered via the
``client_feedback`` signal. The workflow itself is purely deterministic;
all DB writes (status flips, ``code_turns`` rows) happen inside the two
activities ``generate_code_activity`` and ``analyze_feedback_activity``.

Termination matrix
------------------
* ``completed``  — first ``client_feedback(kind="ok")`` arrives.
* ``max_turns``  — three error feedbacks consumed without an ``ok``.
* ``cancelled``  — ``cancel`` signal received before / between turns.
* ``abandoned``  — no signal for ``IDLE_ABANDON`` (30 min wall-clock,
  collapsed by the time-skipping test env).

Persistence of the terminal status itself is the API layer's job
(Task 9): it awaits ``handle.result()`` and writes ``CodeRunResult.status``
back to ``code_runs.status``. Adding ``set_run_status`` calls inside this
workflow would break determinism (Temporal sandbox forbids non-pure side
effects in workflow code).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Optional

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.code_activity import (
        ClientFeedback,
        CodeRunStatus,
        CodeRunParams,
        PersistedTurn,
        analyze_feedback_activity,
        finalize_code_run_activity,
        generate_code_activity,
    )
    from worker.agents.code.agent import CodeOutput


__all__ = [
    "ACTIVITY_HEARTBEAT",
    "ACTIVITY_START_TO_CLOSE",
    "CodeAgentWorkflow",
    "CodeRunResult",
    "IDLE_ABANDON",
    "MAX_FIX_TURNS",
]


MAX_FIX_TURNS = 3
IDLE_ABANDON = timedelta(minutes=30)
ACTIVITY_START_TO_CLOSE = timedelta(minutes=5)
ACTIVITY_HEARTBEAT = timedelta(seconds=30)


@dataclass
class CodeRunResult:
    """Returned to the API caller via ``handle.result()``.

    ``history`` is the ordered list of every persisted turn (max 4: one
    generate + up to three fixes). The API doesn't strictly need it on
    the return path — the rows are also in Postgres — but bundling it
    keeps the contract self-describing for tests and observability.
    """

    status: str  # "completed" | "max_turns" | "cancelled" | "abandoned"
    history: list[PersistedTurn] = field(default_factory=list)


@workflow.defn(name="CodeAgentWorkflow")
class CodeAgentWorkflow:
    def __init__(self) -> None:
        self._feedback: Optional[ClientFeedback] = None
        self._cancelled: bool = False

    @workflow.run
    async def run(self, params: CodeRunParams) -> CodeRunResult:
        history: list[PersistedTurn] = []

        # --- Turn 0 — generate -------------------------------------------------
        out: CodeOutput = await workflow.execute_activity(
            generate_code_activity,
            args=[params, history],
            start_to_close_timeout=ACTIVITY_START_TO_CLOSE,
            heartbeat_timeout=ACTIVITY_HEARTBEAT,
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        history.append(_to_persisted(0, "generate", out, prev_error=None))

        # --- Up to MAX_FIX_TURNS fix turns ------------------------------------
        for _ in range(MAX_FIX_TURNS):
            try:
                signalled = await workflow.wait_condition(
                    lambda: self._feedback is not None or self._cancelled,
                    timeout=IDLE_ABANDON,
                )
            except asyncio.TimeoutError:
                return await self._finish(params, "abandoned", history)

            if signalled is False:
                return await self._finish(params, "abandoned", history)

            if self._cancelled:
                return await self._finish(params, "cancelled", history)

            fb = self._feedback
            self._feedback = None  # consume — next iteration waits afresh

            if fb is None:
                return await self._finish(params, "abandoned", history)
            if fb.kind == "ok":
                return await self._finish(params, "completed", history)

            out = await workflow.execute_activity(
                analyze_feedback_activity,
                args=[params, history, fb],
                start_to_close_timeout=ACTIVITY_START_TO_CLOSE,
                heartbeat_timeout=ACTIVITY_HEARTBEAT,
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
            history.append(
                _to_persisted(len(history), "fix", out, prev_error=fb.error)
            )

        return await self._finish(params, "max_turns", history)

    # ------------------------------------------------------------------
    # Signals
    # ------------------------------------------------------------------

    @workflow.signal
    def client_feedback(self, fb: ClientFeedback) -> None:
        """Browser sandbox reports run outcome.

        ``kind="ok"`` ends the loop on the next iteration; ``kind="error"``
        triggers a fix turn. Cancelled workflows ignore late feedback so
        the cancellation path is preserved.
        """
        if not self._cancelled:
            self._feedback = fb

    @workflow.signal
    def cancel(self) -> None:
        """User abandoned the run from the UI. Latches; idempotent."""
        self._cancelled = True

    async def _finish(
        self,
        params: CodeRunParams,
        status: CodeRunStatus,
        history: list[PersistedTurn],
    ) -> CodeRunResult:
        await workflow.execute_activity(
            finalize_code_run_activity,
            args=[params.run_id, status],
            start_to_close_timeout=ACTIVITY_START_TO_CLOSE,
            heartbeat_timeout=ACTIVITY_HEARTBEAT,
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        return CodeRunResult(status=status, history=history)


def _to_persisted(
    seq: int,
    kind: str,
    out: "CodeOutput",
    *,
    prev_error: Optional[str],
) -> PersistedTurn:
    """Build the in-memory shadow of the row the activity just persisted.

    The DB write happens inside the activity (see
    ``worker.lib.code_persistence.persist_turn``); this just mirrors the
    shape so subsequent activities receive the full history without an
    extra round-trip.
    """
    return PersistedTurn(
        seq=seq,
        kind=kind,  # type: ignore[arg-type]
        source=out.source,
        explanation=out.explanation or "",
        prev_error=prev_error,
    )
