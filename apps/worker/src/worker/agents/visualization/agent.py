"""VisualizationAgent — first NEW agent on the Sub-A run_with_tools loop.

Plan 5 Phase 2 Task 5. Converts a natural-language request into a
``ViewSpec`` (structured visualization plan) by composing three builtin
tools through ``runtime.loop_runner.run_with_tools``:

  1. ``search_concepts(query, k)`` — locate the topic root.
  2. ``get_concept_graph(concept_id, hops)`` — expand a focused subgraph.
  3. ``emit_structured_output(schema_name="ViewSpec", data=...)`` —
     terminate the loop with a validated payload.

The runtime owns the tool-use loop, retries, guards, and structured-output
acceptance. This module is intentionally thin: it builds the messages and
``LoopConfig``, delegates, and translates the resulting ``LoopResult``
into a ``VisualizationOutput`` (or ``VisualizationFailed``).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, ClassVar

from runtime.loop_runner import run_with_tools
from runtime.tool_loop import LoopConfig, LoopHooks, LoopResult

# Importing registers ViewSpec in SCHEMA_REGISTRY as a side-effect.
import worker.tools_builtin.view_spec_schema  # noqa: F401
from worker.agents.visualization.prompts import VISUALIZATION_SYSTEM
from worker.tools_builtin import (
    emit_structured_output,
    search_concepts,
)
from worker.tools_builtin.get_concept_graph import get_concept_graph


@dataclass(frozen=True)
class VisualizeRequest:
    project_id: str
    workspace_id: str
    user_id: str
    run_id: str
    prompt: str
    view_hint: str | None = None  # graph | mindmap | cards | timeline | board


@dataclass(frozen=True)
class VisualizationOutput:
    view_spec: dict[str, Any]
    tool_calls: int
    turn_count: int


class VisualizationFailed(Exception):
    """Raised when the agent loop ends without emit_structured_output."""


class VisualizationAgent:
    name: ClassVar[str] = "visualization"
    description: ClassVar[str] = (
        "Resolve a natural-language request into a ViewSpec by searching "
        "concepts, fetching a focused subgraph, and emitting a structured "
        "view. Terminates on emit_structured_output(schema_name='ViewSpec')."
    )

    def __init__(self, *, provider) -> None:
        self.provider = provider

    async def run(
        self,
        *,
        request: VisualizeRequest,
        hooks: LoopHooks | None = None,
    ) -> VisualizationOutput:
        user_text = self._build_user_prompt(request)
        result: LoopResult = await run_with_tools(
            provider=self.provider,
            initial_messages=[
                {"role": "system", "text": VISUALIZATION_SYSTEM},
                {"role": "user", "text": user_text},
            ],
            tools=[search_concepts, get_concept_graph, emit_structured_output],
            tool_context={
                "workspace_id": request.workspace_id,
                "project_id": request.project_id,
                "user_id": request.user_id,
                "run_id": request.run_id,
                "scope": "project",
            },
            config=LoopConfig(max_turns=6, max_tool_calls=10),
            hooks=hooks,
        )
        if (
            result.termination_reason != "structured_submitted"
            or result.final_structured_output is None
        ):
            raise VisualizationFailed(
                f"agent_did_not_emit_view_spec "
                f"(reason={result.termination_reason})"
            )
        return VisualizationOutput(
            view_spec=result.final_structured_output,
            tool_calls=result.tool_call_count,
            turn_count=result.turn_count,
        )

    def _build_user_prompt(self, req: VisualizeRequest) -> str:
        hint = (
            f"\n\nUser-preferred view: {req.view_hint}." if req.view_hint else ""
        )
        return (
            f"Project: {req.project_id}\n"
            f"User request: {req.prompt}{hint}\n\n"
            "Identify the relevant concepts, fetch the subgraph, and submit "
            "a ViewSpec via emit_structured_output. Use search_concepts to "
            "find the topic root, get_concept_graph to expand, then "
            "emit_structured_output(schema_name='ViewSpec', data=...) to "
            "finish."
        )
