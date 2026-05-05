"""One-shot code workspace repair planner."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from llm import LLMProvider

    from runtime.events import Scope
    from runtime.tools import Tool, ToolContext

from worker.agents.code_workspace_repair.prompts import (
    CODE_WORKSPACE_REPAIR_SYSTEM,
    build_repair_prompt,
)


@dataclass(frozen=True)
class CodeWorkspaceRepairContext:
    command: str
    exit_code: int
    logs: list[dict[str, Any]]
    manifest: dict[str, Any]


@dataclass(frozen=True)
class CodeWorkspaceRepairOutput:
    summary: str
    files: list[dict[str, str]]


_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["summary", "files"],
    "properties": {
        "summary": {"type": "string", "maxLength": 1000},
        "files": {
            "type": "array",
            "minItems": 1,
            "maxItems": 50,
            "items": {
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": {"type": "string", "maxLength": 512},
                    "content": {"type": "string", "maxLength": 1024 * 1024},
                },
            },
        },
    },
}


class _EmitCodeWorkspaceRepairTool:
    name = "emit_code_workspace_repair"
    description = "Emit the final repair file replacements. Call exactly once and stop."
    allowed_agents: tuple[str, ...] = ()
    allowed_scopes: tuple[Scope, ...] = ()

    def supports_parallel(self, args: dict[str, Any]) -> bool:
        return False

    def input_schema(self) -> dict[str, Any]:
        return _OUTPUT_SCHEMA

    def redact(self, args: dict[str, Any]) -> dict[str, Any]:
        return dict(args)

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
        raise RuntimeError("emit_code_workspace_repair is not executable")


_OUTPUT_TOOL: Tool = _EmitCodeWorkspaceRepairTool()  # type: ignore[assignment]


class CodeWorkspaceRepairAgent:
    name = "code_workspace_repair"

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    async def run(self, ctx: CodeWorkspaceRepairContext) -> CodeWorkspaceRepairOutput:
        messages = [
            {"role": "system", "content": CODE_WORKSPACE_REPAIR_SYSTEM},
            {
                "role": "user",
                "content": build_repair_prompt(
                    command=ctx.command,
                    exit_code=ctx.exit_code,
                    logs=ctx.logs,
                    manifest=ctx.manifest,
                ),
            },
        ]
        result = await self._llm.generate_with_tools(
            messages,
            [_OUTPUT_TOOL],
            mode="any",
            allowed_tool_names=["emit_code_workspace_repair"],
            max_output_tokens=8192,
        )

        for call in result.tool_uses or ():
            if call.name == "emit_code_workspace_repair":
                args = call.args
                files = args.get("files")
                if not isinstance(files, list):
                    raise RuntimeError("CodeWorkspaceRepairAgent returned invalid files")
                return CodeWorkspaceRepairOutput(
                    summary=str(args.get("summary") or "Repair code workspace failure"),
                    files=[
                        {
                            "path": str(item["path"]),
                            "content": str(item["content"]),
                        }
                        for item in files
                        if isinstance(item, dict)
                        and isinstance(item.get("path"), str)
                        and isinstance(item.get("content"), str)
                    ],
                )
        raise RuntimeError("CodeWorkspaceRepairAgent did not call emit_code_workspace_repair")
