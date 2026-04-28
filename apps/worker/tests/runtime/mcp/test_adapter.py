from types import SimpleNamespace

import pytest

from runtime.mcp.adapter import adapt
from runtime.tools import ToolContext


def _ctx(user_id: str = "user-1") -> ToolContext:
    async def emit(_event):
        return None

    return ToolContext(
        workspace_id="ws",
        project_id=None,
        page_id=None,
        user_id=user_id,
        run_id="run",
        scope="workspace",
        emit=emit,
    )


async def test_adapt_prefixes_name_and_keeps_auth_out_of_args():
    calls = []

    async def call_tool(name, args):
      calls.append((name, args))
      return {"ok": True}

    tool = adapt(
        "smoke_echo",
        SimpleNamespace(
            name="add",
            description="Add numbers",
            inputSchema={"type": "object"},
        ),
        server_url="https://echo.example/mcp",
        auth_header=("Authorization", "Bearer secret"),
        call_tool=call_tool,
        owner_user_id="user-1",
    )

    assert tool.name == "mcp__smoke_echo__add"
    assert tool.allowed_scopes == ("workspace",)
    assert tool.input_schema() == {"type": "object"}
    assert await tool.run({"x": 1}, _ctx()) == {"ok": True}
    assert calls == [("add", {"x": 1})]


async def test_adapt_rejects_wrong_user_context():
    tool = adapt(
        "smoke_echo",
        SimpleNamespace(name="add", description="", inputSchema={}),
        server_url="https://echo.example/mcp",
        auth_header=None,
        call_tool=lambda _name, _args: {"ok": True},
        owner_user_id="user-1",
    )

    with pytest.raises(PermissionError):
        await tool.run({}, _ctx(user_id="other"))
