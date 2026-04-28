"""End-to-end tests for :class:`CodeAgentWorkflow` (Plan 7 Phase 2 Task 6).

The workflow drives the Code Agent's self-healing loop: 1 generate turn +
up to 3 fix turns. We use the time-skipping Temporal env so the 30-min
idle abandon and the per-activity timeouts collapse to wall-clock
instants, and we replace the two real activities with name-matched stubs
so no LLM provider / DB is touched.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from worker.activities.code_activity import (
    ClientFeedback,
    CodeRunParams,
)
from worker.agents.code.agent import CodeOutput
from worker.workflows.code_workflow import (
    CodeAgentWorkflow,
    CodeRunResult,
    MAX_FIX_TURNS,
)


# ---------------------------------------------------------------------------
# Activity stubs registered by name so the workflow's
# ``execute_activity(generate_code_activity, ...)`` lookup matches.
# ---------------------------------------------------------------------------


@activity.defn(name="generate_code_activity")
async def _stub_generate(*args, **kwargs) -> CodeOutput:
    return CodeOutput(
        language="python", source="print('gen')", explanation="initial generate"
    )


@activity.defn(name="analyze_feedback_activity")
async def _stub_fix(*args, **kwargs) -> CodeOutput:
    return CodeOutput(
        language="python", source="print('fix')", explanation="fixed"
    )


def _params() -> CodeRunParams:
    return CodeRunParams(
        run_id="11111111-1111-1111-1111-111111111111",
        note_id="22222222-2222-2222-2222-222222222222",
        workspace_id="33333333-3333-3333-3333-333333333333",
        user_id="user-test",
        prompt="say hi",
        language="python",
        byok_key_handle=None,
    )


@pytest.mark.asyncio
async def test_completes_after_ok_feedback():
    """One generate + an ``ok`` feedback should terminate as ``completed``."""
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"code-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[CodeAgentWorkflow],
            activities=[_stub_generate, _stub_fix],
        ):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run,
                _params(),
                id=f"wf-ok-{uuid.uuid4().hex}",
                task_queue=task_queue,
            )
            await handle.signal(
                CodeAgentWorkflow.client_feedback, ClientFeedback(kind="ok")
            )
            result: CodeRunResult = await handle.result()

    assert result.status == "completed"
    assert len(result.history) == 1
    assert result.history[0].kind == "generate"
    assert result.history[0].seq == 0


@pytest.mark.asyncio
async def test_loops_up_to_max_turns():
    """Three error feedbacks in a row should produce 1 generate + 3 fix
    turns and terminate as ``max_turns``.

    To avoid a race where all three signals arrive before the workflow
    consumes any of them (the workflow consumes ``self._feedback`` between
    iterations), we send each signal AFTER observing that the prior turn
    has been recorded — by re-querying the workflow only via a small
    delay loop. The simpler shape is to send signals from inside the
    test as the workflow makes progress; we use ``env.sleep`` between
    sends so the workflow's wait_condition unblocks deterministically.
    """
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"code-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[CodeAgentWorkflow],
            activities=[_stub_generate, _stub_fix],
        ):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run,
                _params(),
                id=f"wf-max-{uuid.uuid4().hex}",
                task_queue=task_queue,
            )
            for _ in range(MAX_FIX_TURNS):
                await handle.signal(
                    CodeAgentWorkflow.client_feedback,
                    ClientFeedback(kind="error", error="boom", stdout=""),
                )
                # Yield to the workflow so it consumes this signal before
                # the next is queued. The time-skipping env collapses any
                # short delay; the only goal is to round-trip a workflow
                # task between signals.
                await env.sleep(timedelta(seconds=1))

            result: CodeRunResult = await handle.result()

    assert result.status == "max_turns"
    assert len(result.history) == 1 + MAX_FIX_TURNS  # 1 generate + 3 fix
    assert result.history[0].kind == "generate"
    for i in range(1, len(result.history)):
        assert result.history[i].kind == "fix"
        assert result.history[i].seq == i
        assert result.history[i].prev_error == "boom"


@pytest.mark.asyncio
async def test_abandons_after_idle():
    """No signal for 30 min → ``abandoned`` with a single (generate) turn."""
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"code-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[CodeAgentWorkflow],
            activities=[_stub_generate, _stub_fix],
        ):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run,
                _params(),
                id=f"wf-abandon-{uuid.uuid4().hex}",
                task_queue=task_queue,
            )
            # Push the test clock past the 30-min idle window. The
            # time-skipping env auto-advances when the workflow is idle,
            # but an explicit sleep here makes the intent explicit.
            await env.sleep(timedelta(minutes=31))
            result: CodeRunResult = await handle.result()

    assert result.status == "abandoned"
    assert len(result.history) == 1
    assert result.history[0].kind == "generate"


@pytest.mark.asyncio
async def test_wait_condition_false_abandons_without_assertion(monkeypatch):
    """Temporal wait_condition may return False on timeout; treat it as idle."""

    async def fake_execute_activity(*args, **kwargs) -> CodeOutput:
        return CodeOutput(
            language="python",
            source="print('gen')",
            explanation="initial generate",
        )

    async def fake_wait_condition(*args, **kwargs) -> bool:
        return False

    monkeypatch.setattr(
        "worker.workflows.code_workflow.workflow.execute_activity",
        fake_execute_activity,
    )
    monkeypatch.setattr(
        "worker.workflows.code_workflow.workflow.wait_condition",
        fake_wait_condition,
    )

    result = await CodeAgentWorkflow().run(_params())

    assert result.status == "abandoned"
    assert len(result.history) == 1
    assert result.history[0].kind == "generate"


@pytest.mark.asyncio
async def test_cancel_signal_terminates():
    """A ``cancel`` signal should short-circuit the loop with ``cancelled``."""
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"code-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[CodeAgentWorkflow],
            activities=[_stub_generate, _stub_fix],
        ):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run,
                _params(),
                id=f"wf-cancel-{uuid.uuid4().hex}",
                task_queue=task_queue,
            )
            await handle.signal(CodeAgentWorkflow.cancel)
            result: CodeRunResult = await handle.result()

    assert result.status == "cancelled"
    assert len(result.history) == 1
