from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from worker.activities.chat_run_activity import ExecuteChatRunInput, _run_execute_chat_run


@pytest.mark.asyncio
async def test_execute_chat_run_posts_internal_execute_endpoint() -> None:
    post_internal = AsyncMock(return_value={"ok": True})

    out = await _run_execute_chat_run(
        ExecuteChatRunInput(run_id="run-123"),
        post_internal=post_internal,
    )

    assert out == {"ok": True}
    post_internal.assert_awaited_once_with(
        "/api/internal/chat-runs/run-123/execute",
        {},
    )
