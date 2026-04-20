"""Tests for Gemini/Ollama tool schema builders."""
from __future__ import annotations

from runtime.tool_declarations import (
    build_gemini_declarations,
    build_ollama_declarations,
)
from runtime.tools import ToolContext, tool


async def test_gemini_declaration_shape() -> None:
    @tool()
    async def search_pages(query: str, limit: int, ctx: ToolContext) -> list[str]:
        """Search pages by keyword."""
        return [query] * limit

    decls = build_gemini_declarations([search_pages])
    assert len(decls) == 1
    fd = decls[0]
    assert fd["name"] == "search_pages"
    assert fd["description"].startswith("Search pages")
    assert "query" in fd["parameters"]["properties"]
    assert "limit" in fd["parameters"]["properties"]
    assert "ctx" not in fd["parameters"]["properties"]
    assert fd["parameters"]["type"] == "object"


async def test_ollama_declaration_shape() -> None:
    @tool()
    async def fetch_url(url: str, ctx: ToolContext) -> str:
        """Fetch URL content."""
        return url

    decls = build_ollama_declarations([fetch_url])
    assert len(decls) == 1
    d = decls[0]
    assert d["type"] == "function"
    assert d["function"]["name"] == "fetch_url"
    assert d["function"]["description"].startswith("Fetch URL")
    assert "url" in d["function"]["parameters"]["properties"]


async def test_empty_list_returns_empty() -> None:
    assert build_gemini_declarations([]) == []
    assert build_ollama_declarations([]) == []
