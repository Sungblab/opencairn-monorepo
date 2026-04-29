"""SynthesisExportAgent — one-shot LLM synthesis for multi-format export.

Mirrors the CodeAgent pattern: NOT a runtime.Agent subclass. A single
`emit_structured_output` sentinel tool surfaces the function declaration
to providers (Gemini) so they can return validated JSON without us
parsing markdown-wrapped output.

Renamed from the plan's literal `SynthesisAgent` to avoid colliding
with Plan 8's multi-note essay generator at
``worker.agents.synthesis.agent.SynthesisAgent``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from llm import LLMProvider
from llm.tool_types import UsageCounts
from runtime.events import Scope
from runtime.tools import Tool, ToolContext

from worker.agents.synthesis_export.prompts import (
    SYNTHESIS_SYSTEM,
    build_user_prompt,
)
from worker.agents.synthesis_export.schemas import (
    SynthesisFormat,
    SynthesisOutputSchema,
    SynthesisTemplate,
)


@dataclass(frozen=True)
class SynthesisExportContext:
    sources_text: str
    workspace_notes: str
    user_prompt: str
    format: SynthesisFormat
    template: SynthesisTemplate


_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["schema_name", "data"],
    "properties": {
        "schema_name": {"type": "string", "enum": ["SynthesisOutputSchema"]},
        "data": {"type": "object"},
    },
}


class _EmitStructuredOutputTool:
    """Single-call sentinel tool. Conforms to the runtime ``Tool`` protocol so
    providers can build function declarations from it; never actually runs —
    the agent reads the model's tool-call ``args`` directly.
    """

    name = "emit_structured_output"
    description = "Emit the final synthesized document. Call exactly once and stop."
    allowed_agents: tuple[str, ...] = ()
    allowed_scopes: tuple[Scope, ...] = ()

    def supports_parallel(self, args: dict[str, Any]) -> bool:
        return False

    def input_schema(self) -> dict[str, Any]:
        return _OUTPUT_SCHEMA

    def redact(self, args: dict[str, Any]) -> dict[str, Any]:
        return dict(args)

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
        raise RuntimeError("emit_structured_output is not executable")


_OUTPUT_TOOL: Tool = _EmitStructuredOutputTool()  # type: ignore[assignment]


class SynthesisExportAgent:
    """One-shot synthesis writer. Not a runtime.Agent subclass — see CodeAgent
    for the precedent and rationale.
    """

    name = "synthesis_export"

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    async def run(
        self, ctx: SynthesisExportContext
    ) -> tuple[SynthesisOutputSchema, UsageCounts]:
        user_prompt = build_user_prompt(
            sources_text=ctx.sources_text,
            workspace_notes=ctx.workspace_notes,
            user_prompt=ctx.user_prompt,
            format=ctx.format,
            template=ctx.template,
        )
        messages: list = [
            {"role": "system", "content": SYNTHESIS_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]
        result = await self._llm.generate_with_tools(
            messages,
            [_OUTPUT_TOOL],
            mode="any",
            allowed_tool_names=["emit_structured_output"],
            max_output_tokens=32_000,
        )
        for call in result.tool_uses or ():
            if call.name == "emit_structured_output":
                data = call.args.get("data", {})
                return (
                    SynthesisOutputSchema.model_validate(data),
                    result.usage,
                )
        raise RuntimeError("SynthesisExportAgent did not call emit_structured_output")
