"""Plan 11B Phase A — DocEditorAgent.

Runs a single slash command per ``run`` invocation. Subclass of
``runtime.agent.Agent`` so the standard hook chain (trajectory, token
counter, Sentry) observes it identically to Compiler/Research/Librarian.

The output_mode is always 'diff' in Phase A. RAG-backed commands and the
'comment' / 'insert' modes land in Phase B/C.
"""
from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, ClassVar, Literal

from llm import LLMProvider
from pydantic import BaseModel, Field, model_validator

from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    ModelEnd,
)
from runtime.loop_runner import run_with_tools
from runtime.tool_loop import LoopConfig
from runtime.tools import ToolContext

from worker.agents.doc_editor.commands import get_command_spec
from worker.tools_builtin import emit_structured_output, search_notes
from worker.tools_builtin.schema_registry import register_schema

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DocEditorInput:
    command: str
    note_id: str
    project_id: str | None
    user_id: str
    selection_block_id: str
    selection_start: int
    selection_end: int
    selection_text: str
    document_context_snippet: str
    language: str | None


@dataclass(frozen=True)
class DocEditorOutput:
    command: str
    output_mode: str
    payload: dict[str, Any]
    tokens_in: int
    tokens_out: int
    tools_used: int = 0


class _RangeModel(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def _valid_order(self) -> "_RangeModel":
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


class _HunkModel(BaseModel):
    blockId: str = Field(min_length=1, max_length=128)
    originalRange: _RangeModel
    originalText: str
    replacementText: str


class _DiffPayloadModel(BaseModel):
    hunks: list[_HunkModel] = Field(min_length=1, max_length=20)
    summary: str = Field(default="", max_length=280)


class _EvidenceModel(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    snippet: str = Field(default="", max_length=800)
    url_or_ref: str | None = Field(default=None, max_length=512)
    confidence: float | None = Field(default=None, ge=0, le=1)


class _ClaimModel(BaseModel):
    blockId: str = Field(min_length=1, max_length=128)
    range: _RangeModel
    verdict: Literal["supported", "unclear", "contradicted"]
    evidence: list[_EvidenceModel] = Field(default_factory=list, max_length=8)
    note: str = Field(default="", max_length=280)


class _CommentPayloadModel(BaseModel):
    claims: list[_ClaimModel] = Field(min_length=1, max_length=20)


register_schema("DocEditorDiffPayload", _DiffPayloadModel)
register_schema("DocEditorCommentPayload", _CommentPayloadModel)


class _SeqCounter:
    __slots__ = ("_v",)

    def __init__(self) -> None:
        self._v = -1

    def next(self) -> int:
        self._v += 1
        return self._v


class DocEditorAgent(Agent):
    name: ClassVar[str] = "doc_editor"
    description: ClassVar[str] = (
        "Apply a slash-command (improve/translate/summarize/expand) to "
        "a selection range and return diff hunks."
    )

    def __init__(self, *, provider: LLMProvider) -> None:
        self.provider = provider

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = DocEditorInput(
            command=input["command"],
            note_id=input["note_id"],
            project_id=input.get("project_id"),
            user_id=input["user_id"],
            selection_block_id=input["selection"]["blockId"],
            selection_start=input["selection"]["start"],
            selection_end=input["selection"]["end"],
            selection_text=input["selection"]["text"],
            document_context_snippet=input.get("documentContextSnippet", ""),
            language=input.get("language"),
        )

        seq = _SeqCounter()
        t0 = time.time()
        yield AgentStart(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=t0,
            scope=ctx.scope,
            input={"command": validated.command, "note_id": validated.note_id},
        )

        try:
            spec = get_command_spec(validated.command)
            if len(validated.selection_text) > spec.max_selection_chars:
                raise ValueError(
                    f"selection too long: {len(validated.selection_text)} > {spec.max_selection_chars}"
                )

            user_msg = self._build_user_message(spec.name, validated)
            messages = [
                {"role": "system", "content": spec.system_prompt},
                {"role": "user", "content": user_msg},
            ]
            started = time.time()
            if spec.tools:
                payload, tokens_in, tokens_out, tools_used = await self._run_tool_loop(
                    spec=spec,
                    messages=messages,
                    ctx=ctx,
                    project_id=validated.project_id,
                )
            else:
                raw = await self.provider.generate(
                    messages,
                    response_mime_type="application/json",
                )
                payload = self._parse_diff_payload(
                    raw,
                    fallback_block_id=validated.selection_block_id,
                    fallback_text=validated.selection_text,
                    fallback_start=validated.selection_start,
                    fallback_end=validated.selection_end,
                )
                # Token counts: provider.generate doesn't return Usage yet
                # (Plan 12 follow-up). Keep zeros instead of heuristics.
                tokens_in = 0
                tokens_out = 0
                tools_used = 0
            latency_ms = int((time.time() - started) * 1000)

            yield ModelEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                model_id=self.provider.config.model or "unknown",
                prompt_tokens=tokens_in,
                completion_tokens=tokens_out,
                cached_tokens=0,
                cost_krw=0,
                finish_reason="stop",
                latency_ms=latency_ms,
            )

            out = DocEditorOutput(
                command=validated.command,
                output_mode=spec.output_mode,
                payload=payload,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                tools_used=tools_used,
            )
            yield AgentEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                output=out.__dict__,
                duration_ms=int((time.time() - t0) * 1000),
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("DocEditorAgent failed (command=%s)", input.get("command"))
            yield AgentError(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                error_class=type(exc).__name__,
                message=str(exc),
                retryable=False,
            )
            raise

    def _build_user_message(self, command: str, v: DocEditorInput) -> str:
        header_lines = [f"Block id: {v.selection_block_id}"]
        if command == "translate" and v.language:
            header_lines.append(f"Target language: {v.language}")
        header_lines.append(
            f"Range: start={v.selection_start} end={v.selection_end}"
        )
        header = "\n".join(header_lines)
        return (
            f"{header}\n\n"
            "=== Surrounding context (read-only) ===\n"
            f"{v.document_context_snippet}\n\n"
            "=== Selection (rewrite this) ===\n"
            f"{v.selection_text}"
        )

    async def _run_tool_loop(
        self,
        *,
        spec,
        messages: list[dict[str, str]],
        ctx: ToolContext,
        project_id: str | None,
    ) -> tuple[dict[str, Any], int, int, int]:
        tools = self._resolve_tools(spec.tools)
        schema_name = (
            "DocEditorCommentPayload"
            if spec.output_mode == "comment"
            else "DocEditorDiffPayload"
        )
        loop_result = await run_with_tools(
            provider=self.provider,
            initial_messages=[
                messages[0],
                {
                    "role": "user",
                    "content": (
                        f"{messages[1]['content']}\n\n"
                        "Return the final answer as JSON. If you use "
                        "emit_structured_output, use schema_name="
                        f"'{schema_name}'."
                    ),
                },
            ],
            tools=tools,
            tool_context={
                "workspace_id": ctx.workspace_id,
                "project_id": project_id or ctx.project_id,
                "page_id": ctx.page_id,
                "user_id": ctx.user_id,
                "run_id": ctx.run_id,
                "scope": "project",
            },
            config=LoopConfig(
                max_turns=4,
                max_tool_calls=8,
                allowed_tool_names=list(spec.tools),
                final_response_schema=(
                    _CommentPayloadModel
                    if spec.output_mode == "comment"
                    else _DiffPayloadModel
                ),
            ),
        )
        raw_payload = loop_result.final_structured_output
        if raw_payload is None and loop_result.final_text:
            raw_payload = self._json_from_text(loop_result.final_text)
        if raw_payload is None:
            raise ValueError(
                f"tool loop ended without structured output: {loop_result.termination_reason}"
            )
        if spec.output_mode == "comment":
            payload = self._parse_comment_payload(raw_payload)
        else:
            payload = self._parse_diff_payload(raw_payload)
        return (
            payload,
            loop_result.total_input_tokens,
            loop_result.total_output_tokens,
            loop_result.tool_call_count,
        )

    def _resolve_tools(self, names: tuple[str, ...]) -> list[Any]:
        by_name = {
            "search_notes": search_notes,
            "emit_structured_output": emit_structured_output,
        }
        return [by_name[name] for name in names]

    _JSON_FENCE = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)

    def _parse_diff_payload(
        self,
        raw: str | dict[str, Any],
        *,
        fallback_block_id: str | None = None,
        fallback_text: str = "",
        fallback_start: int = 0,
        fallback_end: int = 0,
    ) -> dict[str, Any]:
        data = self._json_from_text(raw) if isinstance(raw, str) else raw
        if not isinstance(data, dict) or "hunks" not in data:
            raise ValueError("LLM output missing 'hunks'")
        hunks = data.get("hunks") or []
        if not isinstance(hunks, list) or not hunks:
            raise ValueError("LLM output 'hunks' empty")
        clean: list[dict[str, Any]] = []
        for h in hunks:
            if not isinstance(h, dict):
                continue
            block_id = h.get("blockId") or fallback_block_id
            if not block_id:
                continue
            rng = h.get("originalRange") or {}
            # `or fallback_*` would corrupt legitimate `0` start; explicit None check.
            start_raw = rng.get("start")
            end_raw = rng.get("end")
            start = int(start_raw if start_raw is not None else fallback_start)
            end = int(end_raw if end_raw is not None else fallback_end)
            original = str(h.get("originalText") or fallback_text)
            replacement = str(h.get("replacementText") or "")
            clean.append(
                {
                    "blockId": block_id,
                    "originalRange": {"start": start, "end": end},
                    "originalText": original,
                    "replacementText": replacement,
                }
            )
        return {
            "hunks": clean,
            "summary": str(data.get("summary") or "")[:280],
        }

    def _parse_comment_payload(self, raw: dict[str, Any] | str) -> dict[str, Any]:
        data = self._json_from_text(raw) if isinstance(raw, str) else raw
        parsed = _CommentPayloadModel.model_validate(data)
        return parsed.model_dump()

    def _json_from_text(self, raw: str) -> Any:
        text = raw.strip()
        m = self._JSON_FENCE.search(text)
        if m:
            text = m.group(1).strip()
        return json.loads(text)
