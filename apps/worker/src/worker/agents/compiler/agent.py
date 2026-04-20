"""CompilerAgent — first of the three Plan 4 core agents.

The Compiler reads a freshly-ingested source note, extracts named concepts
with an LLM, dedupes them against the project's existing concepts via
pgvector kNN, upserts the survivors, links each one to the triggering note,
and writes a wiki_logs audit row per action.

It inherits from ``runtime.agent.Agent`` (Plan 12). The ``run`` generator
yields ``AgentEvent``s in the standard sequence so that the default hook
chain (trajectory writer, token counter, Sentry) observes it the same way
it would observe any other agent.

The Compiler does NOT talk to Postgres directly; it uses
``worker.lib.api_client.AgentApiClient`` to reach the internal Hono routes
added in Plan 4 Phase A. This keeps the architectural rule (apps/api owns
all business logic) intact.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, ClassVar

from llm import LLMProvider
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

from worker.agents.compiler.prompts import (
    EXTRACTION_SYSTEM,
    build_extraction_user_prompt,
)
from worker.lib.api_client import AgentApiClient

logger = logging.getLogger(__name__)


# Cosine-similarity threshold above which an extracted concept is merged
# into the existing row instead of creating a new one. 0.88 is conservative
# — identical phrasings tend to score > 0.95, synonyms 0.85-0.92. Tune in
# Librarian feedback; see Plan 5 Task M0.
MERGE_SIMILARITY_THRESHOLD = 0.88


@dataclass(frozen=True)
class CompilerInput:
    """Validated input to :class:`CompilerAgent`. The Temporal activity layer
    constructs this from the raw workflow payload.
    """

    note_id: str
    project_id: str
    workspace_id: str
    user_id: str


@dataclass(frozen=True)
class CompilerOutput:
    """Result of a Compiler run — used by the workflow to populate activity
    output + the ``agent_runs`` summary row.
    """

    note_id: str
    extracted_count: int
    created_count: int
    merged_count: int
    linked_count: int
    concept_ids: list[str]


class CompilerAgent(Agent):
    """Concept extractor + linker.

    Constructed with a live ``LLMProvider`` (Gemini or Ollama) and an
    ``AgentApiClient``. Both are injected so tests can substitute fakes.
    """

    name: ClassVar[str] = "compiler"
    description: ClassVar[str] = (
        "Extract concepts from a source note, dedupe against existing "
        "project concepts, link, and audit via wiki_logs."
    )

    def __init__(
        self,
        *,
        provider: LLMProvider,
        api: AgentApiClient | None = None,
    ) -> None:
        self.provider = provider
        self.api = api or AgentApiClient()

    # -- public entrypoint --------------------------------------------------

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = CompilerInput(
            note_id=input["note_id"],
            project_id=input["project_id"],
            workspace_id=input["workspace_id"],
            user_id=input["user_id"],
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
            # 1. Fetch the source note.
            note = await self._fetch_note(validated.note_id, ctx, seq, t0)
            async for ev in note.events:
                yield ev
            body_text: str = note.payload["contentText"] or ""
            title: str = note.payload.get("title", "Untitled")

            if not body_text.strip():
                # Nothing to compile — end cleanly so downstream consumers
                # don't see an agent_error for an empty source (e.g. scan
                # with OCR disabled). Librarian can retry later.
                yield CustomEvent(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="custom",
                    label="compiler.empty_note",
                    payload={"note_id": validated.note_id},
                )
                yield AgentEnd(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="agent_end",
                    output=CompilerOutput(
                        note_id=validated.note_id,
                        extracted_count=0,
                        created_count=0,
                        merged_count=0,
                        linked_count=0,
                        concept_ids=[],
                    ).__dict__,
                    duration_ms=int((time.time() - t0) * 1000),
                )
                return

            # 2. LLM extraction.
            extracted, extraction_events = await self._extract_concepts(
                title=title, body=body_text, ctx=ctx, seq=seq
            )
            async for ev in extraction_events:
                yield ev

            # 3. Per-concept: embed, search, upsert, link, log.
            created = 0
            merged = 0
            linked = 0
            concept_ids: list[str] = []
            for candidate in extracted:
                result = await self._process_concept(
                    candidate=candidate,
                    input=validated,
                    ctx=ctx,
                    seq=seq,
                )
                async for ev in result.events:
                    yield ev
                if result.concept_id is None:
                    continue
                concept_ids.append(result.concept_id)
                if result.was_created:
                    created += 1
                else:
                    merged += 1
                if result.was_linked:
                    linked += 1

            out = CompilerOutput(
                note_id=validated.note_id,
                extracted_count=len(extracted),
                created_count=created,
                merged_count=merged,
                linked_count=linked,
                concept_ids=concept_ids,
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
        except Exception as exc:  # noqa: BLE001 — agent-level catch-all is intentional
            logger.exception("CompilerAgent failed for note=%s", validated.note_id)
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

    # -- internal steps (emit ToolUse / ToolResult manually) ---------------

    async def _fetch_note(
        self,
        note_id: str,
        ctx: ToolContext,
        seq: _SeqCounter,
        t0: float,
    ) -> _StepResult:
        call_id = f"call-{uuid.uuid4().hex[:8]}"
        args = {"note_id": note_id}
        events: list[AgentEvent] = [
            ToolUse(
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
        ]
        started = time.time()
        note = await self.api.get_note(note_id)
        events.append(
            ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=call_id,
                ok=True,
                output={"title": note.get("title"), "length": len(note.get("contentText") or "")},
                duration_ms=int((time.time() - started) * 1000),
            )
        )
        return _StepResult(payload=note, events=_aiter(events))

    async def _extract_concepts(
        self,
        *,
        title: str,
        body: str,
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> tuple[list[dict[str, str]], AsyncGenerator[AgentEvent, None]]:
        events: list[AgentEvent] = []
        started = time.time()
        prompt = build_extraction_user_prompt(title, body)
        messages = [
            {"role": "system", "content": EXTRACTION_SYSTEM},
            {"role": "user", "content": prompt},
        ]
        raw = await self.provider.generate(
            messages,
            response_mime_type="application/json",
        )
        latency_ms = int((time.time() - started) * 1000)

        # The provider doesn't return token usage in our base interface yet
        # (Plan 12 follow-up). Emit ModelEnd with zeros so the event stream
        # still carries a model_end marker — TokenCounterHook will just
        # record a no-cost call.
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

        concepts = _parse_extraction(raw)
        return concepts, _aiter(events)

    async def _process_concept(
        self,
        *,
        candidate: dict[str, str],
        input: CompilerInput,
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> _ConceptProcessed:
        events: list[AgentEvent] = []
        name = candidate["name"].strip()
        description = candidate.get("description", "").strip()
        if not name:
            return _ConceptProcessed(concept_id=None, was_created=False, was_linked=False, events=_aiter([]))

        # Embed a combined "name — description" — gives dedupe better signal
        # than name alone when two notes use the same term with different
        # senses (e.g. "배치 정규화" in a CS note vs a statistics note).
        embed_text = name if not description else f"{name} — {description}"
        try:
            vecs = await self.provider.embed([EmbedInput(text=embed_text)])
            embedding = vecs[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Embedding failed for concept %s: %s", name, exc)
            return _ConceptProcessed(concept_id=None, was_created=False, was_linked=False, events=_aiter([]))

        # Search for existing concepts (name ILIKE first to catch exact
        # name matches that scored slightly below the vector threshold).
        search_call_id = f"call-{uuid.uuid4().hex[:8]}"
        search_args = {
            "project_id": input.project_id,
            "name_ilike": name,
            "k": 5,
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
                tool_name="search_concepts",
                input_args=search_args,
                input_hash=hash_input(search_args),
                concurrency_safe=True,
            )
        )
        search_started = time.time()
        existing = await self.api.search_concepts(
            project_id=input.project_id,
            embedding=embedding,
            k=5,
            name_ilike=name,
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
                output={"matches": len(existing)},
                duration_ms=int((time.time() - search_started) * 1000),
            )
        )

        merge_target = _pick_merge_target(name, existing)

        # Upsert (name-based dedupe happens server-side, but we also short-
        # circuit via merge_target when similarity is very high and the
        # name differs — the API's (project_id, name) key would have
        # missed that case).
        upsert_call_id = f"call-{uuid.uuid4().hex[:8]}"
        upsert_args = {
            "project_id": input.project_id,
            "name": merge_target["name"] if merge_target else name,
            "description": description,
        }
        events.append(
            ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=upsert_call_id,
                tool_name="upsert_concept",
                input_args=upsert_args,
                input_hash=hash_input(upsert_args),
                concurrency_safe=False,
            )
        )
        upsert_started = time.time()
        concept_id, created = await self.api.upsert_concept(
            project_id=input.project_id,
            name=merge_target["name"] if merge_target else name,
            description=description,
            embedding=embedding,
        )
        events.append(
            ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=upsert_call_id,
                ok=True,
                output={"id": concept_id, "created": created},
                duration_ms=int((time.time() - upsert_started) * 1000),
            )
        )

        # Link concept ↔ note (idempotent).
        link_call_id = f"call-{uuid.uuid4().hex[:8]}"
        link_args = {"concept_id": concept_id, "note_id": input.note_id}
        events.append(
            ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=link_call_id,
                tool_name="link_concept_note",
                input_args=link_args,
                input_hash=hash_input(link_args),
                concurrency_safe=False,
            )
        )
        link_started = time.time()
        await self.api.link_concept_note(
            concept_id=concept_id, note_id=input.note_id
        )
        events.append(
            ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=link_call_id,
                ok=True,
                output={"linked": True},
                duration_ms=int((time.time() - link_started) * 1000),
            )
        )

        # Audit log. "create" for a fresh concept, "link" when attaching to
        # an existing one. Reason carries the source name so history pages
        # can show "Compiler linked this note to <existing-concept>".
        action = "create" if created else "link"
        reason = (
            f"Compiler extracted concept '{name}' from note"
            if created
            else f"Compiler linked note to existing concept '{merge_target['name'] if merge_target else name}'"
        )
        await self.api.log_wiki(
            note_id=input.note_id,
            agent="compiler",
            action=action,
            reason=reason,
        )

        return _ConceptProcessed(
            concept_id=concept_id,
            was_created=created,
            was_linked=True,
            events=_aiter(events),
        )


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


@dataclass
class _StepResult:
    payload: dict[str, Any]
    events: AsyncGenerator[AgentEvent, None]


@dataclass
class _ConceptProcessed:
    concept_id: str | None
    was_created: bool
    was_linked: bool
    events: AsyncGenerator[AgentEvent, None]


async def _aiter(items: list[AgentEvent]) -> AsyncGenerator[AgentEvent, None]:
    for ev in items:
        yield ev


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)


def _parse_extraction(raw: str) -> list[dict[str, str]]:
    """Tolerant JSON parser. Some providers wrap output in a fenced block
    even when we ask for pure JSON (particularly Ollama); strip those here.
    On any parse failure, log and return an empty list — a bad extraction
    must not fail the workflow.
    """
    if not raw or not raw.strip():
        return []
    candidate = raw.strip()
    m = _JSON_BLOCK.search(candidate)
    if m:
        candidate = m.group(1).strip()
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError:
        logger.warning("Compiler: LLM extraction was not valid JSON; discarding")
        return []
    if not isinstance(payload, dict):
        return []
    concepts = payload.get("concepts")
    if not isinstance(concepts, list):
        return []
    out: list[dict[str, str]] = []
    for item in concepts:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        description = str(item.get("description", "")).strip()
        out.append({"name": name[:200], "description": description[:2000]})
    return out


def _pick_merge_target(
    name: str, existing: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Given the vector-search results, return the existing concept to merge
    into — or None to create fresh. The rule: an existing row above the
    similarity threshold (and not already matching the candidate name
    exactly — the server-side name dedupe handles that case).
    """
    lowered = name.lower()
    for row in existing:
        existing_name = str(row.get("name", ""))
        similarity = float(row.get("similarity", 0.0))
        if existing_name.lower() == lowered:
            # Server-side name dedupe will find this; no client-side merge.
            return None
        if similarity >= MERGE_SIMILARITY_THRESHOLD:
            return row
    return None


def _is_retryable(exc: Exception) -> bool:
    # HTTP 5xx + timeouts + connection errors → retry. 4xx (including the
    # internal-secret 401) → do not retry.
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    return False
