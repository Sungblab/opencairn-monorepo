"""Provider-specific tool schema builders.

Converts a runtime Tool's input_schema() into the declaration format each
LLM provider expects.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from runtime.tools import Tool


def _strip_pydantic_metadata(schema: dict[str, Any]) -> dict[str, Any]:
    """Flatten Pydantic JSON schema to plain JSON Schema that LLM providers accept.

    Pydantic adds `title`, `$defs`, etc. which Gemini/Ollama don't use (and
    Gemini actively rejects unknown keys at the top level).
    """
    out: dict[str, Any] = {
        "type": schema.get("type", "object"),
        "properties": {},
    }
    required = schema.get("required", [])
    if required:
        out["required"] = list(required)
    for pname, pschema in schema.get("properties", {}).items():
        clean: dict[str, Any] = {}
        if "type" in pschema:
            clean["type"] = pschema["type"]
        if "description" in pschema:
            clean["description"] = pschema["description"]
        if "enum" in pschema:
            clean["enum"] = pschema["enum"]
        if "items" in pschema:
            clean["items"] = pschema["items"]
        out["properties"][pname] = clean
    return out


def build_gemini_declarations(tools: list[Tool]) -> list[dict[str, Any]]:
    """Gemini FunctionDeclaration format: {name, description, parameters}."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "parameters": _strip_pydantic_metadata(t.input_schema()),
        }
        for t in tools
    ]


def build_ollama_declarations(tools: list[Tool]) -> list[dict[str, Any]]:
    """Ollama tool format: {type: "function", function: {name, description, parameters}}."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": _strip_pydantic_metadata(t.input_schema()),
            },
        }
        for t in tools
    ]


__all__ = ["build_gemini_declarations", "build_ollama_declarations"]
