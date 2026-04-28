"""Plan 11B Phase A - doc-editor activity returns the agent output."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from worker.activities.doc_editor_activity import (
    DocEditorActivityInput,
    run_doc_editor,
)


@pytest.mark.asyncio
async def test_run_doc_editor_returns_payload():
    fake_output = {
        "command": "improve",
        "output_mode": "diff",
        "payload": {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "Hello there",
                }
            ],
            "summary": "tightened",
        },
        "tokens_in": 100,
        "tokens_out": 30,
    }
    with patch(
        "worker.activities.doc_editor_activity._invoke_agent",
        new=AsyncMock(return_value=fake_output),
    ):
        out = await run_doc_editor(
            DocEditorActivityInput(
                command="improve",
                note_id="n1",
                workspace_id="ws1",
                project_id="p1",
                user_id="u1",
                selection_block_id="b1",
                selection_start=0,
                selection_end=5,
                selection_text="hello",
                document_context_snippet="",
                language=None,
            )
        )
    assert out["command"] == "improve"
    assert out["payload"]["hunks"][0]["replacementText"] == "Hello there"
    assert out["tokens_in"] == 100
