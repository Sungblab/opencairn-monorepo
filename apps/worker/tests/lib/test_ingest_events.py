import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.lib.ingest_events import publish, publish_safe


@pytest.mark.asyncio
async def test_publish_increments_seq_and_writes_replay():
    fake_redis = MagicMock()
    fake_redis.incr = AsyncMock(return_value=1)
    pipe = MagicMock()
    pipe.publish = MagicMock(return_value=pipe)
    pipe.lpush = MagicMock(return_value=pipe)
    pipe.ltrim = MagicMock(return_value=pipe)
    pipe.expire = MagicMock(return_value=pipe)
    pipe.execute = AsyncMock(return_value=[1, 1, "OK", 1, 1])
    fake_redis.pipeline = MagicMock(return_value=pipe)

    with patch("worker.lib.ingest_events._get_client", return_value=fake_redis):
        seq = await publish("wf-1", "started", {"mime": "application/pdf"})

    assert seq == 1
    fake_redis.incr.assert_awaited_once_with("ingest:seq:wf-1")
    pipe.publish.assert_called_once()
    chan, body = pipe.publish.call_args[0]
    assert chan == "ingest:events:wf-1"
    parsed = json.loads(body)
    assert parsed["workflowId"] == "wf-1"
    assert parsed["seq"] == 1
    assert parsed["kind"] == "started"
    assert parsed["payload"] == {"mime": "application/pdf"}


@pytest.mark.asyncio
async def test_publish_safe_swallows_errors():
    async def boom(*_a, **_k):
        raise RuntimeError("boom")

    with patch("worker.lib.ingest_events.publish", side_effect=boom):
        # must not raise
        await publish_safe("wf-1", "started", {})
