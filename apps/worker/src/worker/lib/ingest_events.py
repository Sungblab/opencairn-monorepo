"""Ingest event emitter — Redis publisher + atomic seq + ring buffer.

Activities call publish() during processing; the API SSE handler runs in a
separate process and SUBSCRIBEs (and replays the LIST). The worker never
holds open SSE connections itself.

Best-effort: publish failures must not break ingest. Use publish_safe in
hot paths so Redis downtime is observable in logs but not user-facing.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as redis

_log = logging.getLogger(__name__)
_REPLAY_TTL = int(os.environ.get("INGEST_REPLAY_TTL_SECONDS", "3600"))
_REPLAY_MAX_LEN = int(os.environ.get("INGEST_REPLAY_MAX_LEN", "1000"))

_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        url = os.environ.get("REDIS_URL")
        if not url:
            raise RuntimeError("REDIS_URL environment variable is required")
        _client = redis.from_url(url, decode_responses=True)
    return _client


def _reset_client_for_test() -> None:
    """Test-only: drop singleton so a fresh env can take effect."""
    global _client
    _client = None


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


async def publish(workflow_id: str, kind: str, payload: dict[str, Any]) -> int:
    """Publish a single IngestEvent. Returns the assigned seq.

    The seq counter is per-workflow_id, atomic via INCR.
    """
    r = _get_client()
    seq = await r.incr(f"ingest:seq:{workflow_id}")
    event = {
        "workflowId": workflow_id,
        "seq": seq,
        "ts": _iso_now(),
        "kind": kind,
        "payload": payload,
    }
    body = json.dumps(event, ensure_ascii=False)

    pipe = r.pipeline()
    pipe.publish(f"ingest:events:{workflow_id}", body)
    pipe.lpush(f"ingest:replay:{workflow_id}", body)
    pipe.ltrim(f"ingest:replay:{workflow_id}", 0, _REPLAY_MAX_LEN - 1)
    pipe.expire(f"ingest:replay:{workflow_id}", _REPLAY_TTL)
    pipe.expire(f"ingest:seq:{workflow_id}", _REPLAY_TTL)
    await pipe.execute()
    return seq


async def publish_safe(workflow_id: str, kind: str, payload: dict[str, Any]) -> None:
    """Best-effort wrapper. Redis downtime must never break ingest itself."""
    try:
        await publish(workflow_id, kind, payload)
    except Exception as e:  # noqa: BLE001
        _log.warning("ingest event publish failed: kind=%s err=%s", kind, e)
