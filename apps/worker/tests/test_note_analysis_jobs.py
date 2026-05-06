from __future__ import annotations

from typing import Any

import pytest

from worker.activities.note_analysis_jobs import drain_note_analysis_jobs


@pytest.mark.asyncio
async def test_drain_note_analysis_jobs_posts_bounded_batch_to_internal_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def fake_post_internal(path: str, payload: dict[str, Any]) -> dict[str, Any]:
        calls.append((path, payload))
        return {"results": [{"jobId": "job-1", "status": "completed"}]}

    monkeypatch.setattr(
        "worker.activities.note_analysis_jobs.post_internal",
        fake_post_internal,
    )

    result = await drain_note_analysis_jobs({"batchSize": 25})

    assert result == {"results": [{"jobId": "job-1", "status": "completed"}]}
    assert calls == [("/api/internal/note-analysis-jobs/drain", {"batchSize": 25})]
