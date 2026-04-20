"""Tests for @tool decorator and ToolContext auto-injection."""
from __future__ import annotations

import pytest

from runtime.events import AgentEvent
from runtime.tools import (
    Tool,
    ToolContext,
    get_tool,
    get_tools_for_agent,
    hash_input,
    tool,
)


async def _noop_emit(_ev: AgentEvent) -> None:
    pass


@pytest.fixture
def fake_ctx() -> ToolContext:
    return ToolContext(
        workspace_id="w1",
        project_id="p1",
        page_id=None,
        user_id="u1",
        run_id="r1",
        scope="project",
        emit=_noop_emit,
    )


async def test_tool_decorator_creates_tool(fake_ctx: ToolContext) -> None:
    @tool()
    async def echo(msg: str, ctx: ToolContext) -> str:
        """Returns msg unchanged."""
        return msg

    assert isinstance(echo, Tool)
    assert echo.name == "echo"
    assert "Returns msg unchanged" in echo.description
    result = await echo.run({"msg": "hi"}, fake_ctx)
    assert result == "hi"


async def test_tool_context_excluded_from_schema() -> None:
    @tool()
    async def search(query: str, limit: int, ctx: ToolContext) -> list[str]:
        """Search things."""
        return [query] * limit

    schema = search.input_schema()
    assert "ctx" not in schema["properties"]
    assert "query" in schema["properties"]
    assert "limit" in schema["properties"]


async def test_supports_parallel_static_true() -> None:
    @tool(parallel=True)
    async def read_only_op(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert read_only_op.supports_parallel({"x": 1}) is True


async def test_supports_parallel_dynamic() -> None:
    @tool(parallel=lambda args: args.get("read_only", False))
    async def bash_like(cmd: str, read_only: bool, ctx: ToolContext) -> str:
        """."""
        return cmd

    assert bash_like.supports_parallel({"cmd": "ls", "read_only": True}) is True
    assert bash_like.supports_parallel({"cmd": "rm -rf /", "read_only": False}) is False


async def test_supports_parallel_default_false() -> None:
    @tool()
    async def default_op(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert default_op.supports_parallel({"x": 1}) is False


async def test_redact_fields(fake_ctx: ToolContext) -> None:
    @tool(redact_fields=("api_key",))
    async def fetch(url: str, api_key: str, ctx: ToolContext) -> str:
        """."""
        return url

    redacted = fetch.redact({"url": "https://x", "api_key": "secret"})
    assert redacted == {"url": "https://x", "api_key": "[REDACTED]"}


async def test_registry_lookup() -> None:
    @tool(name="unique_one")
    async def some_tool(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert get_tool("unique_one") is some_tool


async def test_registry_duplicate_raises() -> None:
    @tool(name="dup_test_tool")
    async def a(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    with pytest.raises(ValueError, match="already registered"):

        @tool(name="dup_test_tool")
        async def b(x: int, ctx: ToolContext) -> int:
            """."""
            return x


async def test_hash_input_deterministic() -> None:
    h1 = hash_input({"a": 1, "b": 2})
    h2 = hash_input({"b": 2, "a": 1})
    assert h1 == h2  # key order independent
    assert len(h1) == 16  # xxhash64 hex


async def test_get_tools_for_agent_filters_by_scope(fake_ctx: ToolContext) -> None:
    @tool(name="page_only_tool", allowed_agents=("research",), allowed_scopes=("page",))
    async def t(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert t in get_tools_for_agent("research", "page")
    assert t not in get_tools_for_agent("research", "project")
    assert t not in get_tools_for_agent("compiler", "page")
