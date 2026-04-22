"""Built-in tools for Sub-project A demo agent.

These tools are designed around the existing `runtime.tools.ToolContext`
injection pattern: every tool function takes `ctx: ToolContext` in
addition to the LLM-visible args, and `ctx` is populated from the
activity's caller (workspace/project id validated upstream).

BUILTIN_TOOLS is the default tool set for ToolDemoAgent.full(); subsets
map to the other presets (plain/reference/external).
"""
from __future__ import annotations

from .emit_structured_output import emit_structured_output
from .fetch_url import fetch_url
from .list_project_topics import list_project_topics
from .read_note import read_note
from .search_concepts import search_concepts
from .search_notes import search_notes

BUILTIN_TOOLS: tuple = (
    list_project_topics,
    search_concepts,
    search_notes,
    read_note,
    fetch_url,
    emit_structured_output,
)

__all__ = [
    "BUILTIN_TOOLS",
    "emit_structured_output",
    "fetch_url",
    "list_project_topics",
    "read_note",
    "search_concepts",
    "search_notes",
]
