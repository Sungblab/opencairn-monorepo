"""Security matrix for Sub-project A.

Covers:
- Workspace isolation: LLM-injected workspace_id cannot override runtime
- Read_note cross-workspace rejection
- fetch_url SSRF breadth (RFC1918, loopback, link-local, IPv6, schemes)
- emit_structured_output schema registry rejects unknown names
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from runtime.tools import ToolContext
from worker.tools_builtin.read_note import read_note


def _ctx(ws: str = "ws-A", pj: str = "pj-A") -> ToolContext:
    async def _emit(_): ...
    return ToolContext(
        workspace_id=ws, project_id=pj, page_id=None,
        user_id="u", run_id="r", scope="project", emit=_emit,
    )


async def test_runtime_overrides_llm_injected_workspace_id():
    """Even if the LLM passes workspace_id='ws-B' in tool args, the
    ToolContextRegistry strips it and the tool only sees ctx values."""
    from runtime.tool_registry import ToolContextRegistry
    from worker.tools_builtin.search_concepts import search_concepts

    with patch(
        "worker.tools_builtin.search_concepts.get_provider",
    ) as gp, patch(
        "worker.tools_builtin.search_concepts.AgentApiClient",
    ) as cls:
        gp.return_value.embed = AsyncMock(return_value=[[0.1]])
        inst = cls.return_value
        inst.search_concepts = AsyncMock(return_value=[])

        reg = ToolContextRegistry(
            tools=[search_concepts],
            ctx=_ctx(ws="ws-A", pj="pj-A"),
        )
        # LLM tried to inject a different workspace/project.
        await reg.execute(
            "search_concepts",
            {"query": "x",
             "workspace_id": "ws-B",
             "project_id": "pj-B"},
        )
    # Assert the API was called with ctx.project_id, not the injected one.
    inst.search_concepts.assert_awaited_once_with(
        project_id="pj-A", embedding=[0.1], k=5,
    )


async def test_read_note_rejects_cross_workspace_response():
    """Even if the API returns a note from another workspace (e.g. via
    a bug), read_note double-checks and refuses."""
    with patch(
        "worker.tools_builtin.read_note.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.get_note = AsyncMock(return_value={
            "id": "n1", "title": "Leaked", "contentText": "secret",
            "workspaceId": "ws-B",
            "projectId": "pj",
        })
        res = await read_note.run(args={"note_id": "n1"}, ctx=_ctx(ws="ws-A"))
    assert res.get("error")


@pytest.mark.parametrize("private", [
    "http://10.0.0.1/",
    "http://172.31.255.254/",
    "http://192.168.0.1/",
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/",
    "http://[fe80::1]/",
])
async def test_ssrf_private_blocked(private):
    from worker.tools_builtin.fetch_url import fetch_url
    res = await fetch_url.run(args={"url": private}, ctx=_ctx())
    assert res.get("error")


@pytest.mark.parametrize("scheme", [
    "file:///etc/passwd",
    "gopher://a/",
    "ftp://a/",
    "javascript:alert(1)",
])
async def test_ssrf_schemes_blocked(scheme):
    from worker.tools_builtin.fetch_url import fetch_url
    res = await fetch_url.run(args={"url": scheme}, ctx=_ctx())
    assert res.get("error")


async def test_emit_schema_registry_rejects_unknown():
    from worker.tools_builtin.emit_structured_output import (
        emit_structured_output,
    )
    res = await emit_structured_output.run(
        args={"schema_name": "NonexistentSchema", "data": {}},
        ctx=_ctx(),
    )
    assert res["accepted"] is False
