import socket

import pytest

from runtime.mcp.client import MCPSecurityError, validate_mcp_url


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/mcp",
        "https://127.0.0.1/mcp",
        "https://localhost/mcp",
        "https://169.254.169.254/latest/meta-data",
    ],
)
async def test_validate_mcp_url_rejects_non_https_and_private_hosts(url):
    with pytest.raises(MCPSecurityError):
        await validate_mcp_url(url)


async def test_validate_mcp_url_honors_allowlist(monkeypatch):
    monkeypatch.setenv("MCP_URL_ALLOWLIST", r"^allowed\.example$")
    with pytest.raises(MCPSecurityError):
        await validate_mcp_url("https://blocked.example/mcp")


async def test_validate_mcp_url_rejects_mixed_public_and_private_dns(monkeypatch):
    def fake_getaddrinfo(*_args, **_kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 443)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    with pytest.raises(MCPSecurityError):
        await validate_mcp_url("https://mixed.example/mcp")
