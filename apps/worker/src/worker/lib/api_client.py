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

# Secrets that must never be honored as production credentials. The historical
# default ``"change-me-in-production"`` shipped in older worker images; if any
# deployment carries it in its env, treat it as a misconfiguration rather than
# silently authenticating to the internal API.
_PLACEHOLDER_INTERNAL_SECRETS = frozenset({"change-me-in-production"})

_TIMEOUT = 30.0


def _required_internal_secret() -> str:
    """Return ``INTERNAL_API_SECRET`` from the env, raising if missing.

    Resolved per-call so misconfiguration surfaces at the first network attempt
    instead of relying on module import order. Tests that mock ``post_internal``
    / ``get_internal`` / ``patch_internal`` outright are unaffected.
    """
    raw = os.environ.get("INTERNAL_API_SECRET", "").strip()
    if not raw or raw in _PLACEHOLDER_INTERNAL_SECRETS:
        raise RuntimeError(
            "INTERNAL_API_SECRET is required to call the internal API. "
            "Set INTERNAL_API_SECRET to a strong, deploy-specific secret "
            "(matching the API service)."
        )
    return raw


def _internal_headers() -> dict[str, str]:
    return {"X-Internal-Secret": _required_internal_secret()}


async def post_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """POST ``body`` as JSON to ``{API_BASE}{path}`` with the internal secret.

    Raises for non-2xx. Returns the decoded JSON body on success. 30s timeout
    matches the longest source-note insert we expect (large text + embedding
    trigger queueing).
    """
    headers = _internal_headers()
    async with httpx.AsyncClient(base_url=API_BASE, timeout=_TIMEOUT) as client:
        response = await client.post(path, json=body, headers=headers)
        response.raise_for_status()
        return response.json()


async def get_internal(path: str) -> dict[str, Any]:
    """GET ``{API_BASE}{path}`` with the internal secret. Same error contract as post."""
    headers = _internal_headers()
    async with httpx.AsyncClient(base_url=API_BASE, timeout=_TIMEOUT) as client:
        response = await client.get(path, headers=headers)
        response.raise_for_status()
        return response.json()


async def patch_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """PATCH ``{API_BASE}{path}`` with the internal secret."""
    headers = _internal_headers()
    async with httpx.AsyncClient(base_url=API_BASE, timeout=_TIMEOUT) as client:
        response = await client.patch(path, json=body, headers=headers)
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

    async def list_note_chunks(
        self,
        *,
        note_id: str,
        workspace_id: str,
        project_id: str,
        limit: int = 5,
    ) -> dict[str, Any]:
        """Fetch indexed chunks for one note, scoped by workspace + project.

        This is used by best-effort evidence producers after ingest/compiler
        work. A note may legitimately have no chunks yet during rollout; callers
        should treat an empty list as a skip condition.
        """
        return await get_internal(
            f"/api/internal/notes/{note_id}/chunks"
            f"?workspaceId={workspace_id}&projectId={project_id}&limit={int(limit)}"
        )

    async def get_concept(self, concept_id: str) -> dict[str, Any]:
        """Fetch one concept row from the internal concept endpoint."""
        return await get_internal(f"/api/internal/concepts/{concept_id}")

    async def create_evidence_bundle(
        self,
        *,
        workspace_id: str,
        project_id: str,
        purpose: str,
        producer: dict[str, Any],
        entries: list[dict[str, Any]],
        created_by: str | None = None,
        query: str | None = None,
    ) -> dict[str, Any]:
        """POST an EvidenceBundle to the internal writer."""
        body: dict[str, Any] = {
            "workspaceId": workspace_id,
            "projectId": project_id,
            "purpose": purpose,
            "producer": producer,
            "createdBy": created_by,
            "entries": entries,
        }
        if query is not None:
            body["query"] = query
        return await post_internal("/api/internal/evidence/bundles", body)

    async def create_concept_extraction(
        self,
        *,
        workspace_id: str,
        project_id: str,
        name: str,
        kind: str,
        normalized_name: str,
        confidence: float,
        evidence_bundle_id: str,
        chunks: list[dict[str, Any]],
        concept_id: str | None = None,
        description: str = "",
        source_note_id: str | None = None,
        created_by_run_id: str | None = None,
    ) -> dict[str, Any]:
        """POST concept extraction provenance to the internal writer."""
        body: dict[str, Any] = {
            "workspaceId": workspace_id,
            "projectId": project_id,
            "name": name,
            "kind": kind,
            "normalizedName": normalized_name,
            "description": description,
            "confidence": confidence,
            "evidenceBundleId": evidence_bundle_id,
            "chunks": chunks,
        }
        if concept_id is not None:
            body["conceptId"] = concept_id
        if source_note_id is not None:
            body["sourceNoteId"] = source_note_id
        if created_by_run_id is not None:
            body["createdByRunId"] = created_by_run_id
        return await post_internal("/api/internal/concepts/extractions", body)

    async def create_knowledge_claim(
        self,
        *,
        workspace_id: str,
        project_id: str,
        claim_text: str,
        claim_type: str,
        status: str,
        confidence: float,
        evidence_bundle_id: str,
        produced_by: str,
        subject_concept_id: str | None = None,
        object_concept_id: str | None = None,
        produced_by_run_id: str | None = None,
        edge_evidence: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """POST a source-backed knowledge claim to the internal writer."""
        body: dict[str, Any] = {
            "workspaceId": workspace_id,
            "projectId": project_id,
            "claimText": claim_text,
            "claimType": claim_type,
            "status": status,
            "confidence": confidence,
            "evidenceBundleId": evidence_bundle_id,
            "producedBy": produced_by,
        }
        if subject_concept_id is not None:
            body["subjectConceptId"] = subject_concept_id
        if object_concept_id is not None:
            body["objectConceptId"] = object_concept_id
        if produced_by_run_id is not None:
            body["producedByRunId"] = produced_by_run_id
        if edge_evidence is not None:
            body["edgeEvidence"] = edge_evidence
        return await post_internal("/api/internal/knowledge/claims", body)

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

    async def expand_concept_graph(
        self,
        *,
        project_id: str,
        workspace_id: str,
        user_id: str,
        concept_id: str,
        hops: int = 1,
    ) -> dict[str, Any]:
        """POST /api/internal/projects/:id/graph/expand.

        Carries workspace_id + user_id in the body so the API can enforce
        the canRead chain + projects.workspaceId match (internal API
        workspace scope memo). Plan 5 Phase 2.
        """
        return await post_internal(
            f"/api/internal/projects/{project_id}/graph/expand",
            {
                "conceptId": concept_id,
                "hops": hops,
                "workspaceId": workspace_id,
                "userId": user_id,
            },
        )

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

    async def start_agent_run(
        self,
        *,
        workspace_id: str,
        project_id: str | None,
        page_id: str | None = None,
        user_id: str,
        agent_name: str,
        workflow_id: str,
        trajectory_uri: str,
        parent_run_id: str | None = None,
    ) -> dict[str, Any]:
        """Create or reset an ``agent_runs`` summary row for a worker run."""
        body: dict[str, Any] = {
            "workspaceId": workspace_id,
            "projectId": project_id,
            "pageId": page_id,
            "userId": user_id,
            "agentName": agent_name,
            "workflowId": workflow_id,
            "trajectoryUri": trajectory_uri,
        }
        if parent_run_id is not None:
            body["parentRunId"] = parent_run_id
        return await post_internal("/api/internal/agent-runs", body)

    async def finish_agent_run(
        self,
        *,
        agent_name: str,
        workflow_id: str,
        status: str,
        total_tokens_in: int = 0,
        total_tokens_out: int = 0,
        total_tokens_cached: int = 0,
        total_cost_krw: int = 0,
        tool_call_count: int = 0,
        model_call_count: int = 0,
        trajectory_uri: str | None = None,
        trajectory_bytes: int = 0,
        error_class: str | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        """Patch the terminal metrics for an ``agent_runs`` summary row."""
        body: dict[str, Any] = {
            "agentName": agent_name,
            "status": status,
            "totalTokensIn": total_tokens_in,
            "totalTokensOut": total_tokens_out,
            "totalTokensCached": total_tokens_cached,
            "totalCostKrw": total_cost_krw,
            "toolCallCount": tool_call_count,
            "modelCallCount": model_call_count,
            "trajectoryBytes": trajectory_bytes,
        }
        if trajectory_uri is not None:
            body["trajectoryUri"] = trajectory_uri
        if error_class is not None:
            body["errorClass"] = error_class
        if error_message is not None:
            body["errorMessage"] = error_message
        return await patch_internal(f"/api/internal/agent-runs/{workflow_id}", body)

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

    async def get_project_wiki_index(self, project_id: str) -> dict[str, Any]:
        """Live wiki-link index and diagnostics for one project."""
        return await get_internal(f"/api/internal/projects/{project_id}/wiki-index")

    async def create_agent_action(
        self,
        *,
        project_id: str,
        user_id: str,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        """Create a reviewable agent action from an internal worker run."""
        return await post_internal(
            f"/api/internal/projects/{project_id}/agent-actions",
            {"userId": user_id, "action": request},
        )

    async def list_project_topics(
        self, *, project_id: str,
    ) -> list[dict[str, Any]]:
        """Top 30 concepts in the project by note-link count. Used as the
        Layer 3 hierarchical retrieval entry point for ToolDemoAgent.
        """
        res = await get_internal(
            f"/api/internal/projects/{project_id}/topics"
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

    async def list_concept_pair_chunks(
        self,
        *,
        project_id: str,
        source_id: str,
        target_id: str,
        limit: int = 3,
    ) -> dict[str, Any]:
        """Fetch shared note chunks for a co-occurring concept pair.

        Returns ``{source, target, chunks}``. ``chunks`` may be empty when
        concepts co-occur through older concept_note rows but chunk indexing
        has not produced paragraph evidence yet.
        """
        params = (
            f"sourceId={source_id}"
            f"&targetId={target_id}"
            f"&limit={int(limit)}"
        )
        return await get_internal(
            f"/api/internal/projects/{project_id}/concept-pair-chunks?{params}"
        )

    async def merge_concepts(
        self,
        *,
        workspace_id: str,
        primary_id: str,
        duplicate_ids: list[str],
    ) -> int:
        """Collapse duplicates into primary — re-points edges / concept_notes
        and deletes the duplicate rows. Returns the number of merged rows.

        ``workspace_id`` is enforced server-side (Tier 1 item 1-3). A
        mismatched id on any of the concept rows returns 403
        ``workspace_mismatch`` and raises ``httpx.HTTPStatusError`` here.
        """
        res = await post_internal(
            "/api/internal/concepts/merge",
            {
                "workspaceId": workspace_id,
                "primaryId": primary_id,
                "duplicateIds": duplicate_ids,
            },
        )
        return int(res.get("mergedCount", 0))

    async def refresh_note_tsv(self, note_id: str) -> None:
        """Force-regenerate content_tsv for a note. Rarely needed (trigger
        keeps it fresh) — exposed for Librarian after config changes."""
        await post_internal(f"/api/internal/notes/{note_id}/refresh-tsv", {})

    async def acquire_semaphore(
        self,
        *,
        workspace_id: str,
        project_id: str,
        holder_id: str,
        purpose: str,
        max_concurrent: int = 3,
        ttl_seconds: int = 30 * 60,
    ) -> dict[str, Any]:
        """Try to claim a concurrency slot for this project. Returns a dict
        with ``acquired`` (bool) and — on success — ``renewed`` (bool); on
        failure the response also carries ``running`` (int) for diagnostics.

        ``workspace_id`` is enforced server-side (Tier 1 item 1-3 + 1-2).
        """
        res = await post_internal(
            "/api/internal/semaphores/acquire",
            {
                "workspaceId": workspace_id,
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
        workspace_id: str,
        project_id: str,
        holder_id: str,
    ) -> None:
        """Drop a holder's slot. Idempotent — calling twice is safe."""
        await post_internal(
            "/api/internal/semaphores/release",
            {
                "workspaceId": workspace_id,
                "projectId": project_id,
                "holderId": holder_id,
            },
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
