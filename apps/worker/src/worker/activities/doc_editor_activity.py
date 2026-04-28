"""Plan 11B Phase A — Temporal activity that invokes DocEditorAgent."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from temporalio import activity

from llm import get_provider
from runtime.events import AgentEnd, AgentEvent
from runtime.tools import ToolContext

from worker.agents.doc_editor.agent import DocEditorAgent


@dataclass(frozen=True)
class DocEditorActivityInput:
    command: str
    note_id: str
    workspace_id: str
    project_id: str | None
    user_id: str
    selection_block_id: str
    selection_start: int
    selection_end: int
    selection_text: str
    document_context_snippet: str
    language: str | None


async def _noop_emit(_event: AgentEvent) -> None:
    """In-process activities don't subscribe to per-event hooks here; the
    AgentEnd payload is captured by the caller. Trajectory writers run via
    the runtime hook chain, not via emit."""
    return None


async def _invoke_agent(payload: DocEditorActivityInput) -> dict[str, Any]:
    provider = get_provider()
    agent = DocEditorAgent(provider=provider)
    ctx = ToolContext(
        workspace_id=payload.workspace_id,
        project_id=payload.project_id,
        page_id=payload.note_id,
        user_id=payload.user_id,
        run_id=f"doc-editor-{uuid.uuid4().hex[:12]}",
        scope="page",
        emit=_noop_emit,
    )
    output: dict[str, Any] | None = None
    async for ev in agent.run(
        {
            "command": payload.command,
            "selection": {
                "blockId": payload.selection_block_id,
                "start": payload.selection_start,
                "end": payload.selection_end,
                "text": payload.selection_text,
            },
            "documentContextSnippet": payload.document_context_snippet,
            "language": payload.language,
            "note_id": payload.note_id,
            "project_id": payload.project_id,
            "user_id": payload.user_id,
        },
        ctx,
    ):
        if isinstance(ev, AgentEnd):
            output = ev.output
    if output is None:
        raise RuntimeError("DocEditorAgent did not yield AgentEnd")
    return output


@activity.defn(name="run_doc_editor")
async def run_doc_editor(payload: DocEditorActivityInput) -> dict[str, Any]:
    return await _invoke_agent(payload)
