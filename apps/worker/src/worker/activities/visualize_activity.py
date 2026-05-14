"""build_view activity — VisualizationAgent Temporal entrypoint (Plan 5 Phase 2).

Translates raw workflow payload into VisualizeRequest, instantiates the
agent with an env-driven LLMProvider, runs it (passing HeartbeatLoopHooks
so the SSE relay in apps/api can stream progress), and returns the
validated ViewSpec dict for serialization back to the caller.
"""
from __future__ import annotations

import uuid
from typing import Any

from llm.factory import get_provider
from temporalio import activity
from temporalio.exceptions import ApplicationError

from worker.agents.visualization.agent import (
    VisualizationAgent,
    VisualizationFailed,
    VisualizeRequest,
)
from worker.agents.visualization.heartbeat_hooks import HeartbeatLoopHooks


@activity.defn(name="build_view")
async def build_view(req: dict[str, Any]) -> dict[str, Any]:
    """Run VisualizationAgent and return validated ViewSpec dict."""
    request = VisualizeRequest(
        project_id=req["projectId"],
        workspace_id=req["workspaceId"],
        user_id=req["userId"],
        run_id=str(uuid.uuid4()),
        prompt=req["prompt"],
        view_hint=req.get("viewType"),
    )
    provider = get_provider()
    agent = VisualizationAgent(provider=provider)
    try:
        output = await agent.run(
            request=request,
            hooks=HeartbeatLoopHooks(),
        )
    except VisualizationFailed as e:
        raise ApplicationError(str(e), non_retryable=True) from e
    return output.view_spec
