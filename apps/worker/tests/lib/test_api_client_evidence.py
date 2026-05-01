from unittest.mock import AsyncMock, patch

import pytest

from worker.lib.api_client import AgentApiClient


@pytest.mark.asyncio
async def test_create_evidence_bundle_posts_internal_payload():
    client = AgentApiClient()
    with patch(
        "worker.lib.api_client.post_internal",
        new=AsyncMock(return_value={"id": "bundle-1"}),
    ) as post_mock:
        result = await client.create_evidence_bundle(
            workspace_id="ws",
            project_id="proj",
            purpose="concept_extraction",
            producer={"kind": "worker", "runId": "run-1"},
            created_by="user-1",
            entries=[{"noteChunkId": "chunk-1"}],
        )

    assert result == {"id": "bundle-1"}
    post_mock.assert_awaited_once_with(
        "/api/internal/evidence/bundles",
        {
            "workspaceId": "ws",
            "projectId": "proj",
            "purpose": "concept_extraction",
            "producer": {"kind": "worker", "runId": "run-1"},
            "createdBy": "user-1",
            "entries": [{"noteChunkId": "chunk-1"}],
        },
    )


@pytest.mark.asyncio
async def test_create_concept_extraction_posts_internal_payload():
    client = AgentApiClient()
    with patch(
        "worker.lib.api_client.post_internal",
        new=AsyncMock(return_value={"id": "extraction-1"}),
    ) as post_mock:
        result = await client.create_concept_extraction(
            workspace_id="ws",
            project_id="proj",
            concept_id="concept-1",
            name="OpenCairn",
            kind="concept",
            normalized_name="opencairn",
            confidence=0.9,
            evidence_bundle_id="bundle-1",
            source_note_id="note-1",
            created_by_run_id="run-1",
            chunks=[{"noteChunkId": "chunk-1", "supportScore": 0.9, "quote": "quote"}],
        )

    assert result == {"id": "extraction-1"}
    body = post_mock.await_args.args[1]
    assert post_mock.await_args.args[0] == "/api/internal/concepts/extractions"
    assert body["workspaceId"] == "ws"
    assert body["normalizedName"] == "opencairn"
    assert body["evidenceBundleId"] == "bundle-1"
    assert body["chunks"][0]["noteChunkId"] == "chunk-1"


@pytest.mark.asyncio
async def test_create_knowledge_claim_posts_internal_payload():
    client = AgentApiClient()
    with patch(
        "worker.lib.api_client.post_internal",
        new=AsyncMock(return_value={"claimId": "claim-1", "edgeEvidenceIds": ["ee-1"]}),
    ) as post_mock:
        result = await client.create_knowledge_claim(
            workspace_id="ws",
            project_id="proj",
            claim_text="Alpha is related to Beta.",
            claim_type="relation",
            status="active",
            confidence=0.8,
            evidence_bundle_id="bundle-1",
            produced_by="ingest",
            produced_by_run_id="run-1",
            subject_concept_id="alpha",
            object_concept_id="beta",
            edge_evidence=[
                {
                    "conceptEdgeId": "edge-1",
                    "noteChunkId": "chunk-1",
                    "supportScore": 0.8,
                    "stance": "supports",
                    "quote": "quote",
                }
            ],
        )

    assert result == {"claimId": "claim-1", "edgeEvidenceIds": ["ee-1"]}
    post_mock.assert_awaited_once_with(
        "/api/internal/knowledge/claims",
        {
            "workspaceId": "ws",
            "projectId": "proj",
            "claimText": "Alpha is related to Beta.",
            "claimType": "relation",
            "status": "active",
            "confidence": 0.8,
            "evidenceBundleId": "bundle-1",
            "producedBy": "ingest",
            "producedByRunId": "run-1",
            "subjectConceptId": "alpha",
            "objectConceptId": "beta",
            "edgeEvidence": [
                {
                    "conceptEdgeId": "edge-1",
                    "noteChunkId": "chunk-1",
                    "supportScore": 0.8,
                    "stance": "supports",
                    "quote": "quote",
                }
            ],
        },
    )


@pytest.mark.asyncio
async def test_list_note_chunks_uses_scoped_query():
    client = AgentApiClient()
    with patch(
        "worker.lib.api_client.get_internal",
        new=AsyncMock(return_value={"chunks": []}),
    ) as get_mock:
        await client.list_note_chunks(
            note_id="note-1",
            workspace_id="ws-1",
            project_id="proj-1",
            limit=3,
        )

    get_mock.assert_awaited_once_with(
        "/api/internal/notes/note-1/chunks?workspaceId=ws-1&projectId=proj-1&limit=3"
    )


@pytest.mark.asyncio
async def test_list_concept_pair_chunks_uses_pair_query():
    client = AgentApiClient()
    with patch(
        "worker.lib.api_client.get_internal",
        new=AsyncMock(return_value={"chunks": []}),
    ) as get_mock:
        result = await client.list_concept_pair_chunks(
            project_id="proj-1",
            source_id="source-1",
            target_id="target-1",
            limit=2,
        )

    assert result == {"chunks": []}
    get_mock.assert_awaited_once_with(
        "/api/internal/projects/proj-1/concept-pair-chunks?sourceId=source-1&targetId=target-1&limit=2"
    )
