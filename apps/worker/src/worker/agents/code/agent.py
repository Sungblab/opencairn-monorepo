"""CodeAgent — Plan 7 Phase 2.

Generates or fixes a single source file via one LLM call, returning a
structured CodeOutput. Unlike the multi-step agents (Compiler, Research,
Librarian) this is NOT a runtime.Agent subclass — those are async-generators
that yield AgentEvents and run inside the runtime tool-loop. CodeAgent is a
one-shot LLM call wrapped in a tiny tool for structured output extraction;
it's invoked directly from the Temporal activity layer (Task 5).

The single tool ``emit_structured_output`` exists purely so providers that
support tool calling (Gemini) can return validated JSON without us having to
parse markdown-wrapped output.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Optional

from llm import LLMProvider
from runtime.events import Scope
from runtime.tools import Tool, ToolContext

from worker.agents.code.prompts import (
    CODE_SYSTEM,
    build_fix_prompt,
    build_generate_prompt,
)


CanvasLanguage = Literal["python", "javascript", "html", "react"]


@dataclass(frozen=True)
class CodeContext:
    kind: Literal["generate", "fix"]
    user_prompt: str
    language: CanvasLanguage
    last_code: Optional[str]
    last_error: Optional[str]
    stdout_tail: str


@dataclass(frozen=True)
class CodeOutput:
    language: CanvasLanguage
    source: str
    explanation: str


_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["language", "source", "explanation"],
    "properties": {
        "language": {
            "type": "string",
            "enum": ["python", "javascript", "html", "react"],
        },
        "source": {"type": "string", "maxLength": 64 * 1024},
        "explanation": {"type": "string", "maxLength": 2000},
    },
}


class _EmitStructuredOutputTool:
    """Single-call sentinel tool. Only conforms to the runtime ``Tool``
    protocol so providers can build declarations from it; it never actually
    executes — the agent reads the model's tool-call ``args`` directly.
    """

    name = "emit_structured_output"
    description = "Emit the final code artifact. Call exactly once and stop."
    allowed_agents: tuple[str, ...] = ()
    allowed_scopes: tuple[Scope, ...] = ()

    def supports_parallel(self, args: dict[str, Any]) -> bool:
        return False

    def input_schema(self) -> dict[str, Any]:
        return _OUTPUT_SCHEMA

    def redact(self, args: dict[str, Any]) -> dict[str, Any]:
        return dict(args)

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
        # Never invoked — the agent extracts args directly from the
        # provider's tool_use response.
        raise RuntimeError("emit_structured_output is not executable")


_OUTPUT_TOOL: Tool = _EmitStructuredOutputTool()  # type: ignore[assignment]


class CodeAgent:
    """One-shot code generator/fixer. Not a runtime.Agent subclass — see module
    docstring for the rationale.
    """

    name = "code"

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    async def run(self, ctx: CodeContext) -> CodeOutput:
        if ctx.kind == "generate":
            user_prompt = build_generate_prompt(
                prompt=ctx.user_prompt, language=ctx.language
            )
        else:
            user_prompt = build_fix_prompt(
                original_prompt=ctx.user_prompt,
                language=ctx.language,
                last_code=ctx.last_code or "",
                last_error=ctx.last_error or "",
                stdout_tail=ctx.stdout_tail or "",
            )

        messages: list = [
            {"role": "system", "content": CODE_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]
        result = await self._llm.generate_with_tools(
            messages,
            [_OUTPUT_TOOL],
            mode="any",
            allowed_tool_names=["emit_structured_output"],
            max_output_tokens=8192,
        )

        for call in result.tool_uses or ():
            if call.name == "emit_structured_output":
                args = call.args
                return CodeOutput(
                    language=args["language"],
                    source=args["source"],
                    explanation=args.get("explanation", ""),
                )
        raise RuntimeError("CodeAgent did not call emit_structured_output")
