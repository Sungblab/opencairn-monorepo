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
from typing import Any, ClassVar

from llm import LLMProvider

from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    ModelEnd,
)
from runtime.tools import ToolContext

from worker.agents.doc_editor.commands import get_command_spec

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DocEditorInput:
    command: str
    note_id: str
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
            raw = await self.provider.generate(
                messages,
                response_mime_type="application/json",
            )
            latency_ms = int((time.time() - started) * 1000)

            # Token counts: provider.generate doesn't return Usage yet (Plan
            # 12 follow-up — same gap CompilerAgent documents). Deliberately
            # NOT applying len(text)//4 because it under-counts CJK 2-3x and
            # would mis-bill workspaces. Emit zeros until provider upgrade.
            tokens_in = 0
            tokens_out = 0
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

            payload = self._parse_diff_payload(
                raw,
                fallback_block_id=validated.selection_block_id,
                fallback_text=validated.selection_text,
                fallback_start=validated.selection_start,
                fallback_end=validated.selection_end,
            )
            out = DocEditorOutput(
                command=validated.command,
                output_mode="diff",
                payload=payload,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
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

    _JSON_FENCE = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)

    def _parse_diff_payload(
        self,
        raw: str,
        *,
        fallback_block_id: str,
        fallback_text: str,
        fallback_start: int,
        fallback_end: int,
    ) -> dict[str, Any]:
        text = raw.strip()
        m = self._JSON_FENCE.search(text)
        if m:
            text = m.group(1).strip()
        data = json.loads(text)
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
