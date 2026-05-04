"""Chat run execution activity.

The durable run is owned by Temporal, but the TypeScript API still owns the
chat provider/retrieval implementation. This activity asks the internal API to
execute one persisted chat run and append its replayable events.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from temporalio import activity


@dataclass
class ExecuteChatRunInput:
    run_id: str


PostInternal = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


async def _run_execute_chat_run(
    inp: ExecuteChatRunInput,
    *,
    post_internal: PostInternal,
) -> dict[str, Any]:
    return await post_internal(f"/api/internal/chat-runs/{inp.run_id}/execute", {})


async def _default_post_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
    from worker.lib.api_client import post_internal

    return await post_internal(path, body)


@activity.defn(name="execute_chat_run")
async def execute_chat_run(inp: ExecuteChatRunInput) -> dict[str, Any]:
    return await _run_execute_chat_run(inp, post_internal=_default_post_internal)
