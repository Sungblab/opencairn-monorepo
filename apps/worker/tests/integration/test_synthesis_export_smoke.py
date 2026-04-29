"""End-to-end smoke for the synthesis-export pipeline.

Spins Temporal's time-skipping environment and runs the real
SynthesisExportWorkflow with the real three activities, mocking only the
external boundaries (LLM provider, S3 upload, internal API client). This
catches wiring drift (activity registration, dataclass round-trip,
arg ordering) before the API + web layers come online.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from llm.tool_types import AssistantTurn, ToolUse, UsageCounts
from worker.activities.synthesis_export.compile import compile_activity
from worker.activities.synthesis_export.fetch import fetch_sources_activity
from worker.activities.synthesis_export.synthesize import synthesize_activity
from worker.activities.synthesis_export.types import SynthesisRunParams
from worker.workflows.synthesis_export_workflow import (
    SynthesisExportResult,
    SynthesisExportWorkflow,
)


@pytest.mark.asyncio
async def test_synthesis_export_smoke_md_path():
    fake_provider = MagicMock()
    fake_provider.generate_with_tools = AsyncMock(
        return_value=AssistantTurn(
            final_text=None,
            tool_uses=(
                ToolUse(
                    id="t",
                    name="emit_structured_output",
                    args={
                        "schema_name": "SynthesisOutputSchema",
                        "data": {
                            "format": "md",
                            "title": "Smoke",
                            "abstract": None,
                            "sections": [
                                {
                                    "title": "S",
                                    "content": "body",
                                    "source_ids": [],
                                }
                            ],
                            "bibliography": [],
                            "template": "report",
                        },
                    },
                ),
            ),
            assistant_message=None,
            usage=UsageCounts(input_tokens=100, output_tokens=50),
            stop_reason="tool_use",
        )
    )

    with patch(
        "worker.activities.synthesis_export.synthesize.resolve_llm_provider",
        new=AsyncMock(return_value=fake_provider),
    ), patch(
        "worker.activities.synthesis_export.fetch._fetch_s3_object",
        new=AsyncMock(
            return_value={
                "id": "s1",
                "title": "P",
                "body": "x",
                "kind": "s3_object",
            }
        ),
    ), patch(
        "worker.activities.synthesis_export.fetch._persist_sources",
        new=AsyncMock(),
    ), patch(
        "worker.activities.synthesis_export.synthesize._patch_run_tokens",
        new=AsyncMock(),
    ), patch(
        "worker.activities.synthesis_export.compile._record_document",
        new=AsyncMock(),
    ), patch(
        "worker.activities.synthesis_export.compile.upload_bytes",
        return_value="synthesis/runs/r/doc.md",
    ):
        async with await WorkflowEnvironment.start_time_skipping() as env:
            async with Worker(
                env.client,
                task_queue="smoke-q",
                workflows=[SynthesisExportWorkflow],
                activities=[
                    fetch_sources_activity,
                    synthesize_activity,
                    compile_activity,
                ],
            ):
                params = SynthesisRunParams(
                    run_id="r",
                    workspace_id="w",
                    project_id=None,
                    user_id="u",
                    format="md",
                    template="report",
                    user_prompt="x",
                    explicit_source_ids=["s1"],
                    note_ids=[],
                    auto_search=False,
                    byok_key_handle=None,
                )
                res: SynthesisExportResult = await env.client.execute_workflow(
                    SynthesisExportWorkflow.run,
                    params,
                    id="wf-smoke",
                    task_queue="smoke-q",
                )
                assert res.status == "completed"
                assert res.format == "md"
