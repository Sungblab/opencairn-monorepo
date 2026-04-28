from types import SimpleNamespace

from runtime.mcp.resolver import build_mcp_tools_for_user
from worker.lib.integration_crypto import encrypt_token


class FakeDb:
    async def fetch(self, query, user_id):
        assert "user_mcp_servers" in query
        assert "auth_header_value_encrypted" in query
        assert user_id == "user-1"
        return [
            {
                "user_id": "user-1",
                "server_slug": "echo",
                "server_url": "https://echo.example/mcp",
                "auth_header_name": "Authorization",
                "auth_header_value": "Bearer token",
            }
        ]


async def test_resolver_builds_tools_for_active_user_servers(monkeypatch):
    monkeypatch.setenv("FEATURE_MCP_CLIENT", "true")

    async def list_tools(_url, _auth_header):
        return [
            SimpleNamespace(
                name="add",
                description="Add",
                inputSchema={"type": "object"},
            )
        ]

    tools = await build_mcp_tools_for_user(
        "user-1",
        db_session=FakeDb(),
        list_tools=list_tools,
        call_tool=lambda _url, _auth, name, args: {"name": name, "args": args},
    )

    assert [tool.name for tool in tools] == ["mcp__echo__add"]


async def test_resolver_decrypts_stored_auth_header(monkeypatch):
    monkeypatch.setenv("FEATURE_MCP_CLIENT", "true")
    monkeypatch.setenv(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY",
        "NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU=",
    )

    class EncryptedDb:
        async def fetch(self, _query, _user_id):
            return [
                {
                    "user_id": "user-1",
                    "server_slug": "echo",
                    "server_url": "https://echo.example/mcp",
                    "auth_header_name": "X-Token",
                    "auth_header_value_encrypted": encrypt_token("secret"),
                }
            ]

    seen = []

    async def list_tools(_url, auth_header):
        seen.append(auth_header)
        return [
            SimpleNamespace(
                name="add",
                description="Add",
                inputSchema={"type": "object"},
            )
        ]

    await build_mcp_tools_for_user(
        "user-1",
        db_session=EncryptedDb(),
        list_tools=list_tools,
        call_tool=lambda _url, _auth, name, args: {"name": name, "args": args},
    )

    assert seen == [("X-Token", "secret")]


async def test_resolver_short_circuits_when_feature_flag_off(monkeypatch):
    monkeypatch.setenv("FEATURE_MCP_CLIENT", "false")
    tools = await build_mcp_tools_for_user("user-1", db_session=object())
    assert tools == []
