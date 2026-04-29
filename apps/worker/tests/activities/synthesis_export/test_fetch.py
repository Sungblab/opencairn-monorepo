import pytest
from unittest.mock import AsyncMock, patch
from temporalio.testing import ActivityEnvironment
from worker.activities.synthesis_export.fetch import fetch_sources_activity
from worker.activities.synthesis_export.types import SynthesisRunParams


@pytest.mark.asyncio
async def test_fetch_explicit_only_no_auto_search():
    params = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="md", template="report", user_prompt="x",
        explicit_source_ids=["src-a", "src-b"], note_ids=[],
        auto_search=False, byok_key_handle=None,
    )
    with patch("worker.activities.synthesis_export.fetch._fetch_s3_object",
               new=AsyncMock(side_effect=lambda sid: {"id": sid, "title": f"T-{sid}", "body": "x" * 100, "kind": "s3_object"})):
        with patch("worker.activities.synthesis_export.fetch._persist_sources", new=AsyncMock()):
            env = ActivityEnvironment()
            bundle = await env.run(fetch_sources_activity, params)
            assert len(bundle.items) == 2
            assert {i.id for i in bundle.items} == {"src-a", "src-b"}


@pytest.mark.asyncio
async def test_fetch_token_budget_excludes_overflow():
    params = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="md", template="report", user_prompt="x",
        explicit_source_ids=["src-1", "src-2", "src-3"], note_ids=[],
        auto_search=False, byok_key_handle=None,
    )
    big_body = "word " * 50_000
    with patch("worker.activities.synthesis_export.fetch._fetch_s3_object",
               new=AsyncMock(side_effect=lambda sid: {"id": sid, "title": sid, "body": big_body, "kind": "s3_object"})):
        with patch("worker.activities.synthesis_export.fetch._persist_sources", new=AsyncMock()) as persist:
            env = ActivityEnvironment()
            bundle = await env.run(fetch_sources_activity, params)
            assert len(bundle.items) <= 3
            persist.assert_awaited_once()
            payload = persist.await_args.args[1]
            included = [r for r in payload if r["included"]]
            excluded = [r for r in payload if not r["included"]]
            assert len(excluded) >= 1
            assert sum(r["token_count"] for r in included) <= 180_000
