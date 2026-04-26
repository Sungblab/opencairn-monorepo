"""End-to-end ``DeepResearchWorkflow`` tests.

Activities are replaced with in-test stubs registered under the same
activity names as the real ``@activity.defn`` entries. We're validating
orchestration (signals, state transitions, feature gates) not the
activity logic itself.

pytest-asyncio mode=auto (see pyproject.toml) makes ``async def``
test functions run directly without @pytest.mark.asyncio.
"""
from __future__ import annotations

import uuid

from temporalio import activity
from temporalio.exceptions import ApplicationError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from worker.workflows.deep_research_workflow import (
    DeepResearchInput,
    DeepResearchOutput,
    DeepResearchWorkflow,
)


# --- Activity stubs. Names must match the real @activity.defn registrations.


@activity.defn(name="create_deep_research_plan")
async def _stub_create_plan(_inp) -> dict:
    return {"interaction_id": "int-plan", "plan_text": "Initial plan."}


@activity.defn(name="iterate_deep_research_plan")
async def _stub_iterate_plan(_inp) -> dict:
    return {"interaction_id": "int-plan-v2", "plan_text": "Iterated plan."}


# Module-level toggle: when True, the execute stub raises a
# non-retryable ApplicationError instead of returning success. Tests
# flip this before scheduling the workflow and reset in finally.
_execute_should_fail: bool = False


@activity.defn(name="execute_deep_research")
async def _stub_execute(_inp) -> dict:
    if _execute_should_fail:
        raise ApplicationError(
            "rate limit hit",
            type="rate_limit",
            non_retryable=True,
        )
    return {
        "interaction_id": "int-exec",
        "report_text": "Done.",
        "images": [],
        "citations": [],
    }


@activity.defn(name="persist_deep_research_report")
async def _stub_persist(_inp) -> dict:
    return {"note_id": "note-final", "total_cost_usd_cents": 200}


# Module-level call recorder for the ``finalize_deep_research`` stub.
# Each test resets it before scheduling the workflow. Activities are
# registered by reference, so a closure-based stub-factory wouldn't work
# (Temporal needs the stable @activity.defn decorator). A module-level
# list + reset-before-start is the simplest deterministic pattern.
_finalize_calls: list[dict] = []


@activity.defn(name="finalize_deep_research")
async def _stub_finalize(inp) -> dict:
    # ``inp`` is the dataclass FinalizeInput — store its public fields.
    _finalize_calls.append(
        {
            "run_id": inp.run_id,
            "status": inp.status,
            "note_id": inp.note_id,
            "error_code": inp.error_code,
            "error_message": inp.error_message,
        }
    )
    return {"ok": True, "alreadyFinalized": False}


async def test_happy_path_approve_immediately(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")
    _finalize_calls.clear()

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[
                _stub_create_plan,
                _stub_iterate_plan,
                _stub_execute,
                _stub_persist,
                _stub_finalize,
            ],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            await handle.signal(DeepResearchWorkflow.approve_plan, "Initial plan.")
            result = await handle.result()

            assert isinstance(result, DeepResearchOutput)
            assert result.note_id == "note-final"
            assert result.status == "completed"
            assert result.total_cost_usd_cents == 200

            # finalize fires exactly once with status=completed + note_id.
            assert len(_finalize_calls) == 1
            assert _finalize_calls[0]["status"] == "completed"
            assert _finalize_calls[0]["note_id"] == "note-final"
            assert _finalize_calls[0]["run_id"] == run_id


async def test_feature_flag_off_fails_fast(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "false")
    _finalize_calls.clear()

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[
                _stub_create_plan,
                _stub_iterate_plan,
                _stub_execute,
                _stub_persist,
                _stub_finalize,
            ],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            result = await handle.result()
            assert result.status == "failed"
            assert result.error["code"] == "feature_disabled"
            # Feature-disabled path returns BEFORE any run row exists, so
            # we deliberately skip finalize — see workflow.run.
            assert _finalize_calls == []


async def test_managed_disabled_flag_rejects_managed(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")
    monkeypatch.setenv("FEATURE_MANAGED_DEEP_RESEARCH", "false")
    _finalize_calls.clear()

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[
                _stub_create_plan,
                _stub_iterate_plan,
                _stub_execute,
                _stub_persist,
                _stub_finalize,
            ],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="managed",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            result = await handle.result()
            assert result.status == "failed"
            assert result.error["code"] == "managed_disabled"
            # Managed-disabled returns before any run row — no finalize.
            assert _finalize_calls == []


async def test_user_cancel_during_plan_loop_finalizes(monkeypatch):
    """Cancel signal received before approval routes through the
    plan-loop user_cancelled return — finalize must fire once with
    status=cancelled."""
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")
    _finalize_calls.clear()

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[
                _stub_create_plan,
                _stub_iterate_plan,
                _stub_execute,
                _stub_persist,
                _stub_finalize,
            ],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            await handle.signal(DeepResearchWorkflow.cancel)
            result = await handle.result()

            assert result.status == "cancelled"
            assert result.error["code"] == "user_cancelled"
            assert len(_finalize_calls) == 1
            assert _finalize_calls[0]["status"] == "cancelled"
            assert _finalize_calls[0]["run_id"] == run_id
            assert _finalize_calls[0]["note_id"] is None


async def test_activity_error_finalizes_failed(monkeypatch):
    """``execute_deep_research`` raising a non-retryable ApplicationError
    funnels through ``except ActivityError`` — finalize must fire once
    with status=failed and propagate the error code/message."""
    global _execute_should_fail
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")
    _finalize_calls.clear()
    _execute_should_fail = True
    try:
        async with await WorkflowEnvironment.start_time_skipping() as env:
            task_queue = f"dr-{uuid.uuid4().hex[:8]}"
            async with Worker(
                env.client,
                task_queue=task_queue,
                workflows=[DeepResearchWorkflow],
                activities=[
                    _stub_create_plan,
                    _stub_iterate_plan,
                    _stub_execute,
                    _stub_persist,
                    _stub_finalize,
                ],
            ):
                run_id = str(uuid.uuid4())
                handle = await env.client.start_workflow(
                    DeepResearchWorkflow.run,
                    DeepResearchInput(
                        run_id=run_id,
                        workspace_id="ws-1",
                        project_id="proj-1",
                        user_id="user-1",
                        topic="Topic",
                        model="deep-research-preview-04-2026",
                        billing_path="byok",
                    ),
                    id=run_id,
                    task_queue=task_queue,
                )
                await handle.signal(DeepResearchWorkflow.approve_plan, "Initial plan.")
                result = await handle.result()

                assert result.status == "failed"
                assert len(_finalize_calls) == 1
                assert _finalize_calls[0]["status"] == "failed"
                assert _finalize_calls[0]["run_id"] == run_id
                assert _finalize_calls[0]["error_code"] == "rate_limit"
                assert _finalize_calls[0]["error_message"] == "rate limit hit"
    finally:
        _execute_should_fail = False
