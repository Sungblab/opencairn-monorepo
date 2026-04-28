from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from typing import Any

from runtime.mcp.adapter import adapt
from runtime.mcp.client import MCPClient, maybe_await
from runtime.mcp.slug import is_valid_slug
from runtime.tools import Tool

WarningFn = Callable[[str], Awaitable[None]]
ListToolsFn = Callable[[str, tuple[str, str] | None], Awaitable[list[Any]] | list[Any]]
CallToolFn = Callable[
    [str, tuple[str, str] | None, str, dict[str, Any]], Awaitable[Any] | Any
]


def _feature_enabled() -> bool:
    return (os.environ.get("FEATURE_MCP_CLIENT", "false")).lower() == "true"


async def _default_list_tools(url: str, auth_header: tuple[str, str] | None) -> list[Any]:
    return await MCPClient(url, auth_header).list_tools()


def _default_call_tool(
    url: str,
    auth_header: tuple[str, str] | None,
    name: str,
    args: dict[str, Any],
):
    return MCPClient(url, auth_header).call_tool(name, args)


class MCPCatalogResolver:
    def __init__(
        self,
        *,
        db_session: Any,
        list_tools: ListToolsFn = _default_list_tools,
        call_tool: CallToolFn = _default_call_tool,
        on_warning: WarningFn | None = None,
    ) -> None:
        self.db_session = db_session
        self.list_tools = list_tools
        self.call_tool = call_tool
        self.on_warning = on_warning

    async def build_for_user(self, user_id: str) -> list[Tool]:
        rows = await self.db_session.fetch(
            """
            SELECT user_id, server_slug, server_url, auth_header_name,
                   auth_header_value_encrypted
            FROM user_mcp_servers
            WHERE user_id = $1 AND status = 'active'
            """,
            user_id,
        )
        batches = await asyncio.gather(
            *(self._build_for_row(row) for row in rows),
            return_exceptions=True,
        )
        tools: list[Tool] = []
        for batch in batches:
            if isinstance(batch, Exception):
                if self.on_warning:
                    await self.on_warning(str(batch))
                continue
            tools.extend(batch)
        return tools

    async def _build_for_row(self, row: Any) -> list[Tool]:
        slug = row["server_slug"]
        if not is_valid_slug(slug):
            raise ValueError(f"Invalid MCP server slug: {slug}")
        auth_header = _auth_header(row)
        mcp_tools = await maybe_await(self.list_tools(row["server_url"], auth_header))
        if len(mcp_tools) > 50:
            raise ValueError(f"MCP server {slug} returned more than 50 tools")
        return [
            adapt(
                slug,
                tool,
                server_url=row["server_url"],
                auth_header=auth_header,
                owner_user_id=row["user_id"],
                call_tool=lambda name, args, row=row, auth_header=auth_header: self.call_tool(
                    row["server_url"],
                    auth_header,
                    name,
                    args,
                ),
            )
            for tool in mcp_tools
        ]


def _auth_header(row: Any) -> tuple[str, str] | None:
    value = _row_value(row, "auth_header_value")
    if value:
        return (_row_value(row, "auth_header_name") or "Authorization", value)

    encrypted = _row_value(row, "auth_header_value_encrypted")
    if not encrypted:
        return None

    from worker.lib.mcp_secrets import decrypt_mcp_auth_header

    return decrypt_mcp_auth_header(
        bytes(encrypted),
        _row_value(row, "auth_header_name") or "Authorization",
    )


def _row_value(row: Any, key: str) -> Any:
    if hasattr(row, "get"):
        return row.get(key)
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None


async def build_mcp_tools_for_user(
    user_id: str,
    *,
    db_session: Any,
    on_warning: WarningFn | None = None,
    list_tools: ListToolsFn = _default_list_tools,
    call_tool: CallToolFn = _default_call_tool,
) -> list[Tool]:
    if not _feature_enabled():
        return []
    resolver = MCPCatalogResolver(
        db_session=db_session,
        list_tools=list_tools,
        call_tool=call_tool,
        on_warning=on_warning,
    )
    return await resolver.build_for_user(user_id)
