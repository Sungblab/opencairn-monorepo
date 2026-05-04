"""Durable chat run workflow."""
from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.chat_run_activity import ExecuteChatRunInput, execute_chat_run


@workflow.defn(name="ChatAgentWorkflow")
class ChatAgentWorkflow:
    @workflow.run
    async def run(self, payload: ExecuteChatRunInput) -> dict[str, object]:
        return await workflow.execute_activity(
            execute_chat_run,
            payload,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
