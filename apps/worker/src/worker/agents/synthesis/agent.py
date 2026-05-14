"""SynthesisAgent — multi-note essay generator.

Given a list of note IDs, the agent:
1. Fetches each note's content via the internal API.
2. Calls the LLM with gathered contexts to produce a synthesized essay.
3. Saves the essay as a new wiki note via the internal API.
4. Returns the new note's ID and basic stats.

Follows the runtime.Agent contract (Plan 12) so the event stream is
observed by the trajectory writer + token counter hooks exactly as any
other agent in the platform.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, ClassVar

from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    CustomEvent,
    ModelEnd,
    ToolResult,
    ToolUse,
)
from runtime.tools import ToolContext, hash_input
from worker.agents.synthesis.prompts import SYNTHESIS_SYSTEM, build_synthesis_prompt
from worker.lib.api_client import AgentApiClient, post_internal

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from llm import LLMProvider

logger = logging.getLogger(__name__)


# Maximum character count taken from each note's contentText to keep the
# prompt within reasonable bounds. Adjust when context windows grow.
_MAX_NOTE_CHARS = 8_000


@dataclass(frozen=True)
class SynthesisInput:
    """Validated input to :class:`SynthesisAgent`."""

    note_ids: list[str]
    project_id: str
    workspace_id: str
    user_id: str
    title: str = "Synthesis"
    style: str = ""


@dataclass(frozen=True)
class SynthesisOutput:
    """Result of a Synthesis run."""

    note_id: str
    word_count: int
    source_note_ids: list[str]


class SynthesisAgent(Agent):
    """Multi-note essay generator.

    Constructed with a live ``LLMProvider`` (Gemini or Ollama) and an
    ``AgentApiClient``. Both are injected so tests can substitute fakes.
    """

    name: ClassVar[str] = "synthesis"
    description: ClassVar[str] = (
        "Fetch multiple notes, synthesize them into a coherent essay via LLM, "
        "and save the result as a new wiki note."
    )

    def __init__(
        self,
        *,
        provider: LLMProvider,
        api: AgentApiClient | None = None,
    ) -> None:
        self.provider = provider
        self.api = api or AgentApiClient()

    # -- public entrypoint ---------------------------------------------------

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = SynthesisInput(
            note_ids=list(input["note_ids"]),
            project_id=input["project_id"],
            workspace_id=input["workspace_id"],
            user_id=input["user_id"],
            title=input.get("title", "Synthesis"),
            style=input.get("style", ""),
        )

        t0 = time.time()
        seq = _SeqCounter()

        yield AgentStart(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=t0,
            scope=ctx.scope,
            input=dict(input),
        )

        try:
            # 1. Emit ToolUse events for all fetches, then gather in parallel.
            call_ids = []
            for note_id in validated.note_ids:
                call_id = f"call-{uuid.uuid4().hex[:8]}"
                call_ids.append(call_id)
                args = {"note_id": note_id}
                yield ToolUse(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_use",
                    tool_call_id=call_id,
                    tool_name="fetch_note",
                    input_args=args,
                    input_hash=hash_input(args),
                    concurrency_safe=True,
                )

            t_fetch = time.time()
            fetch_results = await asyncio.gather(
                *[self.api.get_note(nid) for nid in validated.note_ids],
                return_exceptions=True,
            )
            fetch_ms = int((time.time() - t_fetch) * 1000)

            contexts: list[dict[str, str]] = []
            for note_id, call_id, result in zip(
                validated.note_ids, call_ids, fetch_results, strict=False
            ):
                if isinstance(result, Exception):
                    logger.warning(
                        "SynthesisAgent: failed to fetch note %s: %s",
                        note_id,
                        result,
                    )
                    yield ToolResult(
                        run_id=ctx.run_id,
                        workspace_id=ctx.workspace_id,
                        agent_name=self.name,
                        seq=seq.next(),
                        ts=time.time(),
                        type="tool_result",
                        tool_call_id=call_id,
                        ok=False,
                        output={"error": str(result)},
                        duration_ms=fetch_ms,
                    )
                else:
                    text = (result.get("contentText") or "")[:_MAX_NOTE_CHARS]
                    title = result.get("title") or "Untitled"
                    contexts.append({"title": title, "text": text})
                    yield ToolResult(
                        run_id=ctx.run_id,
                        workspace_id=ctx.workspace_id,
                        agent_name=self.name,
                        seq=seq.next(),
                        ts=time.time(),
                        type="tool_result",
                        tool_call_id=call_id,
                        ok=True,
                        output={"title": title, "chars": len(text)},
                        duration_ms=fetch_ms,
                    )

            # Require at least one note to have content.
            usable = [c for c in contexts if c.get("text")]
            if not usable:
                raise ValueError(
                    "No usable note content found in the provided note_ids."
                )

            # 2. LLM synthesis call.
            messages = [
                {"role": "system", "content": SYNTHESIS_SYSTEM},
                {
                    "role": "user",
                    "content": build_synthesis_prompt(
                        usable, validated.title, validated.style
                    ),
                },
            ]
            llm_started = time.time()
            essay_text: str = await self.provider.generate(messages)
            latency_ms = int((time.time() - llm_started) * 1000)

            yield ModelEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="model_end",
                model_id=self.provider.config.model or "unknown",
                prompt_tokens=0,
                completion_tokens=0,
                cached_tokens=0,
                cost_krw=0,
                finish_reason="stop",
                latency_ms=latency_ms,
            )

            # 3. Save the synthesized essay as a new wiki note.
            save_call_id = f"call-{uuid.uuid4().hex[:8]}"
            save_args = {
                "project_id": validated.project_id,
                "title": validated.title,
            }
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=save_call_id,
                tool_name="create_note",
                input_args=save_args,
                input_hash=hash_input(save_args),
                concurrency_safe=False,
            )
            save_started = time.time()
            result = await post_internal(
                "/api/internal/notes",
                {
                    "projectId": validated.project_id,
                    "workspaceId": validated.workspace_id,
                    "title": validated.title,
                    "type": "note",
                    "contentText": essay_text,
                    "content": None,
                },
            )
            new_note_id: str = result["id"]
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=save_call_id,
                ok=True,
                output={"note_id": new_note_id},
                duration_ms=int((time.time() - save_started) * 1000),
            )

            word_count = len(essay_text.split())

            # 4. Custom completion event.
            yield CustomEvent(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="custom",
                label="synthesis.completed",
                payload={"note_id": new_note_id, "word_count": word_count},
            )

            out = SynthesisOutput(
                note_id=new_note_id,
                word_count=word_count,
                source_note_ids=validated.note_ids,
            )
            yield AgentEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_end",
                output=out.__dict__,
                duration_ms=int((time.time() - t0) * 1000),
            )

        except Exception as exc:  # noqa: BLE001
            logger.exception("SynthesisAgent failed")
            yield AgentError(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_error",
                error_class=type(exc).__name__,
                message=str(exc),
                retryable=_is_retryable(exc),
            )
            raise


# ---------------------------------------------------------------------------
# Helpers (module-private)
# ---------------------------------------------------------------------------


class _SeqCounter:
    __slots__ = ("_value",)

    def __init__(self) -> None:
        self._value = -1

    def next(self) -> int:
        self._value += 1
        return self._value


def _is_retryable(exc: Exception) -> bool:
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    return bool(isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)))
