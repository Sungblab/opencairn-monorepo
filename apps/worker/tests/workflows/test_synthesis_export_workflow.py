import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from temporalio import activity

from worker.activities.synthesis_export.types import (
    SynthesisRunParams, SourceBundle, SourceItem, CompiledArtifact,
)
from worker.agents.synthesis_export.schemas import SynthesisOutputSchema, SynthesisSection
from worker.workflows.synthesis_export_workflow import SynthesisExportWorkflow, SynthesisExportResult


@activity.defn(name="fetch_sources_activity")
async def fake_fetch(params: SynthesisRunParams) -> SourceBundle:
    return SourceBundle(items=[SourceItem(id="s", title="t", body="b", token_count=10, kind="note")])


@activity.defn(name="synthesize_activity")
async def fake_synth(params: SynthesisRunParams, b: SourceBundle) -> SynthesisOutputSchema:
    return SynthesisOutputSchema(
        format="md", title="T", abstract=None,
        sections=[SynthesisSection(title="S", content="c", source_ids=[])],
        bibliography=[], template="report",
    )


@activity.defn(name="compile_activity")
async def fake_compile(params: SynthesisRunParams, out: SynthesisOutputSchema) -> CompiledArtifact:
    return CompiledArtifact(s3_key="synthesis/runs/r1/doc.md", bytes=42, format="md")


@pytest.mark.asyncio
async def test_workflow_happy_path():
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client, task_queue="test-q",
            workflows=[SynthesisExportWorkflow],
            activities=[fake_fetch, fake_synth, fake_compile],
        ):
            params = SynthesisRunParams(
                run_id="r1", workspace_id="w", project_id=None, user_id="u",
                format="md", template="report", user_prompt="x",
                explicit_source_ids=[], note_ids=[], auto_search=False, byok_key_handle=None,
            )
            result: SynthesisExportResult = await env.client.execute_workflow(
                SynthesisExportWorkflow.run, params,
                id="wf-test-r1", task_queue="test-q",
            )
            assert result.status == "completed"
            assert result.s3_key == "synthesis/runs/r1/doc.md"
            assert result.format == "md"
