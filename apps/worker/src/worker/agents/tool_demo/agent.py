"""ToolDemoAgent — Sub-project A verification agent.

Four presets map 1:1 to the four chat modes identified in the umbrella
(plain / reference / external / full). Each preset bundles a different
tool subset; the `run_with_tools` loop is identical across presets.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from runtime.loop_runner import run_with_tools
from runtime.mcp import build_mcp_tools_for_user
from runtime.tool_loop import LoopConfig, LoopResult
from worker.tools_builtin import (
    BUILTIN_TOOLS,
    emit_structured_output,
    fetch_url,
    list_project_topics,
    read_note,
    search_concepts,
    search_notes,
)


@dataclass
class ToolDemoAgent:
    provider: object
    tools: tuple = field(default_factory=tuple)

    @classmethod
    def plain(cls, provider) -> "ToolDemoAgent":
        """Pure chat — no tools. PLAIN chat mode demo."""
        return cls(provider=provider, tools=())

    @classmethod
    def reference(cls, provider) -> "ToolDemoAgent":
        """NotebookLM-style — retrieval-only."""
        return cls(provider=provider, tools=(
            list_project_topics, search_concepts, search_notes, read_note,
        ))

    @classmethod
    def external(cls, provider) -> "ToolDemoAgent":
        """External-only — fetch_url + emit_structured_output."""
        return cls(provider=provider, tools=(fetch_url, emit_structured_output))

    @classmethod
    def full(cls, provider) -> "ToolDemoAgent":
        """All builtin tools."""
        return cls(provider=provider, tools=tuple(BUILTIN_TOOLS))

    async def run(
        self,
        *,
        user_prompt: str,
        tool_context: dict,
        config: LoopConfig | None = None,
        db_session=None,
    ) -> LoopResult:
        messages = [{"role": "user", "text": user_prompt}]
        tools = list(self.tools)
        if db_session is not None and tuple(self.tools) == tuple(BUILTIN_TOOLS):
            tools.extend(
                await build_mcp_tools_for_user(
                    tool_context["user_id"],
                    db_session=db_session,
                )
            )
        return await run_with_tools(
            provider=self.provider,
            initial_messages=messages,
            tools=tools,
            tool_context=tool_context,
            config=config,
        )
