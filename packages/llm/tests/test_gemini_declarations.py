from __future__ import annotations

from llm.base import ProviderConfig
from llm.gemini import GeminiProvider


class _FakeTool:
    def __init__(self, name, description, schema):
        self.name = name
        self.description = description
        self._schema = schema

    def input_schema(self) -> dict:
        return self._schema


def test_gemini_supports_tool_calling():
    p = GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))
    assert p.supports_tool_calling() is True
    assert p.supports_parallel_tool_calling() is False  # C will flip


def test_build_declarations_strips_toolcontext_from_schema():
    p = GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))
    tool = _FakeTool(
        name="search_concepts",
        description="Search concepts",
        schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "k": {"type": "integer"},
            },
            "required": ["query"],
        },
    )
    decls = p._build_function_declarations([tool])
    assert len(decls) == 1
    d = decls[0]
    assert d["name"] == "search_concepts"
    assert d["description"] == "Search concepts"
    assert "query" in d["parameters"]["properties"]
    assert "k" in d["parameters"]["properties"]
