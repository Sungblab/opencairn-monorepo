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


@activity.defn(name="execute_deep_research")
async def _stub_execute(_inp) -> dict:
    return {
        "interaction_id": "int-exec",
        "report_text": "Done.",
        "images": [],
        "citations": [],
    }


@activity.defn(name="persist_deep_research_report")
async def _stub_persist(_inp) -> dict:
    return {"note_id": "note-final", "total_cost_usd_cents": 200}


async def test_happy_path_approve_immediately(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")

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


async def test_feature_flag_off_fails_fast(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "false")

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


async def test_managed_disabled_flag_rejects_managed(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")
    monkeypatch.setenv("FEATURE_MANAGED_DEEP_RESEARCH", "false")

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
