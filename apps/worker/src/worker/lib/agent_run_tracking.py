"""Best-effort worker -> API summaries for ``agent_runs``.

Trajectory NDJSON remains the source of detailed runtime events. This helper
keeps the product overview table in sync with those worker runs without making
observability writes fatal to the workflow.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from temporalio import activity

if TYPE_CHECKING:
    from runtime.default_hooks import TokenCounterHook
    from worker.lib.api_client import AgentApiClient

_TRAJECTORY_DIR = Path(
    os.environ.get("TRAJECTORY_DIR", "/var/opencairn/trajectories")
)


def _trajectory_path(*, workspace_id: str, workflow_id: str) -> Path:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    return _TRAJECTORY_DIR / workspace_id / today / f"{workflow_id}.ndjson"


@dataclass
class AgentRunTracker:
    api: AgentApiClient
    agent_name: str
    workspace_id: str
    project_id: str | None
    user_id: str
    workflow_id: str
    page_id: str | None = None

    @property
    def trajectory_path(self) -> Path:
        return _trajectory_path(
            workspace_id=self.workspace_id,
            workflow_id=self.workflow_id,
        )

    @property
    def trajectory_uri(self) -> str:
        return f"file://{self.trajectory_path}"

    def trajectory_bytes(self) -> int:
        try:
            return self.trajectory_path.stat().st_size
        except OSError:
            return 0

    async def start(self) -> None:
        try:
            await self.api.start_agent_run(
                workspace_id=self.workspace_id,
                project_id=self.project_id,
                page_id=self.page_id,
                user_id=self.user_id,
                agent_name=self.agent_name,
                workflow_id=self.workflow_id,
                trajectory_uri=self.trajectory_uri,
            )
        except Exception as exc:  # noqa: BLE001 - observability is best-effort
            activity.logger.warning(
                "agent_runs start skipped for %s run=%s: %s",
                self.agent_name,
                self.workflow_id,
                exc,
            )

    async def finish(
        self,
        *,
        status: str,
        token_hook: TokenCounterHook,
        error: Exception | None = None,
    ) -> None:
        totals = token_hook.totals(self.workflow_id)
        error_message = str(error)[:2000] if error else None
        try:
            await self.api.finish_agent_run(
                agent_name=self.agent_name,
                workflow_id=self.workflow_id,
                status=status,
                total_tokens_in=totals.prompt_tokens,
                total_tokens_out=totals.completion_tokens,
                total_tokens_cached=totals.cached_tokens,
                total_cost_krw=totals.cost_krw,
                tool_call_count=totals.tool_call_count,
                model_call_count=totals.model_call_count,
                trajectory_uri=self.trajectory_uri,
                trajectory_bytes=self.trajectory_bytes(),
                error_class=type(error).__name__ if error else None,
                error_message=error_message,
            )
        except Exception as exc:  # noqa: BLE001 - observability is best-effort
            activity.logger.warning(
                "agent_runs finish skipped for %s run=%s: %s",
                self.agent_name,
                self.workflow_id,
                exc,
            )


def make_agent_run_tracker(
    *,
    api: AgentApiClient,
    agent_name: str,
    inp: dict[str, Any],
    workflow_id: str,
    page_id: str | None = None,
) -> AgentRunTracker:
    return AgentRunTracker(
        api=api,
        agent_name=agent_name,
        workspace_id=inp["workspace_id"],
        project_id=inp.get("project_id"),
        user_id=inp["user_id"],
        workflow_id=workflow_id,
        page_id=page_id,
    )
