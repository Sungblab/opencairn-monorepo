"""Workflow-side IngestEvent emission activities.

Temporal workflows must remain deterministic — they cannot talk to Redis
directly. Instead they call short activities defined here, which forward
to :func:`worker.lib.ingest_events.publish_safe`.
"""
from __future__ import annotations

from typing import Any

from temporalio import activity

from worker.lib.ingest_events import publish_safe


@activity.defn(name="emit_started")
async def emit_started(inp: dict[str, Any]) -> None:
    """Emit a `started` IngestEvent at the top of the pipeline."""
    await publish_safe(inp["workflow_id"], "started", inp["payload"])
