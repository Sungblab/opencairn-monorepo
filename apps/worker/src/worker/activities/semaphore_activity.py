"""Temporal activities for the per-project semaphore (Plan 4 Task 8).

``acquire_project_semaphore`` spin-polls the internal API until a slot is
free (or the activity times out), heartbeating every iteration so Temporal
doesn't consider the activity stuck. ``release_project_semaphore`` is a
plain HTTP call — idempotent on the server side.

Why row-count slots via the API instead of a Temporal mutex workflow:

  1. Worker cannot touch Postgres directly; mutex state would end up
     behind an API anyway, so we gain nothing by layering a mutex workflow
     on top.
  2. Slot rows are observable during incidents
     (``SELECT * FROM project_semaphore_slots``).
  3. ``expires_at`` on the DB side guarantees no deadlock even if a
     holder crashes mid-workflow — a classic mutex workflow would leak the
     lock forever in that case.
"""
from __future__ import annotations

import asyncio
import os
from typing import Any

from temporalio import activity

from worker.lib.api_client import AgentApiClient


# Each poll sleep; keeps latency tolerable without hammering the API.
_POLL_INTERVAL_SECONDS = float(os.environ.get("SEMAPHORE_POLL_SECONDS", "1.5"))

# Default concurrency cap per project. Overridable per-call via input.
_DEFAULT_MAX_CONCURRENT = int(os.environ.get("SEMAPHORE_MAX_CONCURRENT", "3"))

# Slot TTL — the API refuses to keep a slot longer than this without a
# successful renewal. 30 min matches CompilerWorkflow's activity timeout.
_DEFAULT_SLOT_TTL_SECONDS = int(os.environ.get("SEMAPHORE_TTL_SECONDS", str(30 * 60)))


@activity.defn(name="acquire_project_semaphore")
async def acquire_project_semaphore(inp: dict[str, Any]) -> dict[str, Any]:
    """Block until a slot is available (or Temporal times the activity out).

    Input:
        - project_id: str (required)
        - holder_id: str (required — typically the caller's workflow id)
        - purpose: str (required, free-form — "compiler" / "research" / ...)
        - max_concurrent: int (optional, default 3)
        - ttl_seconds: int (optional, default 1800)
    """
    api = AgentApiClient()
    # workspace_id is required (Tier 1 item 1-3); the caller workflow passes
    # it from its own payload so the API can enforce workspace/project
    # consistency before opening the advisory-lock transaction.
    workspace_id = inp["workspace_id"]
    project_id = inp["project_id"]
    holder_id = inp["holder_id"]
    purpose = inp["purpose"]
    max_concurrent = int(inp.get("max_concurrent", _DEFAULT_MAX_CONCURRENT))
    ttl_seconds = int(inp.get("ttl_seconds", _DEFAULT_SLOT_TTL_SECONDS))

    attempt = 0
    while True:
        attempt += 1
        resp = await api.acquire_semaphore(
            workspace_id=workspace_id,
            project_id=project_id,
            holder_id=holder_id,
            purpose=purpose,
            max_concurrent=max_concurrent,
            ttl_seconds=ttl_seconds,
        )
        if resp.get("acquired"):
            activity.logger.info(
                "semaphore acquired: project=%s holder=%s purpose=%s attempt=%d renewed=%s",
                project_id,
                holder_id,
                purpose,
                attempt,
                bool(resp.get("renewed")),
            )
            return {"acquired": True, "attempts": attempt}
        activity.heartbeat(
            f"waiting for semaphore: {resp.get('running', '?')}/{max_concurrent}"
        )
        await asyncio.sleep(_POLL_INTERVAL_SECONDS)


@activity.defn(name="release_project_semaphore")
async def release_project_semaphore(inp: dict[str, Any]) -> None:
    """Release a holder's slot. Safe to call twice or after a crash — the
    API does a no-op when the slot is already gone.
    """
    api = AgentApiClient()
    workspace_id = inp["workspace_id"]
    project_id = inp["project_id"]
    holder_id = inp["holder_id"]
    await api.release_semaphore(
        workspace_id=workspace_id,
        project_id=project_id,
        holder_id=holder_id,
    )
    activity.logger.info(
        "semaphore released: project=%s holder=%s", project_id, holder_id
    )
