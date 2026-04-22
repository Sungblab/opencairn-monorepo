from __future__ import annotations

from unittest.mock import AsyncMock, patch

from runtime.tools import ToolContext
from worker.tools_builtin.read_note import read_note
from worker.tools_builtin.search_notes import search_notes


def _ctx() -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id="pj", page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


async def test_search_notes_hybrid_mode_synopsis():
    with patch(
        "worker.tools_builtin.search_notes.get_provider",
    ) as gp, patch(
        "worker.tools_builtin.search_notes.AgentApiClient",
    ) as cls:
        gp.return_value.embed = AsyncMock(return_value=[[0.1]])
        inst = cls.return_value
        inst.hybrid_search_notes = AsyncMock(return_value=[
            {"noteId": "n1", "title": "T", "snippet": "snip",
             "rrfScore": 0.5},
        ])
        res = await search_notes.run(
            args={"query": "x", "k": 3, "mode": "synopsis"}, ctx=_ctx(),
        )
    assert res[0]["noteId"] == "n1"


async def test_read_note_delegates_to_get_note():
    with patch(
        "worker.tools_builtin.read_note.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.get_note = AsyncMock(return_value={
            "id": "n1", "title": "T", "contentText": "body",
            "workspaceId": "ws", "projectId": "pj",
        })
        res = await read_note.run(
            args={"note_id": "n1"}, ctx=_ctx(),
        )
    assert res["id"] == "n1"
    assert res["title"] == "T"


async def test_read_note_rejects_cross_workspace():
    with patch(
        "worker.tools_builtin.read_note.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.get_note = AsyncMock(return_value={
            "id": "n1", "title": "T", "contentText": "body",
            "workspaceId": "ws-OTHER",
            "projectId": "pj",
        })
        res = await read_note.run(args={"note_id": "n1"}, ctx=_ctx())
    assert res.get("error")
    assert "workspace" in res["error"].lower()
