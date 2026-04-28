from __future__ import annotations

from typing import Any, Awaitable, Callable

from runtime.mcp.client import MCPClient, maybe_await
from runtime.tools import Scope, ToolContext


CallTool = Callable[[str, dict[str, Any]], Awaitable[Any] | Any]


def _is_destructive(name: str) -> bool:
    lowered = name.lower()
    return any(word in lowered for word in ("delete", "remove", "drop", "destroy"))


def adapt(
    server_slug: str,
    mcp_tool: Any,
    *,
    server_url: str,
    auth_header: tuple[str, str] | None,
    owner_user_id: str | None = None,
    call_tool: CallTool | None = None,
):
    tool_name = getattr(mcp_tool, "name")
    input_schema = getattr(mcp_tool, "inputSchema", None) or getattr(
        mcp_tool, "input_schema", None
    ) or {}
    description = getattr(mcp_tool, "description", None) or tool_name

    class MCPRuntimeTool:
        name = f"mcp__{server_slug}__{tool_name}"
        allowed_agents: tuple[str, ...] = ()
        allowed_scopes: tuple[Scope, ...] = ("workspace",)
        destructive = _is_destructive(tool_name)

        def __init__(self) -> None:
            self.description = description

        def supports_parallel(self, args: dict[str, Any]) -> bool:
            return False

        def input_schema(self) -> dict[str, Any]:
            return dict(input_schema)

        def redact(self, args: dict[str, Any]) -> dict[str, Any]:
            return dict(args)

        async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
            if owner_user_id is not None and ctx.user_id != owner_user_id:
                raise PermissionError("MCP tool user context mismatch")
            if call_tool is not None:
                return await maybe_await(call_tool(tool_name, dict(args)))
            client = MCPClient(server_url, auth_header)
            return await client.call_tool(tool_name, dict(args))

    return MCPRuntimeTool()
