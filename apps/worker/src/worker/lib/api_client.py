"""Internal API client — worker → Hono callback helper.

The worker closes the ingest loop by POSTing extracted text back to the Hono
API (see ``apps/api/src/routes/internal.ts``), which persists the source note
under the caller's project. Plan 4 extends the same client with ``get`` and a
typed wrapper class for the concept / wiki-log endpoints used by the
Compiler, Research, and Librarian agents.

Authentication is a shared secret (``INTERNAL_API_SECRET``) carried in the
``X-Internal-Secret`` header; this header must never leave the internal
docker network.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

API_BASE = os.environ.get("INTERNAL_API_URL", "http://api:4000")
INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET", "change-me-in-production")

_HEADERS = {"X-Internal-Secret": INTERNAL_SECRET}
_TIMEOUT = 30.0


async def post_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """POST ``body`` as JSON to ``{API_BASE}{path}`` with the internal secret.

    Raises for non-2xx. Returns the decoded JSON body on success. 30s timeout
    matches the longest source-note insert we expect (large text + embedding
    trigger queueing).
    """
    async with httpx.AsyncClient(base_url=API_BASE, timeout=_TIMEOUT) as client:
        response = await client.post(path, json=body, headers=_HEADERS)
        response.raise_for_status()
        return response.json()


async def get_internal(path: str) -> dict[str, Any]:
    """GET ``{API_BASE}{path}`` with the internal secret. Same error contract as post."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=_TIMEOUT) as client:
        response = await client.get(path, headers=_HEADERS)
        response.raise_for_status()
        return response.json()


async def patch_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """PATCH ``{API_BASE}{path}`` with the internal secret."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=_TIMEOUT) as client:
        response = await client.patch(path, json=body, headers=_HEADERS)
        response.raise_for_status()
        return response.json()


class AgentApiClient:
    """Typed facade over the Plan 4 internal endpoints.

    Each method is a single HTTP round-trip to ``apps/api``. We deliberately
    do not open a shared ``httpx.AsyncClient`` — Temporal activities are
    short-lived and a per-call client keeps the lifecycle simple (no tear-down
    hook to forget). If this becomes hot, pool via ``httpx.AsyncClient`` as a
    module-level singleton behind a lock.
    """

    async def get_note(self, note_id: str) -> dict[str, Any]:
        """Fetch ``{id, projectId, workspaceId, title, contentText, sourceType, sourceUrl, type}``.

        Raises ``httpx.HTTPStatusError`` on 404 — callers should treat a
        missing note as a hard failure (the compiler was triggered for a
        note that was since deleted).
        """
        return await get_internal(f"/api/internal/notes/{note_id}")

    async def search_concepts(
        self,
        *,
        project_id: str,
        embedding: list[float],
        k: int = 10,
        name_ilike: str | None = None,
    ) -> list[dict[str, Any]]:
        """Vector kNN over concepts in a project. Results are sorted by
        descending similarity; similarity is in ``[0, 1]`` (higher = closer).
        """
        body: dict[str, Any] = {
            "projectId": project_id,
            "embedding": embedding,
            "k": k,
        }
        if name_ilike:
            body["nameIlike"] = name_ilike
        res = await post_internal("/api/internal/concepts/search", body)
        return list(res.get("results", []))

    async def upsert_concept(
        self,
        *,
        project_id: str,
        name: str,
        description: str,
        embedding: list[float],
    ) -> tuple[str, bool]:
        """Idempotent concept upsert.

        Returns ``(concept_id, created)``. ``created=False`` means a concept
        with the same ``(project_id, name)`` already existed.
        """
        res = await post_internal(
            "/api/internal/concepts/upsert",
            {
                "projectId": project_id,
                "name": name,
                "description": description,
                "embedding": embedding,
            },
        )
        return res["id"], bool(res.get("created", False))

    async def upsert_edge(
        self,
        *,
        source_id: str,
        target_id: str,
        relation_type: str = "related-to",
        weight: float = 1.0,
        evidence_note_id: str | None = None,
    ) -> tuple[str, bool]:
        """Upsert a concept edge. See API docs for merge semantics."""
        res = await post_internal(
            "/api/internal/concept-edges",
            {
                "sourceId": source_id,
                "targetId": target_id,
                "relationType": relation_type,
                "weight": weight,
                "evidenceNoteId": evidence_note_id,
            },
        )
        return res["id"], bool(res.get("created", False))

    async def link_concept_note(self, *, concept_id: str, note_id: str) -> None:
        """Link a concept to a note. Duplicate links are silently ignored."""
        await post_internal(
            "/api/internal/concept-notes",
            {"conceptId": concept_id, "noteId": note_id},
        )

    async def log_wiki(
        self,
        *,
        note_id: str,
        agent: str,
        action: str,
        diff: dict[str, Any] | None = None,
        reason: str | None = None,
    ) -> str:
        """Append an audit row; returns the log id. ``action`` must be one of
        ``create|update|merge|link|unlink`` — the API rejects others with 400.
        """
        res = await post_internal(
            "/api/internal/wiki-logs",
            {
                "noteId": note_id,
                "agent": agent,
                "action": action,
                "diff": diff,
                "reason": reason,
            },
        )
        return res["id"]

    # -- Plan 4 Phase B -----------------------------------------------------

    async def hybrid_search_notes(
        self,
        *,
        project_id: str,
        query_text: str,
        query_embedding: list[float],
        k: int = 10,
    ) -> list[dict[str, Any]]:
        """RRF-fused pgvector + BM25 search over the project's source notes.

        Each result carries ``noteId``, ``title``, ``snippet`` (truncated
        content_text), per-channel scores (``vectorScore``/``bm25Score``,
        nullable when only one channel matched), and the merged ``rrfScore``.
        Results are already sorted descending by rrfScore.
        """
        res = await post_internal(
            "/api/internal/notes/hybrid-search",
            {
                "projectId": project_id,
                "queryText": query_text,
                "queryEmbedding": query_embedding,
                "k": k,
            },
        )
        return list(res.get("results", []))

    async def list_orphan_concepts(self, project_id: str) -> list[dict[str, Any]]:
        """Concepts in the project with no edges in either direction."""
        res = await get_internal(
            f"/api/internal/projects/{project_id}/orphan-concepts"
        )
        return list(res.get("results", []))

    async def list_concept_pairs(
        self,
        *,
        project_id: str,
        similarity_min: float,
        similarity_max: float = 1.0,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Near-neighbour concept pairs inside a similarity band, used by
        Librarian for contradiction (band 0.75-0.95) and duplicate (>=0.97)
        analysis. Each result carries idA/nameA/descriptionA, idB/..., and
        cosine ``similarity``.
        """
        params = (
            f"similarityMin={similarity_min}"
            f"&similarityMax={similarity_max}"
            f"&limit={int(limit)}"
        )
        res = await get_internal(
            f"/api/internal/projects/{project_id}/concept-pairs?{params}"
        )
        return list(res.get("results", []))

    async def list_link_candidates(
        self,
        *,
        project_id: str,
        min_co_occurrence: int = 2,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Concept pairs that co-occur in the same note at least
        ``min_co_occurrence`` times. Librarian bumps the edge weight for
        each of these.
        """
        params = f"minCoOccurrence={min_co_occurrence}&limit={int(limit)}"
        res = await get_internal(
            f"/api/internal/projects/{project_id}/link-candidates?{params}"
        )
        return list(res.get("results", []))

    async def merge_concepts(
        self,
        *,
        primary_id: str,
        duplicate_ids: list[str],
    ) -> int:
        """Collapse duplicates into primary — re-points edges / concept_notes
        and deletes the duplicate rows. Returns the number of merged rows.
        """
        res = await post_internal(
            "/api/internal/concepts/merge",
            {"primaryId": primary_id, "duplicateIds": duplicate_ids},
        )
        return int(res.get("mergedCount", 0))

    async def refresh_note_tsv(self, note_id: str) -> None:
        """Force-regenerate content_tsv for a note. Rarely needed (trigger
        keeps it fresh) — exposed for Librarian after config changes."""
        await post_internal(f"/api/internal/notes/{note_id}/refresh-tsv", {})

    async def acquire_semaphore(
        self,
        *,
        project_id: str,
        holder_id: str,
        purpose: str,
        max_concurrent: int = 3,
        ttl_seconds: int = 30 * 60,
    ) -> dict[str, Any]:
        """Try to claim a concurrency slot for this project. Returns a dict
        with ``acquired`` (bool) and — on success — ``renewed`` (bool); on
        failure the response also carries ``running`` (int) for diagnostics.
        """
        res = await post_internal(
            "/api/internal/semaphores/acquire",
            {
                "projectId": project_id,
                "holderId": holder_id,
                "purpose": purpose,
                "maxConcurrent": max_concurrent,
                "ttlSeconds": ttl_seconds,
            },
        )
        return res

    async def release_semaphore(
        self,
        *,
        project_id: str,
        holder_id: str,
    ) -> None:
        """Drop a holder's slot. Idempotent — calling twice is safe."""
        await post_internal(
            "/api/internal/semaphores/release",
            {"projectId": project_id, "holderId": holder_id},
        )

    # -- Plan 3b: embedding_batches lifecycle ------------------------------

    async def create_embedding_batch(
        self,
        *,
        workspace_id: str | None,
        provider: str,
        provider_batch_name: str,
        input_count: int,
        input_s3_key: str,
    ) -> tuple[str, bool]:
        """Idempotent insert keyed on ``providerBatchName``.

        Returns ``(row_id, created)``. Temporal replay of the submit activity
        after a worker crash should hit the unique-index path and receive
        ``created=False`` without a duplicate insert.
        """
        res = await post_internal(
            "/api/internal/embedding-batches",
            {
                "workspaceId": workspace_id,
                "provider": provider,
                "providerBatchName": provider_batch_name,
                "inputCount": input_count,
                "inputS3Key": input_s3_key,
            },
        )
        return res["id"], bool(res.get("created", False))

    async def update_embedding_batch(
        self,
        *,
        batch_id: str,
        state: str,
        success_count: int | None = None,
        failure_count: int | None = None,
        pending_count: int | None = None,
        output_s3_key: str | None = None,
        error: str | None = None,
        mark_completed: bool = False,
    ) -> None:
        """Patch a batch row; only non-None fields are sent so a poll that
        only changes ``state`` doesn't overwrite previously-set counts.
        ``mark_completed=True`` stamps ``completed_at = now()`` on the API
        side.
        """
        body: dict[str, Any] = {"state": state}
        if success_count is not None:
            body["successCount"] = success_count
        if failure_count is not None:
            body["failureCount"] = failure_count
        if pending_count is not None:
            body["pendingCount"] = pending_count
        if output_s3_key is not None:
            body["outputS3Key"] = output_s3_key
        if error is not None:
            body["error"] = error
        if mark_completed:
            body["markCompleted"] = True
        await patch_internal(
            f"/api/internal/embedding-batches/{batch_id}",
            body,
        )
