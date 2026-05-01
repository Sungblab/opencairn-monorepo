"""LibrarianAgent — Plan 4 Phase B nightly maintenance agent.

Four phases, run sequentially against one project:

1. **detect_orphans** — pulls concepts that have no edges in either
   direction. Emitted as a CustomEvent with the count so downstream UIs can
   surface "X isolated concepts need linking".
2. **check_contradictions** — fetches near-neighbour concept pairs in the
   0.75-0.95 band and asks the LLM to flag genuine conflicts. We do NOT
   auto-resolve these; Librarian just surfaces them for human review.
3. **detect_duplicates + merge_duplicates** — pairs above 0.97 similarity
   are grouped with union-find, the primary concept summary is re-drafted
   by the LLM, and edges / note-links are atomically reparented via the
   ``/internal/concepts/merge`` endpoint.
4. **strengthen_links** — concept pairs that co-occur in ≥2 notes get a
   weighted "co-occurs" edge upserted.

Concurrency: Librarian does NOT acquire the per-project semaphore in v0.
The intended deployment runs it during overnight hours when ingest is
quiet; hardening this with a separate exclusive-mode lock is Plan 5
territory. The concept/edge reparent step in ``/concepts/merge`` is itself
atomic (single SQL transaction), so the worst case of a racing Compiler is
a missing edge — not corruption.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar

from llm import ENV_BATCH_ENABLED_LIBRARIAN, LLMProvider, embed_many
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
from worker.agents.librarian.prompts import (
    CONTRADICTION_SYSTEM,
    MERGE_SUMMARY_SYSTEM,
    build_contradiction_prompt,
    build_merge_summary_prompt,
)
from worker.lib.api_client import AgentApiClient

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


# Similarity bands — tuned on the plan's guidance + initial eval.
CONTRADICTION_MIN = 0.75
CONTRADICTION_MAX = 0.95
DUPLICATE_MIN = 0.97

# Caps: keep LLM spend bounded per nightly run. Large projects simply
# process more on subsequent nights; Librarian is always catching up.
MAX_CONTRADICTION_PAIRS = 30
MAX_DUPLICATE_PAIRS = 100
MAX_LINK_CANDIDATES = 200
LINK_STRENGTHEN_CONCURRENCY = 8


@dataclass(frozen=True)
class LibrarianInput:
    project_id: str
    workspace_id: str
    user_id: str


@dataclass
class LibrarianContradiction:
    concept_id_a: str
    concept_id_b: str
    reason: str


@dataclass
class LibrarianOutput:
    project_id: str
    orphan_count: int = 0
    contradictions: list[LibrarianContradiction] = field(default_factory=list)
    duplicates_merged: int = 0
    links_strengthened: int = 0


class LibrarianAgent(Agent):
    name: ClassVar[str] = "librarian"
    description: ClassVar[str] = (
        "Nightly knowledge-graph maintenance: detect orphans, flag "
        "contradictions, merge near-duplicates, strengthen co-occurrence edges."
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
        # Plan 3b — batch_submit is wired up but not fully exploited yet.
        # The merge loop embeds one summary per cluster; a future refactor
        # can lift those embeds out of the loop to realise the batch-tier
        # discount. Today's behaviour matches pre-3b: each call is 1 item,
        # below BATCH_EMBED_MIN_ITEMS → embed_many falls through to sync.
        self._batch_submit = batch_submit

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = LibrarianInput(
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

        output = LibrarianOutput(project_id=validated.project_id)

        try:
            # 1. Orphans.
            async for ev in self._detect_orphans(validated, ctx, seq, output):
                yield ev

            # 2. Contradictions — LLM per pair, bounded by MAX_CONTRADICTION_PAIRS.
            async for ev in self._check_contradictions(validated, ctx, seq, output):
                yield ev

            # 3. Duplicates + merge.
            async for ev in self._merge_duplicates(validated, ctx, seq, output):
                yield ev

            # 4. Strengthen co-occurrence links.
            async for ev in self._strengthen_links(validated, ctx, seq, output):
                yield ev

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
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "LibrarianAgent failed for project=%s", validated.project_id
            )
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

    # ------------------------------------------------------------------
    # Phase 1 — orphan detection
    # ------------------------------------------------------------------

    async def _detect_orphans(
        self,
        input: LibrarianInput,
        ctx: ToolContext,
        seq: _SeqCounter,
        output: LibrarianOutput,
    ) -> AsyncGenerator[AgentEvent, None]:
        call_id = f"call-{uuid.uuid4().hex[:8]}"
        args = {"project_id": input.project_id}
        yield ToolUse(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_use",
            tool_call_id=call_id,
            tool_name="list_orphan_concepts",
            input_args=args,
            input_hash=hash_input(args),
            concurrency_safe=True,
        )
        started = time.time()
        orphans = await self.api.list_orphan_concepts(input.project_id)
        yield ToolResult(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_result",
            tool_call_id=call_id,
            ok=True,
            output={"count": len(orphans)},
            duration_ms=int((time.time() - started) * 1000),
        )
        output.orphan_count = len(orphans)

        yield CustomEvent(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="custom",
            label="librarian.orphans_detected",
            payload={"count": len(orphans)},
        )

    # ------------------------------------------------------------------
    # Phase 2 — contradiction flagging (LLM per pair)
    # ------------------------------------------------------------------

    async def _check_contradictions(
        self,
        input: LibrarianInput,
        ctx: ToolContext,
        seq: _SeqCounter,
        output: LibrarianOutput,
    ) -> AsyncGenerator[AgentEvent, None]:
        call_id = f"call-{uuid.uuid4().hex[:8]}"
        args = {
            "project_id": input.project_id,
            "similarity_min": CONTRADICTION_MIN,
            "similarity_max": CONTRADICTION_MAX,
            "limit": MAX_CONTRADICTION_PAIRS,
        }
        yield ToolUse(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_use",
            tool_call_id=call_id,
            tool_name="list_concept_pairs",
            input_args=args,
            input_hash=hash_input(args),
            concurrency_safe=True,
        )
        started = time.time()
        pairs = await self.api.list_concept_pairs(
            project_id=input.project_id,
            similarity_min=CONTRADICTION_MIN,
            similarity_max=CONTRADICTION_MAX,
            limit=MAX_CONTRADICTION_PAIRS,
        )
        yield ToolResult(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_result",
            tool_call_id=call_id,
            ok=True,
            output={"pairs": len(pairs)},
            duration_ms=int((time.time() - started) * 1000),
        )

        for pair in pairs:
            verdict, events = await self._judge_contradiction(pair, ctx, seq)
            for ev in events:
                yield ev
            if verdict:
                output.contradictions.append(verdict)

        yield CustomEvent(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="custom",
            label="librarian.contradictions_flagged",
            payload={"count": len(output.contradictions)},
        )

    async def _judge_contradiction(
        self,
        pair: dict[str, Any],
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> tuple[LibrarianContradiction | None, list[AgentEvent]]:
        events: list[AgentEvent] = []
        started = time.time()
        messages = [
            {"role": "system", "content": CONTRADICTION_SYSTEM},
            {
                "role": "user",
                "content": build_contradiction_prompt(
                    name_a=str(pair.get("nameA", "")),
                    description_a=str(pair.get("descriptionA", "")),
                    name_b=str(pair.get("nameB", "")),
                    description_b=str(pair.get("descriptionB", "")),
                ),
            },
        ]
        try:
            raw = await self.provider.generate(
                messages,
                response_mime_type="application/json",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Librarian contradiction LLM call failed: %s", exc)
            return None, events
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

        verdict = _parse_contradiction(raw)
        if not verdict.get("is_contradiction"):
            return None, events
        return (
            LibrarianContradiction(
                concept_id_a=str(pair.get("idA", "")),
                concept_id_b=str(pair.get("idB", "")),
                reason=str(verdict.get("reason", ""))[:500],
            ),
            events,
        )

    # ------------------------------------------------------------------
    # Phase 3 — duplicate detection + merge
    # ------------------------------------------------------------------

    async def _merge_duplicates(
        self,
        input: LibrarianInput,
        ctx: ToolContext,
        seq: _SeqCounter,
        output: LibrarianOutput,
    ) -> AsyncGenerator[AgentEvent, None]:
        call_id = f"call-{uuid.uuid4().hex[:8]}"
        args = {
            "project_id": input.project_id,
            "similarity_min": DUPLICATE_MIN,
            "limit": MAX_DUPLICATE_PAIRS,
        }
        yield ToolUse(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_use",
            tool_call_id=call_id,
            tool_name="list_duplicate_pairs",
            input_args=args,
            input_hash=hash_input(args),
            concurrency_safe=True,
        )
        started = time.time()
        pairs = await self.api.list_concept_pairs(
            project_id=input.project_id,
            similarity_min=DUPLICATE_MIN,
            similarity_max=1.0,
            limit=MAX_DUPLICATE_PAIRS,
        )
        yield ToolResult(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_result",
            tool_call_id=call_id,
            ok=True,
            output={"pairs": len(pairs)},
            duration_ms=int((time.time() - started) * 1000),
        )

        clusters = _build_clusters(pairs)
        if not clusters:
            return

        details_by_id = _collect_concept_details(pairs)

        merged_total = 0
        for cluster in clusters:
            primary_id = cluster[0]
            duplicate_ids = cluster[1:]
            merged_summary, extra_events = await self._merge_summary(
                primary_id=primary_id,
                duplicate_ids=duplicate_ids,
                details=details_by_id,
                ctx=ctx,
                seq=seq,
            )
            for ev in extra_events:
                yield ev

            # Re-embed + update the primary concept in-place first. If the
            # summary didn't actually change (prompt failed, empty response)
            # we still proceed with the merge — the existing description
            # on the primary stays and the duplicates get collapsed into it.
            if merged_summary:
                try:
                    # TODO(Plan 3b Phase 2): lift this out of the loop so
                    # all clusters' merged-summary embeddings batch in one
                    # BatchEmbedWorkflow call. Today each call is 1 item,
                    # which falls through to provider.embed via embed_many.
                    vecs = await embed_many(
                        self.provider,
                        [EmbedInput(text=merged_summary)],
                        workspace_id=ctx.workspace_id,
                        batch_submit=self._batch_submit,
                        flag_env=ENV_BATCH_ENABLED_LIBRARIAN,
                    )
                    new_embedding = vecs[0]
                    if new_embedding is None:
                        raise RuntimeError("embedding returned None")
                    await self.api.upsert_concept(
                        project_id=input.project_id,
                        name=details_by_id[primary_id]["name"],
                        description=merged_summary,
                        embedding=new_embedding,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Librarian: failed to refresh primary %s: %s",
                        primary_id,
                        exc,
                    )

            # Merge the cluster atomically on the API side.
            merge_call_id = f"call-{uuid.uuid4().hex[:8]}"
            merge_args = {
                "primary_id": primary_id,
                "duplicate_ids": duplicate_ids,
            }
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=merge_call_id,
                tool_name="merge_concepts",
                input_args=merge_args,
                input_hash=hash_input(merge_args),
                concurrency_safe=False,
            )
            merge_started = time.time()
            merged_count = 0
            try:
                merged_count = await self.api.merge_concepts(
                    workspace_id=ctx.workspace_id,
                    primary_id=primary_id,
                    duplicate_ids=duplicate_ids,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Librarian: merge_concepts failed for cluster %s: %s",
                    cluster,
                    exc,
                )
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=merge_call_id,
                ok=merged_count > 0,
                output={"merged": merged_count},
                duration_ms=int((time.time() - merge_started) * 1000),
            )
            merged_total += merged_count

        output.duplicates_merged = merged_total

        yield CustomEvent(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="custom",
            label="librarian.duplicates_merged",
            payload={"count": merged_total},
        )

    async def _merge_summary(
        self,
        *,
        primary_id: str,
        duplicate_ids: list[str],
        details: dict[str, dict[str, Any]],
        ctx: ToolContext,
        seq: _SeqCounter,
    ) -> tuple[str, list[AgentEvent]]:
        events: list[AgentEvent] = []
        primary = details.get(primary_id)
        if not primary:
            return "", events
        summary = str(primary.get("description", ""))
        for dup_id in duplicate_ids:
            dup = details.get(dup_id)
            if not dup:
                continue
            started = time.time()
            messages = [
                {"role": "system", "content": MERGE_SUMMARY_SYSTEM},
                {
                    "role": "user",
                    "content": build_merge_summary_prompt(
                        primary_name=str(primary.get("name", "")),
                        primary_description=summary,
                        duplicate_name=str(dup.get("name", "")),
                        duplicate_description=str(dup.get("description", "")),
                    ),
                },
            ]
            try:
                raw = await self.provider.generate(messages)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Librarian merge summary LLM failed: %s", exc)
                continue
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
            if raw and raw.strip():
                summary = raw.strip()[:4000]
        return summary, events

    # ------------------------------------------------------------------
    # Phase 4 — strengthen co-occurrence edges
    # ------------------------------------------------------------------

    async def _strengthen_links(
        self,
        input: LibrarianInput,
        ctx: ToolContext,
        seq: _SeqCounter,
        output: LibrarianOutput,
    ) -> AsyncGenerator[AgentEvent, None]:
        call_id = f"call-{uuid.uuid4().hex[:8]}"
        args = {"project_id": input.project_id, "min_co_occurrence": 2}
        yield ToolUse(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_use",
            tool_call_id=call_id,
            tool_name="list_link_candidates",
            input_args=args,
            input_hash=hash_input(args),
            concurrency_safe=True,
        )
        started = time.time()
        candidates = await self.api.list_link_candidates(
            project_id=input.project_id,
            min_co_occurrence=2,
            limit=MAX_LINK_CANDIDATES,
        )
        yield ToolResult(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="tool_result",
            tool_call_id=call_id,
            ok=True,
            output={"candidates": len(candidates)},
            duration_ms=int((time.time() - started) * 1000),
        )

        strengthened = await self._strengthen_link_candidates(
            input=input,
            ctx=ctx,
            candidates=candidates,
        )
        output.links_strengthened = strengthened

        yield CustomEvent(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=time.time(),
            type="custom",
            label="librarian.links_strengthened",
            payload={"count": strengthened},
        )

    async def _strengthen_link_candidates(
        self,
        *,
        input: LibrarianInput,
        ctx: ToolContext,
        candidates: list[dict[str, Any]],
    ) -> int:
        semaphore = asyncio.Semaphore(LINK_STRENGTHEN_CONCURRENCY)

        async def _strengthen_one(row: dict[str, Any]) -> int:
            async with semaphore:
                return await self._strengthen_one_link_candidate(
                    input=input,
                    ctx=ctx,
                    row=row,
                )

        results = await asyncio.gather(
            *(_strengthen_one(row) for row in candidates),
        )
        return sum(results)

    async def _strengthen_one_link_candidate(
        self,
        *,
        input: LibrarianInput,
        ctx: ToolContext,
        row: dict[str, Any],
    ) -> int:
        cnt = int(row.get("coOccurrenceCount", 0))
        # 2 co-occurrences → 0.1; 10 → 0.5; 20+ → 1.0. The server-side
        # upsert takes max(existing, incoming) so edges only ever grow.
        weight = min(cnt * 0.05, 1.0)
        try:
            edge_id, _created = await self.api.upsert_edge(
                source_id=str(row["sourceId"]),
                target_id=str(row["targetId"]),
                relation_type="co-occurs",
                weight=weight,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Librarian: upsert_edge failed: %s", exc)
            return 0
        try:
            await self._record_strengthened_link_claim(
                input=input,
                ctx=ctx,
                row=row,
                edge_id=edge_id,
                support_score=weight,
            )
        except Exception as exc:  # noqa: BLE001 - evidence is best-effort
            logger.warning(
                "Librarian: strengthened link evidence skipped for %s -> %s: %s",
                row.get("sourceId"),
                row.get("targetId"),
                exc,
            )
        return 1

    async def _record_strengthened_link_claim(
        self,
        *,
        input: LibrarianInput,
        ctx: ToolContext,
        row: dict[str, Any],
        edge_id: str,
        support_score: float,
    ) -> None:
        source_id = str(row["sourceId"])
        target_id = str(row["targetId"])
        payload = await self.api.list_concept_pair_chunks(
            project_id=input.project_id,
            source_id=source_id,
            target_id=target_id,
            limit=3,
        )
        chunks = list(payload.get("chunks", []))
        if not chunks:
            return

        entries = _evidence_entries_from_pair_chunks(chunks)
        if not entries:
            return

        source = payload.get("source") or {}
        target = payload.get("target") or {}
        source_name = str(source.get("name") or source_id)
        target_name = str(target.get("name") or target_id)

        bundle = await self.api.create_evidence_bundle(
            workspace_id=input.workspace_id,
            project_id=input.project_id,
            purpose="kg_edge",
            producer={
                "kind": "worker",
                "runId": ctx.run_id,
                "tool": "librarian.strengthen_links",
            },
            created_by=input.user_id,
            entries=entries,
        )
        bundle_id = str(bundle["id"])
        first = entries[0]
        await self.api.create_knowledge_claim(
            workspace_id=input.workspace_id,
            project_id=input.project_id,
            claim_text=(
                f"{source_name} co-occurs with {target_name} "
                f"across {int(row.get('coOccurrenceCount', 0))} shared notes."
            )[:4000],
            claim_type="relation",
            status="active",
            confidence=max(0.5, min(support_score, 1.0)),
            evidence_bundle_id=bundle_id,
            produced_by="wiki_maintenance",
            produced_by_run_id=ctx.run_id,
            subject_concept_id=source_id,
            object_concept_id=target_id,
            edge_evidence=[
                {
                    "conceptEdgeId": edge_id,
                    "noteChunkId": first["noteChunkId"],
                    "supportScore": max(0.5, min(support_score, 1.0)),
                    "stance": "mentions",
                    "quote": first["quote"],
                }
            ],
        )


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


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)


def _parse_contradiction(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    text = raw.strip()
    m = _JSON_BLOCK.search(text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {}


def _build_clusters(pairs: list[dict[str, Any]]) -> list[list[str]]:
    """Union-find over (idA, idB) edges → return one list per connected
    component, with the lexicographically-smallest id as the "primary"
    (index 0). Stable ordering makes merge idempotent when a run is retried
    mid-way.
    """
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        if parent.setdefault(x, x) != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(x: str, y: str) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            # Make the smaller id the root so "primary" is deterministic.
            root, other = sorted([rx, ry])
            parent[other] = root

    for p in pairs:
        a = str(p.get("idA", ""))
        b = str(p.get("idB", ""))
        if a and b:
            union(a, b)

    groups: dict[str, list[str]] = {}
    for node in parent:
        root = find(node)
        groups.setdefault(root, []).append(node)

    clusters: list[list[str]] = []
    for members in groups.values():
        if len(members) < 2:
            continue
        members_sorted = sorted(members)
        clusters.append(members_sorted)
    return clusters


def _collect_concept_details(
    pairs: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Index concept metadata carried on the pair rows. Each pair names two
    concepts; we deduplicate by id so merge_summary can look up each side.
    """
    out: dict[str, dict[str, Any]] = {}
    for p in pairs:
        for suffix in ("A", "B"):
            cid = str(p.get(f"id{suffix}", ""))
            if not cid or cid in out:
                continue
            out[cid] = {
                "name": str(p.get(f"name{suffix}", "")),
                "description": str(p.get(f"description{suffix}", "")),
            }
    return out


def _evidence_entries_from_pair_chunks(
    chunks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for rank, chunk in enumerate(chunks, start=1):
        quote = str(chunk.get("quote") or "")[:1200]
        if not quote:
            continue
        entries.append(
            {
                "noteChunkId": str(chunk["id"]),
                "noteId": str(chunk["noteId"]),
                "noteType": str(chunk.get("noteType") or "source"),
                "sourceType": chunk.get("sourceType"),
                "headingPath": str(chunk.get("headingPath") or ""),
                "sourceOffsets": chunk.get("sourceOffsets") or {
                    "start": 0,
                    "end": len(quote),
                },
                "score": 1.0,
                "rank": rank,
                "retrievalChannel": "graph",
                "quote": quote,
                "citation": {
                    "label": f"S{rank}",
                    "title": str(chunk.get("noteTitle") or "Source"),
                    "locator": str(chunk.get("headingPath") or f"chunk {rank}"),
                },
                "metadata": {"producer": "librarian"},
            }
        )
    return entries


def _output_to_dict(out: LibrarianOutput) -> dict[str, Any]:
    return {
        "project_id": out.project_id,
        "orphan_count": out.orphan_count,
        "contradictions": [
            {
                "concept_id_a": c.concept_id_a,
                "concept_id_b": c.concept_id_b,
                "reason": c.reason,
            }
            for c in out.contradictions
        ],
        "duplicates_merged": out.duplicates_merged,
        "links_strengthened": out.links_strengthened,
    }


def _is_retryable(exc: Exception) -> bool:
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    return isinstance(exc, (httpx.TimeoutException, httpx.NetworkError))
