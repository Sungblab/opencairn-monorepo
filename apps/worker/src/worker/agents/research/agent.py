"""ResearchAgent — Plan 4 Phase B.

Answers a natural-language query by:

1. Decomposing it into 1-4 focused sub-queries (LLM).
2. Embedding each sub-query and running the hybrid search internal
   endpoint (pgvector + BM25 with RRF fuse) to collect source-note evidence.
3. Deduping the evidence by note id, keeping the best RRF rank.
4. Drafting an answer with inline ``[[note-id]]`` citations (LLM).
5. Emitting a short wiki-feedback list naming notes that look stale or
   conflicting so the Librarian can follow up (LLM).

Mirrors ``CompilerAgent`` — subclass of :class:`runtime.agent.Agent`,
emits the full event sequence, talks only to :class:`AgentApiClient`.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar

from llm.base import EmbedInput

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
from worker.agents.research.prompts import (
    ANSWER_SYSTEM,
    DECOMPOSE_SYSTEM,
    WIKI_FEEDBACK_SYSTEM,
    build_answer_prompt,
    build_decompose_prompt,
    build_wiki_feedback_prompt,
    format_evidence_block,
)
from worker.lib.api_client import AgentApiClient

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from llm import LLMProvider

logger = logging.getLogger(__name__)


DEFAULT_TOP_K = 8
MAX_EVIDENCE_ITEMS = 12


@dataclass(frozen=True)
class ResearchInput:
    query: str
    project_id: str
    workspace_id: str
    user_id: str
    top_k: int = DEFAULT_TOP_K


@dataclass
class ResearchCitation:
    note_id: str
    title: str
    snippet: str
    rrf_score: float


@dataclass
class ResearchWikiFeedback:
    note_id: str
    suggestion: str
    reason: str


@dataclass
class ResearchOutput:
    query: str
    answer: str
    sub_queries: list[str] = field(default_factory=list)
    citations: list[ResearchCitation] = field(default_factory=list)
    wiki_feedback: list[ResearchWikiFeedback] = field(default_factory=list)


class ResearchAgent(Agent):
    name: ClassVar[str] = "research"
    description: ClassVar[str] = (
        "Answer a question using hybrid-search evidence from the project's "
        "source notes; cite notes inline and flag wiki follow-ups."
    )

    def __init__(
        self,
        *,
        provider: LLMProvider,
        api: AgentApiClient | None = None,
    ) -> None:
        self.provider = provider
        self.api = api or AgentApiClient()

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = ResearchInput(
            query=input["query"],
            project_id=input["project_id"],
            workspace_id=input["workspace_id"],
            user_id=input["user_id"],
            top_k=int(input.get("top_k", DEFAULT_TOP_K)),
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
            # 1. Decompose.
            sub_queries, events = await self._decompose(validated.query, ctx, seq)
            async for ev in events:
                yield ev
            if not sub_queries:
                sub_queries = [validated.query]

            # 2. Retrieve evidence for each sub-query, dedupe by note id.
            citations, events = await self._retrieve_evidence(
                sub_queries=sub_queries,
                project_id=validated.project_id,
                top_k=validated.top_k,
                ctx=ctx,
                seq=seq,
            )
            async for ev in events:
                yield ev

            # 3. Answer + wiki feedback share the evidence block.
            evidence_block = format_evidence_block(
                [_citation_to_dict(c) for c in citations]
            )

            answer, events = await self._generate_answer(
                query=validated.query,
                evidence_block=evidence_block,
                ctx=ctx,
                seq=seq,
            )
            async for ev in events:
                yield ev

            feedback, events = await self._wiki_feedback(
                query=validated.query,
                answer=answer,
                evidence_block=evidence_block,
                citations=citations,
                ctx=ctx,
                seq=seq,
            )
            async for ev in events:
                yield ev

            output = ResearchOutput(
                query=validated.query,
                answer=answer,
                sub_queries=list(sub_queries),
                citations=citations,
                wiki_feedback=feedback,
            )
            yield AgentEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_end",
                output=_output_to_dict(output),
                duration_ms=int((time.time() - t0) * 1000),
            )
        except Exception as exc:  # noqa: BLE001 — catch-all is deliberate
            logger.exception("ResearchAgent failed for query=%r", validated.query)
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

    # -- internal steps -----------------------------------------------------

    async def _decompose(
        self, query: str, ctx: ToolContext, seq: _SeqCounter
    ) -> tuple[list[str], AsyncGenerator[AgentEvent, None]]:
        events: list[AgentEvent] = []
        started = time.time()
        messages = [
            {"role": "system", "content": DECOMPOSE_SYSTEM},
            {"role": "user", "content": build_decompose_prompt(query)},
        ]
        raw = await self.provider.generate(
            messages,
            response_mime_type="application/json",
        )
        latency_ms = int((time.time() - started) * 1000)
        events.append(
            ModelEnd(
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
        )
        return _parse_sub_queries(raw), _aiter(events)

    async def _retrieve_evidence(
        self,
        *,
        sub_queries: list[str],
        project_id: str,
        top_k: int,
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> tuple[list[ResearchCitation], AsyncGenerator[AgentEvent, None]]:
        events: list[AgentEvent] = []
        merged: dict[str, ResearchCitation] = {}
        for sub_query in sub_queries:
            # Embed the sub-query. Emitted as a tool call so trajectories
            # show the embedding cost + input hash explicitly.
            embed_call_id = f"call-{uuid.uuid4().hex[:8]}"
            embed_args = {"text": sub_query}
            events.append(
                ToolUse(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_use",
                    tool_call_id=embed_call_id,
                    tool_name="embed_query",
                    input_args=embed_args,
                    input_hash=hash_input(embed_args),
                    concurrency_safe=True,
                )
            )
            embed_started = time.time()
            try:
                vecs = await self.provider.embed([EmbedInput(text=sub_query)])
                embedding = vecs[0]
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Research: embedding failed for %r: %s", sub_query, exc
                )
                events.append(
                    ToolResult(
                        run_id=ctx.run_id,
                        workspace_id=ctx.workspace_id,
                        agent_name=self.name,
                        seq=seq.next(),
                        ts=time.time(),
                        type="tool_result",
                        tool_call_id=embed_call_id,
                        ok=False,
                        output={"error": str(exc)},
                        duration_ms=int((time.time() - embed_started) * 1000),
                    )
                )
                continue
            events.append(
                ToolResult(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_result",
                    tool_call_id=embed_call_id,
                    ok=True,
                    output={"dim": len(embedding)},
                    duration_ms=int((time.time() - embed_started) * 1000),
                )
            )

            # Hybrid search.
            search_call_id = f"call-{uuid.uuid4().hex[:8]}"
            search_args = {
                "project_id": project_id,
                "query_text": sub_query,
                "k": top_k,
            }
            events.append(
                ToolUse(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_use",
                    tool_call_id=search_call_id,
                    tool_name="hybrid_search_notes",
                    input_args=search_args,
                    input_hash=hash_input(search_args),
                    concurrency_safe=True,
                )
            )
            search_started = time.time()
            hits = await self.api.hybrid_search_notes(
                project_id=project_id,
                query_text=sub_query,
                query_embedding=embedding,
                k=top_k,
            )
            events.append(
                ToolResult(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_result",
                    tool_call_id=search_call_id,
                    ok=True,
                    output={"hits": len(hits)},
                    duration_ms=int((time.time() - search_started) * 1000),
                )
            )

            for hit in hits:
                note_id = str(hit.get("noteId") or hit.get("id") or "")
                if not note_id:
                    continue
                rrf = float(hit.get("rrfScore", 0.0))
                existing = merged.get(note_id)
                if existing is None or rrf > existing.rrf_score:
                    merged[note_id] = ResearchCitation(
                        note_id=note_id,
                        title=str(hit.get("title", "Untitled")),
                        snippet=str(hit.get("snippet", "")),
                        rrf_score=rrf,
                    )

        # Keep the strongest N — prompt size budget is finite.
        ordered = sorted(
            merged.values(), key=lambda c: c.rrf_score, reverse=True
        )[:MAX_EVIDENCE_ITEMS]

        events.append(
            CustomEvent(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="custom",
                label="research.evidence_collected",
                payload={"count": len(ordered)},
            )
        )
        return ordered, _aiter(events)

    async def _generate_answer(
        self,
        *,
        query: str,
        evidence_block: str,
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> tuple[str, AsyncGenerator[AgentEvent, None]]:
        events: list[AgentEvent] = []
        started = time.time()
        messages = [
            {"role": "system", "content": ANSWER_SYSTEM},
            {"role": "user", "content": build_answer_prompt(query, evidence_block)},
        ]
        answer = await self.provider.generate(messages)
        latency_ms = int((time.time() - started) * 1000)
        events.append(
            ModelEnd(
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
        )
        return (answer or "").strip(), _aiter(events)

    async def _wiki_feedback(
        self,
        *,
        query: str,
        answer: str,
        evidence_block: str,
        citations: list[ResearchCitation],
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> tuple[list[ResearchWikiFeedback], AsyncGenerator[AgentEvent, None]]:
        events: list[AgentEvent] = []
        if not citations:
            # No evidence → no notes to critique; skip the LLM call.
            return [], _aiter(events)

        started = time.time()
        messages = [
            {"role": "system", "content": WIKI_FEEDBACK_SYSTEM},
            {
                "role": "user",
                "content": build_wiki_feedback_prompt(
                    query=query, answer=answer, evidence_block=evidence_block
                ),
            },
        ]
        raw = await self.provider.generate(
            messages,
            response_mime_type="application/json",
        )
        latency_ms = int((time.time() - started) * 1000)
        events.append(
            ModelEnd(
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
        )

        valid_ids = {c.note_id for c in citations}
        return _parse_wiki_feedback(raw, valid_ids), _aiter(events)


# ---------------------------------------------------------------------------
# Module-private helpers
# ---------------------------------------------------------------------------


class _SeqCounter:
    __slots__ = ("_value",)

    def __init__(self) -> None:
        self._value = -1

    def next(self) -> int:
        self._value += 1
        return self._value


async def _aiter(items: list[AgentEvent]) -> AsyncGenerator[AgentEvent, None]:
    for ev in items:
        yield ev


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)


def _strip_fence(raw: str) -> str:
    if not raw:
        return ""
    text = raw.strip()
    m = _JSON_BLOCK.search(text)
    return m.group(1).strip() if m else text


def _parse_sub_queries(raw: str) -> list[str]:
    text = _strip_fence(raw)
    if not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Research: decompose output was not JSON; using raw query")
        return []
    if isinstance(payload, list):
        candidates: list[Any] = payload
    elif isinstance(payload, dict):
        candidates = payload.get("sub_queries") or []
    else:
        return []
    out: list[str] = []
    for item in candidates:
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if trimmed:
            out.append(trimmed[:500])
        if len(out) >= 4:
            break
    return out


def _parse_wiki_feedback(
    raw: str, valid_ids: set[str]
) -> list[ResearchWikiFeedback]:
    text = _strip_fence(raw)
    if not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Research: wiki_feedback output was not JSON; discarding")
        return []
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = payload.get("feedback") or []
    else:
        return []
    out: list[ResearchWikiFeedback] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        note_id = str(item.get("note_id") or item.get("noteId") or "").strip()
        if not note_id or note_id not in valid_ids:
            # Drop hallucinated ids — protects Librarian from chasing ghosts.
            continue
        suggestion = str(item.get("suggestion", "")).strip()
        reason = str(item.get("reason", "")).strip()
        if not suggestion:
            continue
        out.append(
            ResearchWikiFeedback(
                note_id=note_id,
                suggestion=suggestion[:1000],
                reason=reason[:500],
            )
        )
        if len(out) >= 3:
            break
    return out


def _citation_to_dict(c: ResearchCitation) -> dict[str, str]:
    return {
        "noteId": c.note_id,
        "title": c.title,
        "snippet": c.snippet,
    }


def _output_to_dict(out: ResearchOutput) -> dict[str, Any]:
    return {
        "query": out.query,
        "answer": out.answer,
        "sub_queries": list(out.sub_queries),
        "citations": [
            {
                "note_id": c.note_id,
                "title": c.title,
                "snippet": c.snippet,
                "rrf_score": c.rrf_score,
            }
            for c in out.citations
        ],
        "wiki_feedback": [
            {
                "note_id": f.note_id,
                "suggestion": f.suggestion,
                "reason": f.reason,
            }
            for f in out.wiki_feedback
        ],
    }


def _is_retryable(exc: Exception) -> bool:
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    return bool(isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)))
