"""synthesize_activity — invokes SynthesisExportAgent and persists token usage."""
from __future__ import annotations

from temporalio import activity

from worker.activities.synthesis_export._status import set_status
from worker.activities.synthesis_export.types import SourceBundle, SynthesisRunParams
from worker.agents.synthesis_export.agent import SynthesisExportAgent, SynthesisExportContext
from worker.agents.synthesis_export.schemas import SynthesisOutputSchema
from worker.lib.api_client import patch_internal
from worker.lib.llm_routing import resolve_llm_provider


async def _patch_run_tokens(run_id: str, tokens_used: int) -> None:
    await patch_internal(
        f"/api/internal/synthesis-export/runs/{run_id}",
        {"tokens_used": tokens_used},
    )


@activity.defn(name="synthesize_activity")
async def synthesize_activity(
    params: SynthesisRunParams,
    sources: SourceBundle,
) -> SynthesisOutputSchema:
    activity.heartbeat("starting synthesis")
    await set_status(params.run_id, "synthesizing")
    provider = await resolve_llm_provider(
        user_id=params.user_id,
        workspace_id=params.workspace_id,
        purpose="chat",
        byok_key_handle=params.byok_key_handle,
    )
    agent = SynthesisExportAgent(llm=provider)
    ctx = SynthesisExportContext(
        sources_text=sources.as_text(),
        workspace_notes=sources.notes_excerpt(),
        user_prompt=params.user_prompt,
        format=params.format,
        template=params.template,
    )
    activity.heartbeat("calling LLM")
    output, usage = await agent.run(ctx)
    total = (usage.input_tokens or 0) + (usage.output_tokens or 0)
    await _patch_run_tokens(params.run_id, total)
    return output
