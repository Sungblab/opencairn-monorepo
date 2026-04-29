import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from temporalio.testing import ActivityEnvironment
from llm.tool_types import UsageCounts
from worker.activities.synthesis_export.synthesize import synthesize_activity
from worker.activities.synthesis_export.types import (
    SynthesisRunParams, SourceBundle, SourceItem,
)
from worker.agents.synthesis_export.schemas import SynthesisOutputSchema


@pytest.mark.asyncio
async def test_synthesize_returns_output_and_records_tokens():
    params = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="md", template="report", user_prompt="x",
        explicit_source_ids=[], note_ids=[], auto_search=False, byok_key_handle=None,
    )
    bundle = SourceBundle(items=[SourceItem(id="s", title="t", body="b", token_count=10, kind="note")])
    fake_output = SynthesisOutputSchema.model_validate({
        "format": "md", "title": "T", "abstract": None,
        "sections": [{"title": "S", "content": "c", "source_ids": ["s"]}],
        "bibliography": [], "template": "report",
    })

    with patch("worker.activities.synthesis_export.synthesize.resolve_llm_provider", new=AsyncMock(return_value=MagicMock())):
        with patch("worker.activities.synthesis_export.synthesize.SynthesisExportAgent") as agent_cls:
            agent = agent_cls.return_value
            agent.run = AsyncMock(return_value=(fake_output, UsageCounts(input_tokens=1234, output_tokens=560)))
            with patch("worker.activities.synthesis_export.synthesize._patch_run_tokens", new=AsyncMock()) as patch_tokens:
                env = ActivityEnvironment()
                out = await env.run(synthesize_activity, params, bundle)
                assert out.title == "T"
                patch_tokens.assert_awaited_once_with("r1", 1794)
