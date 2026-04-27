"""ConnectorAgent — cross-project similarity connector.

Finds concepts in OTHER projects within the same workspace that are
similar (by embedding cosine similarity) to a given concept, then
persists ``connector_link`` suggestions to the suggestions table so the
user can review and act on them.

Steps:
1. Fetch the source concept (including its embedding) from the internal API.
2. Search for similar concepts across all workspace projects, excluding
   the source concept's own project.
3. Filter candidates by the configured similarity threshold.
4. Persist each passing candidate as a ``connector_link`` suggestion.
"""
from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, ClassVar

from llm import LLMProvider

from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    CustomEvent,
    ToolResult,
    ToolUse,
)
from runtime.tools import ToolContext, hash_input

from worker.lib.api_client import AgentApiClient, get_internal, post_internal

logger = logging.getLogger(__name__)


class _SeqCounter:
    __slots__ = ("_value",)

    def __init__(self) -> None:
        self._value = -1

    def next(self) -> int:
        self._value += 1
        return self._value


@dataclass(frozen=True)
class ConnectorInput:
    """Validated input to :class:`ConnectorAgent`."""

    user_id: str
    workspace_id: str
    concept_id: str
    project_id: str
    threshold: float = 0.75
    top_k: int = 10


@dataclass
class ConnectorOutput:
    """Output produced by :class:`ConnectorAgent`."""

    concept_id: str
    suggestion_ids: list[str] = field(default_factory=list)
    candidates_found: int = 0


class ConnectorAgent(Agent):
    """Cross-project similarity connector.

    Finds concepts in other projects within the same workspace that are
    semantically similar to the supplied concept, and creates
    ``connector_link`` suggestions for the user to review.
    """

    name: ClassVar[str] = "connector"
    description: ClassVar[str] = (
        "Finds cross-project similar concepts and creates connector_link suggestions."
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
        t0 = time.time()
        seq = _SeqCounter()

        validated = ConnectorInput(
            user_id=input["user_id"],
            workspace_id=input["workspace_id"],
            concept_id=input["concept_id"],
            project_id=input["project_id"],
            threshold=float(input.get("threshold", 0.75)),
            top_k=int(input.get("top_k", 10)),
        )

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
            suggestion_ids: list[str] = []

            # ------------------------------------------------------------------
            # Step 1 — Fetch the source concept's embedding
            # ------------------------------------------------------------------
            fetch_call_id = f"call-{uuid.uuid4().hex[:8]}"
            fetch_args = {"concept_id": validated.concept_id}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=fetch_call_id,
                tool_name="fetch_concept",
                input_args=fetch_args,
                input_hash=hash_input(fetch_args),
                concurrency_safe=True,
            )
            t_fetch = time.time()
            concept = await get_internal(
                f"/api/internal/concepts/{validated.concept_id}"
            )
            embedding: list[float] = concept.get("embedding") or []
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=fetch_call_id,
                ok=bool(embedding),
                output={"dim": len(embedding)},
                duration_ms=int((time.time() - t_fetch) * 1000),
            )

            if not embedding:
                logger.warning(
                    "ConnectorAgent: concept %s has no embedding — skipping",
                    validated.concept_id,
                )
                yield AgentEnd(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="agent_end",
                    output={
                        "concept_id": validated.concept_id,
                        "suggestion_ids": [],
                        "candidates_found": 0,
                    },
                    duration_ms=int((time.time() - t0) * 1000),
                )
                return

            # ------------------------------------------------------------------
            # Step 2 — Cross-project similarity search
            # ------------------------------------------------------------------
            search_call_id = f"call-{uuid.uuid4().hex[:8]}"
            search_args = {"k": validated.top_k, "threshold": validated.threshold}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=search_call_id,
                tool_name="cross_project_search",
                input_args=search_args,
                input_hash=hash_input(search_args),
                concurrency_safe=True,
            )
            t_search = time.time()
            candidates_raw = await _cross_project_search(
                workspace_id=validated.workspace_id,
                embedding=embedding,
                k=validated.top_k,
                exclude_project_id=validated.project_id,
            )
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=search_call_id,
                ok=True,
                output={"candidates": len(candidates_raw)},
                duration_ms=int((time.time() - t_search) * 1000),
            )

            # ------------------------------------------------------------------
            # Step 3 — Filter by threshold and persist suggestions
            # ------------------------------------------------------------------
            above_threshold = [
                c
                for c in candidates_raw
                if float(c.get("similarity", 0)) >= validated.threshold
            ]

            persist_call_id = f"call-{uuid.uuid4().hex[:8]}"
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=persist_call_id,
                tool_name="persist_suggestions",
                input_args={"count": len(above_threshold)},
                input_hash=hash_input({"count": len(above_threshold)}),
                concurrency_safe=False,
            )
            t_persist = time.time()

            for candidate in above_threshold:
                result = await post_internal(
                    "/api/internal/suggestions",
                    {
                        "userId": validated.user_id,
                        "workspaceId": validated.workspace_id,
                        "projectId": validated.project_id,
                        "type": "connector_link",
                        "payload": {
                            "sourceConceptId": validated.concept_id,
                            "targetConceptId": candidate["id"],
                            "targetProjectId": candidate.get("project_id", ""),
                            "similarity": float(candidate.get("similarity", 0.0)),
                            "targetName": candidate.get("name", ""),
                        },
                    },
                )
                suggestion_ids.append(result["id"])

            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=persist_call_id,
                ok=True,
                output={"created": len(suggestion_ids)},
                duration_ms=int((time.time() - t_persist) * 1000),
            )

            # ------------------------------------------------------------------
            # Summary custom event + AgentEnd
            # ------------------------------------------------------------------
            output = {
                "concept_id": validated.concept_id,
                "suggestion_ids": suggestion_ids,
                "candidates_found": len(candidates_raw),
            }

            yield CustomEvent(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="custom",
                label="connector.completed",
                payload={
                    "suggestions": len(suggestion_ids),
                    "candidates": len(candidates_raw),
                },
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
            logger.exception(
                "ConnectorAgent failed for concept=%s", validated.concept_id
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


# ---------------------------------------------------------------------------
# Module-private helpers
# ---------------------------------------------------------------------------


async def _cross_project_search(
    workspace_id: str,
    embedding: list[float],
    k: int,
    exclude_project_id: str,
) -> list[dict[str, Any]]:
    """Search for similar concepts across all projects in the workspace,
    excluding the source project.

    Uses ``POST /api/internal/workspace-concepts/search``.
    Returns a list of ``{ id, name, project_id, similarity }`` dicts.
    On any transport error, returns an empty list so the caller can
    still yield a clean AgentEnd rather than raising.
    """
    try:
        res = await post_internal(
            "/api/internal/workspace-concepts/search",
            {
                "workspaceId": workspace_id,
                "embedding": embedding,
                "k": k,
                "excludeProjectId": exclude_project_id,
            },
        )
        return list(res.get("results", []))
    except Exception:  # noqa: BLE001
        logger.warning(
            "ConnectorAgent._cross_project_search: request failed, returning empty",
            exc_info=True,
        )
        return []


def _is_retryable(exc: Exception) -> bool:
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    return False
