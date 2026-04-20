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
