"""SynthesisExportWorkflow — fetch_sources → synthesize → compile."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.synthesis_export.types import (
        CompiledArtifact,
        SourceBundle,
        SynthesisRunParams,
    )
    from worker.agents.synthesis_export.schemas import SynthesisOutputSchema


@dataclass(frozen=True)
class SynthesisExportResult:
    status: str  # completed | cancelled | failed
    s3_key: str | None = None
    format: str | None = None
    error_code: str | None = None


@workflow.defn(name="SynthesisExportWorkflow")
class SynthesisExportWorkflow:
    def __init__(self) -> None:
        self._cancelled = False

    @workflow.signal
    def cancel(self) -> None:
        self._cancelled = True

    @workflow.run
    async def run(self, params: SynthesisRunParams) -> SynthesisExportResult:
        retry = RetryPolicy(maximum_attempts=2)

        try:
            sources: SourceBundle = await workflow.execute_activity(
                "fetch_sources_activity", params,
                result_type=SourceBundle,
                start_to_close_timeout=timedelta(minutes=5),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            if self._cancelled:
                return SynthesisExportResult(status="cancelled")

            output: SynthesisOutputSchema = await workflow.execute_activity(
                "synthesize_activity", args=[params, sources],
                result_type=SynthesisOutputSchema,
                start_to_close_timeout=timedelta(minutes=10),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            if self._cancelled:
                return SynthesisExportResult(status="cancelled")

            artifact: CompiledArtifact = await workflow.execute_activity(
                "compile_activity", args=[params, output],
                result_type=CompiledArtifact,
                start_to_close_timeout=timedelta(minutes=5),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return SynthesisExportResult(
                status="completed", s3_key=artifact.s3_key, format=artifact.format,
            )
        except Exception as exc:
            workflow.logger.exception("synthesis-export workflow failed: %s", exc)
            return SynthesisExportResult(status="failed", error_code="workflow_failed")
