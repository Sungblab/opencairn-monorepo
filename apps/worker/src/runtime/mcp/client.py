from __future__ import annotations

import asyncio
import inspect
import ipaddress
import os
import re
import socket
from datetime import timedelta
from typing import Any
from urllib.parse import urlparse

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


class MCPSecurityError(ValueError):
    pass


class MCPAuthError(PermissionError):
    pass


class MCPTransportError(RuntimeError):
    pass


def _is_blocked_ip(ip: str) -> bool:
    parsed = ipaddress.ip_address(ip)
    return (
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_link_local
        or parsed.is_multicast
        or parsed.is_unspecified
        or parsed.is_reserved
    )


async def validate_mcp_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise MCPSecurityError("MCP server URL must use HTTPS")
    if not parsed.hostname:
        raise MCPSecurityError("MCP server URL must include a host")

    allowlist = os.environ.get("MCP_URL_ALLOWLIST")
    if allowlist and not re.fullmatch(allowlist, parsed.hostname):
        raise MCPSecurityError("MCP server host is not allowed")

    if parsed.hostname in {"localhost", "localhost.localdomain"}:
        raise MCPSecurityError("MCP server host resolves to a private address")

    infos = await asyncio.to_thread(
        socket.getaddrinfo,
        parsed.hostname,
        parsed.port or 443,
        type=socket.SOCK_STREAM,
    )
    addresses = {info[4][0] for info in infos}
    if not addresses or any(_is_blocked_ip(addr) for addr in addresses):
        raise MCPSecurityError("MCP server host resolves to a private address")


class MCPClient:
    def __init__(
        self,
        server_url: str,
        auth_header: tuple[str, str] | None = None,
        *,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.server_url = server_url
        self.auth_header = auth_header
        self.timeout_seconds = timeout_seconds

    async def list_tools(self) -> list[Any]:
        async with self._session() as session:
            result = await session.list_tools()
            return list(getattr(result, "tools", []) or [])

    async def call_tool(self, name: str, args: dict[str, Any]) -> Any:
        async with self._session() as session:
            result = await session.call_tool(name, args)
            if getattr(result, "isError", False) or getattr(result, "is_error", False):
                raise MCPTransportError(str(result))
            if hasattr(result, "model_dump"):
                return result.model_dump(mode="json")
            return result

    def _headers(self) -> dict[str, str] | None:
        if not self.auth_header:
            return None
        name, value = self.auth_header
        return {name: value}

    def _session(self):
        client = self

        class _SessionContext:
            async def __aenter__(self):
                await validate_mcp_url(client.server_url)
                self._http = streamablehttp_client(
                    client.server_url,
                    headers=client._headers(),
                    timeout=client.timeout_seconds,
                    sse_read_timeout=client.timeout_seconds,
                )
                read_stream, write_stream, _ = await self._http.__aenter__()
                self._session = ClientSession(
                    read_stream,
                    write_stream,
                    read_timeout_seconds=timedelta(seconds=client.timeout_seconds),
                )
                await self._session.__aenter__()
                await self._session.initialize()
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                await self._session.__aexit__(exc_type, exc, tb)
                await self._http.__aexit__(exc_type, exc, tb)

        return _SessionContext()


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value
