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

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, ClassVar

from llm import ENV_BATCH_ENABLED_COMPILER, LLMProvider, embed_many
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
from runtime.usage import provider_usage
from worker.agents.compiler.prompts import (
    EXTRACTION_SYSTEM,
    build_extraction_user_prompt,
)
from worker.lib.api_client import AgentApiClient

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


# Cosine-similarity threshold above which an extracted concept is merged
# into the existing row instead of creating a new one. 0.88 is conservative
# — identical phrasings tend to score > 0.95, synonyms 0.85-0.92. Tune in
# Librarian feedback; see Plan 5 Task M0.
MERGE_SIMILARITY_THRESHOLD = 0.88
MAX_COMPILER_WIKI_PAGE_ACTIONS = 5
ONTOLOGY_RELATION_EDGE_CONCURRENCY = 8
WIKI_PAGE_REQUEST_NAMESPACE = uuid.UUID("dd8d8cc6-7f4b-42d0-8f2c-c8d3fe89da8f")
WIKI_PAGE_UPDATE_REQUEST_NAMESPACE = uuid.UUID("61009c8c-2759-43fc-b398-97e36d433184")
ONTOLOGY_RELATION_PREDICATES = {
    "is_a",
    "part_of",
    "contains",
    "depends_on",
    "causes",
    "same_as_candidate",
    "is_related_to",
}


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
    wiki_page_actions_created: int = 0
    wiki_page_update_actions_created: int = 0


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
        batch_submit=None,
    ) -> None:
        self.provider = provider
        self.api = api or AgentApiClient()
        # Plan 3b — optional batch-embed callback. When the Compiler
        # activity injects one and BATCH_EMBED_COMPILER_ENABLED=true, all
        # extracted-concept embeddings are submitted in one batch before
        # the per-concept loop runs. None = tests/scripts always sync.
        self._batch_submit = batch_submit

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
                        wiki_page_actions_created=0,
                        wiki_page_update_actions_created=0,
                    ).__dict__,
                    duration_ms=int((time.time() - t0) * 1000),
                )
                return

            # 2. LLM extraction.
            extracted, extracted_relations, extraction_events = await self._extract_concepts(
                title=title, body=body_text, ctx=ctx, seq=seq
            )
            async for ev in extraction_events:
                yield ev

            # 3a. Compute all embed texts up-front and batch-embed them
            # so large notes can take advantage of Gemini's batch tier
            # (Plan 3b). When the flag is off or the batch_submit callback
            # is absent (tests / scripts), embed_many() transparently
            # falls through to provider.embed per-item.
            embed_texts = [
                _build_embed_text(c) for c in extracted
            ]
            embed_vectors = await embed_many(
                self.provider,
                [EmbedInput(text=t) for t in embed_texts],
                workspace_id=ctx.workspace_id,
                batch_submit=self._batch_submit,
                flag_env=ENV_BATCH_ENABLED_COMPILER,
            )

            # 3b. Per-concept: embed (pre-computed), search, upsert, link, log.
            created = 0
            merged = 0
            linked = 0
            concept_ids: list[str] = []
            concept_id_by_name: dict[str, str] = {}
            created_concepts: list[dict[str, str]] = []
            existing_concepts: list[dict[str, str]] = []
            for candidate, embedding in zip(extracted, embed_vectors, strict=False):
                result = await self._process_concept(
                    candidate=candidate,
                    embedding=embedding,
                    input=validated,
                    ctx=ctx,
                    seq=seq,
                )
                async for ev in result.events:
                    yield ev
                if result.concept_id is None:
                    continue
                concept_ids.append(result.concept_id)
                concept_id_by_name[candidate["name"].strip().casefold()] = result.concept_id
                if result.was_created:
                    created += 1
                    created_concepts.append(
                        {
                            "name": candidate["name"].strip(),
                            "description": candidate.get("description", "").strip(),
                        }
                    )
                else:
                    merged += 1
                    existing_concepts.append(
                        {
                            "concept_id": result.concept_id,
                            "name": result.display_name or candidate["name"].strip(),
                            "description": candidate.get("description", "").strip(),
                        }
                    )
                if result.was_linked:
                    linked += 1

            ontology_edges_created = await self._create_ontology_relation_edges(
                input=validated,
                relations=extracted_relations,
                concept_id_by_name=concept_id_by_name,
            )
            if ontology_edges_created > 0:
                yield CustomEvent(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="custom",
                    label="compiler.ontology_edges_created",
                    payload={"count": ontology_edges_created},
                )

            wiki_page_actions_created = await self._create_wiki_page_actions(
                input=validated,
                ctx=ctx,
                source_title=title,
                concepts=[*created_concepts, *existing_concepts],
            )
            if wiki_page_actions_created > 0:
                yield CustomEvent(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="custom",
                    label="compiler.wiki_page_actions_created",
                    payload={"count": wiki_page_actions_created},
                )

            wiki_page_update_actions_created = await self._create_wiki_page_update_actions(
                input=validated,
                ctx=ctx,
                source_title=title,
                source_fingerprint=_source_note_fingerprint(note.payload),
                concepts=existing_concepts,
            )
            if wiki_page_update_actions_created > 0:
                yield CustomEvent(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="custom",
                    label="compiler.wiki_page_update_actions_created",
                    payload={"count": wiki_page_update_actions_created},
                )

            out = CompilerOutput(
                note_id=validated.note_id,
                extracted_count=len(extracted),
                created_count=created,
                merged_count=merged,
                linked_count=linked,
                concept_ids=concept_ids,
                wiki_page_actions_created=wiki_page_actions_created,
                wiki_page_update_actions_created=wiki_page_update_actions_created,
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
    ) -> tuple[
        list[dict[str, str]],
        list[dict[str, Any]],
        AsyncGenerator[AgentEvent, None],
    ]:
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
        tokens_in, tokens_out, cached_tokens = provider_usage(self.provider)

        events.append(
            ModelEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="model_end",
                model_id=self.provider.config.model or "unknown",
                prompt_tokens=tokens_in,
                completion_tokens=tokens_out,
                cached_tokens=cached_tokens,
                cost_krw=0,
                finish_reason="stop",
                latency_ms=latency_ms,
            )
        )

        concepts, relations = _parse_extraction(raw)
        return concepts, relations, _aiter(events)

    async def _process_concept(
        self,
        *,
        candidate: dict[str, str],
        embedding: list[float] | None,
        input: CompilerInput,
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> _ConceptProcessed:
        events: list[AgentEvent] = []
        name = candidate["name"].strip()
        description = candidate.get("description", "").strip()
        if not name:
            return _ConceptProcessed(
                concept_id=None,
                was_created=False,
                was_linked=False,
                display_name=None,
                events=_aiter([]),
            )

        # Embedding is pre-computed upstream (Plan 3b — either via batch
        # or the sync fallback). A None value means the embed failed for
        # just this candidate; match the previous "drop the concept on
        # embedding failure" semantics so Librarian can retry later.
        if embedding is None:
            logger.warning("Embedding missing for concept %s; skipping", name)
            return _ConceptProcessed(
                concept_id=None,
                was_created=False,
                was_linked=False,
                display_name=None,
                events=_aiter([]),
            )

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
            else (
                "Compiler linked note to existing concept "
                f"'{merge_target['name'] if merge_target else name}'"
            )
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
            display_name=merge_target["name"] if merge_target else name,
            events=_aiter(events),
        )

    async def _create_ontology_relation_edges(
        self,
        *,
        input: CompilerInput,
        relations: list[dict[str, Any]],
        concept_id_by_name: dict[str, str],
    ) -> int:
        seen: set[tuple[str, str, str]] = set()
        pending: list[tuple[str, str, str, float]] = []
        for relation in relations:
            source_name = str(relation.get("source") or "").strip().casefold()
            target_name = str(relation.get("target") or "").strip().casefold()
            predicate = str(relation.get("predicate") or "").strip()
            if predicate not in ONTOLOGY_RELATION_PREDICATES:
                continue
            source_id = concept_id_by_name.get(source_name)
            target_id = concept_id_by_name.get(target_name)
            if not source_id or not target_id or source_id == target_id:
                continue
            key = (source_id, predicate, target_id)
            if key in seen:
                continue
            seen.add(key)
            confidence = relation.get("confidence", 0.7)
            try:
                weight = float(confidence)
            except (TypeError, ValueError):
                weight = 0.7
            pending.append((source_id, predicate, target_id, max(0.1, min(1.0, weight))))
        if not pending:
            return 0

        semaphore = asyncio.Semaphore(ONTOLOGY_RELATION_EDGE_CONCURRENCY)

        async def _upsert_one(item: tuple[str, str, str, float]) -> bool:
            source_id, predicate, target_id, weight = item
            async with semaphore:
                _, edge_created = await self.api.upsert_edge(
                    source_id=source_id,
                    target_id=target_id,
                    relation_type=predicate,
                    weight=weight,
                    evidence_note_id=input.note_id,
                )
                return edge_created

        results = await asyncio.gather(*(_upsert_one(item) for item in pending))
        return sum(1 for created in results if created)

    async def _create_wiki_page_actions(
        self,
        *,
        input: CompilerInput,
        ctx: ToolContext,
        source_title: str,
        concepts: list[dict[str, str]],
    ) -> int:
        if not concepts:
            return 0
        try:
            index = await self.api.get_project_wiki_index(input.project_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Compiler: failed to fetch wiki index for page proposals: %s",
                exc,
            )
            return 0

        existing_titles = {
            str(page.get("title") or "").strip().casefold()
            for page in index.get("pages", [])
            if isinstance(page, dict)
        }
        created = 0
        seen_titles = set(existing_titles)
        for concept in concepts:
            name = concept.get("name", "").strip()
            if not name:
                continue
            normalized = name.casefold()
            if normalized in seen_titles:
                continue
            seen_titles.add(normalized)
            if len(seen_titles) - len(existing_titles) > MAX_COMPILER_WIKI_PAGE_ACTIONS:
                break

            description = concept.get("description", "").strip()
            request_id = str(
                uuid.uuid5(
                    WIKI_PAGE_REQUEST_NAMESPACE,
                    f"{input.project_id}:{input.note_id}:{name}",
                )
            )
            body_markdown = _build_wiki_page_stub(
                title=name,
                description=description,
                source_title=source_title,
            )
            try:
                result = await self.api.create_agent_action(
                    project_id=input.project_id,
                    user_id=input.user_id,
                    request={
                        "requestId": request_id,
                        "sourceRunId": ctx.run_id,
                        "kind": "note.create_from_markdown",
                        "risk": "write",
                        "approvalMode": "require",
                        "input": {
                            "title": name,
                            "folderId": None,
                            "bodyMarkdown": body_markdown,
                        },
                        "preview": {
                            "summary": "Create a concept wiki page from source ingest",
                            "sourceNoteId": input.note_id,
                            "sourceTitle": source_title,
                            "targetTitle": name,
                        },
                    },
                )
                if not result.get("idempotent"):
                    created += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Compiler: failed to create wiki page action for %s: %s",
                    name,
                    exc,
                )

        return created

    async def _create_wiki_page_update_actions(
        self,
        *,
        input: CompilerInput,
        ctx: ToolContext,
        source_title: str,
        source_fingerprint: str,
        concepts: list[dict[str, str]],
    ) -> int:
        if not concepts:
            return 0
        try:
            index = await self.api.get_project_wiki_index(input.project_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Compiler: failed to fetch wiki index for page update proposals: %s",
                exc,
            )
            return 0

        pages_by_title: dict[str, dict[str, Any]] = {}
        for page in index.get("pages", []):
            if not isinstance(page, dict):
                continue
            title = str(page.get("title") or "").strip()
            page_id = str(page.get("id") or "").strip()
            if title and page_id:
                pages_by_title.setdefault(title.casefold(), page)

        created = 0
        seen_page_ids: set[str] = set()
        for concept in concepts:
            name = concept.get("name", "").strip()
            if not name:
                continue
            page = pages_by_title.get(name.casefold())
            page_id = str(page.get("id") or "").strip() if page else ""
            if not page_id or page_id in seen_page_ids:
                continue
            seen_page_ids.add(page_id)
            if created >= MAX_COMPILER_WIKI_PAGE_ACTIONS:
                break

            try:
                draft_state = await self.api.get_note_draft_state(page_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Compiler: failed to fetch wiki page draft state for %s: %s",
                    name,
                    exc,
                )
                continue
            if not draft_state.get("hasYjsDocument"):
                continue
            current_content = draft_state.get("content")
            if not isinstance(current_content, list) or not current_content:
                continue

            description = concept.get("description", "").strip()
            draft_content = _append_compiler_source_evidence(
                current=current_content,
                concept_name=name,
                description=description,
                source_note_id=input.note_id,
                source_title=source_title,
            )
            request_id = str(
                uuid.uuid5(
                    WIKI_PAGE_UPDATE_REQUEST_NAMESPACE,
                    f"{input.project_id}:{input.note_id}:{page_id}:{source_fingerprint}",
                )
            )
            try:
                result = await self.api.create_agent_action(
                    project_id=input.project_id,
                    user_id=input.user_id,
                    request={
                        "requestId": request_id,
                        "sourceRunId": ctx.run_id,
                        "kind": "note.update",
                        "risk": "write",
                        "approvalMode": "require",
                        "input": {
                            "noteId": page_id,
                            "draft": {
                                "format": "plate_value_v1",
                                "content": draft_content,
                            },
                            "reason": (
                                f"Compiler linked {source_title} "
                                "as new source evidence."
                            ),
                        },
                    },
                )
                if not result.get("idempotent"):
                    created += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Compiler: failed to create wiki page update action for %s: %s",
                    name,
                    exc,
                )

        return created


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
    display_name: str | None
    events: AsyncGenerator[AgentEvent, None]


async def _aiter(items: list[AgentEvent]) -> AsyncGenerator[AgentEvent, None]:
    for ev in items:
        yield ev


def _build_embed_text(candidate: dict[str, str]) -> str:
    """Compose the dedupe signal used for kNN. Combining name + description
    disambiguates homonyms better than name alone (e.g. "배치 정규화" in a
    CS note vs. a statistics note). Empty descriptions fall back to name.
    """
    name = candidate["name"].strip()
    description = candidate.get("description", "").strip()
    return name if not description else f"{name} — {description}"


def _source_note_fingerprint(note: dict[str, Any]) -> str:
    payload = json.dumps(
        {
            "title": str(note.get("title") or ""),
            "contentText": str(note.get("contentText") or ""),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _build_wiki_page_stub(
    *,
    title: str,
    description: str,
    source_title: str,
) -> str:
    body = description or "Fill this page with grounded notes after review."
    return (
        f"# {title}\n\n"
        f"{body}\n\n"
        "## Source\n\n"
        f"Proposed by Compiler from source note **{source_title}**.\n\n"
        "Review the source note, expand this into a grounded wiki page, "
        "or reject the action."
    )


def _append_compiler_source_evidence(
    *,
    current: list[Any],
    concept_name: str,
    description: str,
    source_note_id: str,
    source_title: str,
) -> list[dict[str, Any]]:
    appended: list[dict[str, Any]] = [
        node.copy()
        if isinstance(node, dict)
        else {"type": "p", "children": [{"text": str(node)}]}
        for node in _without_compiler_source_evidence(
            current=current,
            source_note_id=source_note_id,
        )
    ]
    evidence_text = description or f"Compiler linked this page to {source_title}."
    appended.extend(
        [
            {"type": "h2", "children": [{"text": "Source evidence"}]},
            {"type": "p", "children": [{"text": evidence_text}]},
            {
                "type": "p",
                "children": [
                    {"text": "Source: "},
                    {
                        "type": "wiki-link",
                        "targetId": source_note_id,
                        "children": [{"text": source_title}],
                    },
                ],
            },
            {
                "type": "p",
                "children": [
                    {"text": f"Compiler matched this source to {concept_name}."}
                ],
            },
        ]
    )
    return appended


def _without_compiler_source_evidence(
    *,
    current: list[Any],
    source_note_id: str,
) -> list[Any]:
    kept: list[Any] = []
    index = 0
    while index < len(current):
        node = current[index]
        if _node_text(node).casefold() == "source evidence":
            block = current[index:index + 4]
            if _block_has_source_note_id(block, source_note_id):
                index += len(block)
                continue
        kept.append(node)
        index += 1
    return kept


def _block_has_source_note_id(block: list[Any], source_note_id: str) -> bool:
    return any(_node_has_wiki_link_target(node, source_note_id) for node in block)


def _node_has_wiki_link_target(node: Any, source_note_id: str) -> bool:
    if not isinstance(node, dict):
        return False
    if node.get("type") == "wiki-link" and node.get("targetId") == source_note_id:
        return True
    children = node.get("children")
    if not isinstance(children, list):
        return False
    return any(_node_has_wiki_link_target(child, source_note_id) for child in children)


def _node_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    if isinstance(node.get("text"), str):
        return str(node["text"])
    children = node.get("children")
    if not isinstance(children, list):
        return ""
    return "".join(_node_text(child) for child in children).strip()


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)


def _parse_extraction(raw: str) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    """Tolerant JSON parser. Some providers wrap output in a fenced block
    even when we ask for pure JSON (particularly Ollama); strip those here.
    On any parse failure, log and return an empty list — a bad extraction
    must not fail the workflow.
    """
    if not raw or not raw.strip():
        return [], []
    candidate = raw.strip()
    m = _JSON_BLOCK.search(candidate)
    if m:
        candidate = m.group(1).strip()
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError:
        logger.warning("Compiler: LLM extraction was not valid JSON; discarding")
        return [], []
    if not isinstance(payload, dict):
        return [], []
    concepts = payload.get("concepts")
    if not isinstance(concepts, list):
        return [], []
    out: list[dict[str, str]] = []
    for item in concepts:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        description = str(item.get("description", "")).strip()
        out.append({"name": name[:200], "description": description[:2000]})
    concept_names = {item["name"].casefold() for item in out}
    relations_payload = payload.get("relations")
    relations: list[dict[str, Any]] = []
    if isinstance(relations_payload, list):
        for item in relations_payload[:20]:
            if not isinstance(item, dict):
                continue
            source = str(item.get("source", "")).strip()
            target = str(item.get("target", "")).strip()
            predicate = str(item.get("predicate", "")).strip()
            if (
                not source
                or not target
                or source.casefold() not in concept_names
                or target.casefold() not in concept_names
                or predicate not in ONTOLOGY_RELATION_PREDICATES
            ):
                continue
            confidence = item.get("confidence", 0.7)
            relations.append(
                {
                    "source": source[:200],
                    "predicate": predicate,
                    "target": target[:200],
                    "confidence": confidence,
                }
            )
    return out, relations


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
    return isinstance(exc, (httpx.TimeoutException, httpx.NetworkError))
