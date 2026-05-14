"""CuratorAgent — knowledge-base quality scanner.

Runs four detection passes on a project's knowledge graph:
1. **Orphan concepts** — concepts with degree 0 (no edges).
2. **Duplicate concepts** — concept pairs with cosine similarity >= 0.9.
3. **Ontology quality** — weak predicates, hierarchy cycles, and promotion candidates.
4. **Contradiction detection** — topic concept pairs checked via LLM.

Each finding is persisted to the ``suggestions`` table via the internal API.
Follows the runtime.Agent contract (Plan 12) so all events are observed by
trajectory writer + token counter hooks.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
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
from worker.agents.curator.prompts import (
    CONTRADICTION_SYSTEM,
    build_contradiction_prompt,
)
from worker.lib.api_client import AgentApiClient, post_internal

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from llm import LLMProvider

logger = logging.getLogger(__name__)

# Minimum contradiction confidence threshold to create a suggestion.
_CONTRADICTION_THRESHOLD = 0.7


@dataclass(frozen=True)
class CuratorInput:
    """Validated input to :class:`CuratorAgent`."""

    project_id: str
    workspace_id: str
    user_id: str
    max_orphans: int = 50
    max_duplicate_pairs: int = 20
    max_contradiction_pairs: int = 5


class CuratorAgent(Agent):
    """Knowledge-base quality scanner.

    Constructed with a live ``LLMProvider`` (Gemini or Ollama) and an
    ``AgentApiClient``. Both are injected so tests can substitute fakes.
    """

    name: ClassVar[str] = "curator"
    description: ClassVar[str] = (
        "Detects orphan, duplicate, and contradicting concepts in a "
        "project's knowledge base."
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
        validated = CuratorInput(
            project_id=input["project_id"],
            workspace_id=input["workspace_id"],
            user_id=input["user_id"],
            max_orphans=int(input.get("max_orphans", 50)),
            max_duplicate_pairs=int(input.get("max_duplicate_pairs", 20)),
            max_contradiction_pairs=int(input.get("max_contradiction_pairs", 5)),
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
            orphans_found = 0
            duplicates_found = 0
            contradictions_found = 0
            ontology_issues_found = 0
            suggestions_created = 0

            # ------------------------------------------------------------------
            # Step 1 — Orphan concept detection
            # ------------------------------------------------------------------
            orphan_call_id = f"call-{uuid.uuid4().hex[:8]}"
            orphan_args = {"project_id": validated.project_id}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=orphan_call_id,
                tool_name="list_orphan_concepts",
                input_args=orphan_args,
                input_hash=hash_input(orphan_args),
                concurrency_safe=True,
            )
            orphan_start = time.time()
            orphans = await self.api.list_orphan_concepts(validated.project_id)
            orphans = orphans[: validated.max_orphans]
            orphans_found = len(orphans)

            await asyncio.gather(*[
                post_internal(
                    "/api/internal/suggestions",
                    {
                        "userId": validated.user_id,
                        "workspaceId": validated.workspace_id,
                        "projectId": validated.project_id,
                        "type": "curator_orphan",
                        "payload": {
                            "conceptId": concept.get("id"),
                            "name": concept.get("name", ""),
                        },
                    },
                )
                for concept in orphans
            ])
            suggestions_created += orphans_found

            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=orphan_call_id,
                ok=True,
                output={"orphans_found": orphans_found, "suggestions_created": orphans_found},
                duration_ms=int((time.time() - orphan_start) * 1000),
            )

            # ------------------------------------------------------------------
            # Step 2 — Duplicate concept detection (similarity >= 0.9)
            # ------------------------------------------------------------------
            dup_call_id = f"call-{uuid.uuid4().hex[:8]}"
            dup_args = {"project_id": validated.project_id, "similarity_min": 0.9}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=dup_call_id,
                tool_name="list_concept_pairs",
                input_args=dup_args,
                input_hash=hash_input(dup_args),
                concurrency_safe=True,
            )
            dup_start = time.time()
            pairs = await self.api.list_concept_pairs(
                project_id=validated.project_id,
                similarity_min=0.9,
                limit=validated.max_duplicate_pairs,
            )
            duplicates_found = len(pairs)

            await asyncio.gather(*[
                post_internal(
                    "/api/internal/suggestions",
                    {
                        "userId": validated.user_id,
                        "workspaceId": validated.workspace_id,
                        "projectId": validated.project_id,
                        "type": "curator_duplicate",
                        "payload": {
                            "conceptAId": pair.get("idA"),
                            "conceptBId": pair.get("idB"),
                            "similarity": pair.get("similarity"),
                            "nameA": pair.get("nameA", ""),
                            "nameB": pair.get("nameB", ""),
                        },
                    },
                )
                for pair in pairs
            ])
            suggestions_created += duplicates_found

            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=dup_call_id,
                ok=True,
                output={
                    "duplicates_found": duplicates_found,
                    "suggestions_created": duplicates_found,
                },
                duration_ms=int((time.time() - dup_start) * 1000),
            )

            # ------------------------------------------------------------------
            # Step 3 — Ontology quality review
            # ------------------------------------------------------------------
            ontology_call_id = f"call-{uuid.uuid4().hex[:8]}"
            ontology_args = {"project_id": validated.project_id}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=ontology_call_id,
                tool_name="list_ontology_issues",
                input_args=ontology_args,
                input_hash=hash_input(ontology_args),
                concurrency_safe=True,
            )
            ontology_start = time.time()
            ontology_issues = await self.api.list_ontology_issues(validated.project_id)
            ontology_suggestions = _ontology_suggestions(
                ontology_issues,
                user_id=validated.user_id,
                workspace_id=validated.workspace_id,
                project_id=validated.project_id,
            )
            ontology_issues_found = len(ontology_suggestions)
            await asyncio.gather(*[
                post_internal("/api/internal/suggestions", suggestion)
                for suggestion in ontology_suggestions
            ])
            suggestions_created += ontology_issues_found

            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=ontology_call_id,
                ok=True,
                output={
                    "ontology_issues_found": ontology_issues_found,
                    "broad_relations": len(ontology_issues.get("broadRelations", [])),
                    "hierarchy_cycles": len(ontology_issues.get("hierarchyCycles", [])),
                    "promotion_candidates": len(ontology_issues.get("promotionCandidates", [])),
                    "suggestions_created": ontology_issues_found,
                },
                duration_ms=int((time.time() - ontology_start) * 1000),
            )

            # ------------------------------------------------------------------
            # Step 4 — Contradiction detection via LLM
            # ------------------------------------------------------------------
            contra_call_id = f"call-{uuid.uuid4().hex[:8]}"
            contra_args = {
                "project_id": validated.project_id,
                "max_pairs": validated.max_contradiction_pairs,
            }
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=contra_call_id,
                tool_name="list_project_topics",
                input_args=contra_args,
                input_hash=hash_input(contra_args),
                concurrency_safe=True,
            )
            contra_fetch_start = time.time()
            topics = await self.api.list_project_topics(project_id=validated.project_id)

            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=contra_call_id,
                ok=True,
                output={"topics_fetched": len(topics)},
                duration_ms=int((time.time() - contra_fetch_start) * 1000),
            )

            # Build candidate pairs from the first N topics (avoid O(n^2) explosion).
            candidate_pairs = _build_candidate_pairs(
                topics, max_pairs=validated.max_contradiction_pairs
            )

            for pair_a, pair_b in candidate_pairs:
                llm_call_id = f"call-{uuid.uuid4().hex[:8]}"
                llm_args = {
                    "name_a": pair_a.get("name", ""),
                    "name_b": pair_b.get("name", ""),
                }
                yield ToolUse(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_use",
                    tool_call_id=llm_call_id,
                    tool_name="check_contradiction",
                    input_args=llm_args,
                    input_hash=hash_input(llm_args),
                    concurrency_safe=True,
                )

                messages = [
                    {"role": "system", "content": CONTRADICTION_SYSTEM},
                    {
                        "role": "user",
                        "content": build_contradiction_prompt(
                            name_a=pair_a.get("name", ""),
                            desc_a=pair_a.get("description", ""),
                            name_b=pair_b.get("name", ""),
                            desc_b=pair_b.get("description", ""),
                        ),
                    },
                ]

                llm_started = time.time()
                raw_response: str = await self.provider.generate(messages)
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

                result = _parse_contradiction_response(raw_response)
                contradicts = result.get("contradicts", False)
                confidence = float(result.get("confidence", 0.0))
                reason = result.get("reason", "")

                is_contradiction = contradicts and confidence >= _CONTRADICTION_THRESHOLD
                yield ToolResult(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_result",
                    tool_call_id=llm_call_id,
                    ok=True,
                    output={
                        "contradicts": contradicts,
                        "confidence": confidence,
                        "flagged": is_contradiction,
                    },
                    duration_ms=latency_ms,
                )

                if is_contradiction:
                    await post_internal(
                        "/api/internal/suggestions",
                        {
                            "userId": validated.user_id,
                            "workspaceId": validated.workspace_id,
                            "projectId": validated.project_id,
                            "type": "curator_contradiction",
                            "payload": {
                                "conceptAId": pair_a.get("id"),
                                "conceptBId": pair_b.get("id"),
                                "nameA": pair_a.get("name", ""),
                                "nameB": pair_b.get("name", ""),
                                "confidence": confidence,
                                "reason": reason,
                            },
                        },
                    )
                    contradictions_found += 1
                    suggestions_created += 1

            # ------------------------------------------------------------------
            # Summary custom event + AgentEnd
            # ------------------------------------------------------------------
            output = {
                "orphans_found": orphans_found,
                "duplicates_found": duplicates_found,
                "ontology_issues_found": ontology_issues_found,
                "contradictions_found": contradictions_found,
                "suggestions_created": suggestions_created,
            }

            yield CustomEvent(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="custom",
                label="curator.completed",
                payload=output,
            )

            yield AgentEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_end",
                output=output,
                duration_ms=int((time.time() - t0) * 1000),
            )

        except Exception as exc:  # noqa: BLE001
            logger.exception("CuratorAgent failed")
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
# Module-private helpers
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


_JSON_FENCE_RE = re.compile(r"```(?:\w+)?\n?(.*?)```", re.DOTALL)


def _parse_contradiction_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON response, returning defaults on parse failure."""
    try:
        text = raw.strip()
        m = _JSON_FENCE_RE.search(text)
        if m:
            text = m.group(1).strip()
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        logger.warning("CuratorAgent: failed to parse contradiction response: %r", raw[:200])
        return {"contradicts": False, "confidence": 0.0, "reason": "parse_error"}


def _build_candidate_pairs(
    topics: list[dict[str, Any]],
    max_pairs: int,
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Build up to ``max_pairs`` sliding-window adjacent pairs from topics.

    Sliding window (i, i+1) instead of disjoint (0,1), (2,3)... so that we
    catch contradictions between any two neighbouring concepts, not just even-
    indexed pairs. The topics list is sorted by relevance (note-link count
    descending) from the API, so the most prominent concepts are checked first.
    """
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for i in range(len(topics) - 1):
        if len(pairs) >= max_pairs:
            break
        a = topics[i]
        b = topics[i + 1]
        if a.get("description") and b.get("description"):
            pairs.append((a, b))
    return pairs


def _ontology_suggestions(
    issues: dict[str, Any],
    *,
    user_id: str,
    workspace_id: str,
    project_id: str,
) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []

    for row in list(issues.get("broadRelations") or [])[:25]:
        if not isinstance(row, dict):
            continue
        issue_kind = str(row.get("issue_kind") or "broad_relation")
        is_unknown_predicate = issue_kind == "unknown_predicate"
        suggestions.append(
            {
                "userId": user_id,
                "workspaceId": workspace_id,
                "projectId": project_id,
                "type": (
                    "curator_ontology_violation"
                    if is_unknown_predicate
                    else "curator_relation_refinement"
                ),
                "payload": {
                    "kind": issue_kind,
                    "edgeId": row.get("edge_id"),
                    "relationType": row.get("relation_type"),
                    "sourceId": row.get("source_id"),
                    "targetId": row.get("target_id"),
                    "sourceName": row.get("source_name", ""),
                    "targetName": row.get("target_name", ""),
                    "weight": row.get("weight"),
                    **(
                        {"proposedRelationType": "related-to"}
                        if is_unknown_predicate
                        else {}
                    ),
                    "recommendation": (
                        "Map this unknown relation type to a controlled ontology "
                        "predicate before it is used for reasoning."
                        if is_unknown_predicate
                        else (
                            "Replace generic relation with a controlled ontology "
                            "predicate such as is_a, depends_on, part_of, causes, "
                            "or same_as_candidate."
                        )
                    ),
                },
            }
        )

    for row in list(issues.get("promotionCandidates") or [])[:25]:
        if not isinstance(row, dict):
            continue
        proposed_relation = _promotion_relation_candidate(row)
        suggestions.append(
            {
                "userId": user_id,
                "workspaceId": workspace_id,
                "projectId": project_id,
                "type": "curator_relation_refinement",
                "payload": {
                    "kind": "promote_display_relation",
                    "edgeId": row.get("edge_id"),
                    "relationType": row.get("relation_type"),
                    "sourceId": row.get("source_id"),
                    "targetId": row.get("target_id"),
                    "sourceName": row.get("source_name", ""),
                    "targetName": row.get("target_name", ""),
                    "weight": row.get("weight"),
                    **(
                        {"proposedRelationType": proposed_relation}
                        if proposed_relation
                        else {}
                    ),
                    "recommendation": (
                        "High-weight display relation should be reviewed for "
                        "promotion into a semantic ontology predicate."
                    ),
                },
            }
        )

    for row in list(issues.get("hierarchyCycles") or [])[:25]:
        if not isinstance(row, dict):
            continue
        suggestions.append(
            {
                "userId": user_id,
                "workspaceId": workspace_id,
                "projectId": project_id,
                "type": "curator_hierarchy_cycle",
                "payload": {
                    "kind": "is_a_cycle",
                    "edgeId": row.get("edge_id"),
                    "reverseEdgeId": row.get("reverse_edge_id"),
                    "sourceId": row.get("source_id"),
                    "targetId": row.get("target_id"),
                    "sourceName": row.get("source_name", ""),
                    "targetName": row.get("target_name", ""),
                    "recommendation": (
                        "Break the reciprocal is_a relation or convert one "
                        "side into same_as_candidate if the concepts are duplicates."
                    ),
                },
            }
        )

    return suggestions


def _promotion_relation_candidate(row: dict[str, Any]) -> str | None:
    source = _relation_name_key(row.get("source_name"))
    target = _relation_name_key(row.get("target_name"))
    if not source or not target:
        return None
    source_tokens = set(source.split())
    target_tokens = set(target.split())
    if not source_tokens or not target_tokens:
        return None
    overlap = len(source_tokens & target_tokens) / max(
        len(source_tokens),
        len(target_tokens),
    )
    if source in target or target in source or overlap >= 0.6:
        return "same_as_candidate"
    return None


def _relation_name_key(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^a-z0-9가-힣]+", " ", value.lower()).strip()
