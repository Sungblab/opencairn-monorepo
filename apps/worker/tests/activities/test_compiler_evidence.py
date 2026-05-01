from unittest.mock import AsyncMock

import pytest

from worker.activities.compiler_activity import (
    _record_compiler_relation_claims,
    _record_concept_extraction_evidence,
)
from worker.agents.compiler import CompilerOutput


@pytest.mark.asyncio
async def test_record_concept_extraction_evidence_writes_bundle_and_extractions():
    api = AsyncMock()
    api.list_note_chunks.return_value = {
        "note": {"title": "Source", "type": "source", "sourceType": "pdf"},
        "chunks": [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "noteId": "22222222-2222-4222-8222-222222222222",
                "headingPath": "Intro",
                "sourceOffsets": {"start": 0, "end": 10},
                "quote": "supporting quote",
            }
        ],
    }
    api.create_evidence_bundle.return_value = {
        "id": "33333333-3333-4333-8333-333333333333"
    }
    api.get_concept.return_value = {
        "id": "44444444-4444-4444-8444-444444444444",
        "name": "OpenCairn",
        "description": "Knowledge OS",
    }
    api.create_concept_extraction.return_value = {
        "id": "55555555-5555-4555-8555-555555555555"
    }
    api.create_knowledge_claim.return_value = {
        "claimId": "66666666-6666-4666-8666-666666666666",
        "edgeEvidenceIds": [],
    }

    await _record_concept_extraction_evidence(
        api,
        {
            "workspace_id": "66666666-6666-4666-8666-666666666666",
            "project_id": "77777777-7777-4777-8777-777777777777",
            "user_id": "user-1",
        },
        CompilerOutput(
            note_id="22222222-2222-4222-8222-222222222222",
            extracted_count=1,
            created_count=1,
            merged_count=0,
            linked_count=1,
            concept_ids=["44444444-4444-4444-8444-444444444444"],
        ),
        "compiler-run-1",
    )

    api.create_evidence_bundle.assert_awaited_once()
    bundle_kwargs = api.create_evidence_bundle.await_args.kwargs
    assert bundle_kwargs["purpose"] == "concept_extraction"
    assert bundle_kwargs["producer"]["tool"] == "compile_note"
    assert bundle_kwargs["entries"][0]["noteChunkId"] == (
        "11111111-1111-4111-8111-111111111111"
    )

    api.create_concept_extraction.assert_awaited_once()
    extraction_kwargs = api.create_concept_extraction.await_args.kwargs
    assert extraction_kwargs["name"] == "OpenCairn"
    assert extraction_kwargs["evidence_bundle_id"] == (
        "33333333-3333-4333-8333-333333333333"
    )
    assert extraction_kwargs["chunks"][0]["noteChunkId"] == (
        "11111111-1111-4111-8111-111111111111"
    )
    api.create_knowledge_claim.assert_awaited_once()
    claim_kwargs = api.create_knowledge_claim.await_args.kwargs
    assert claim_kwargs["claim_type"] == "definition"
    assert claim_kwargs["subject_concept_id"] == (
        "44444444-4444-4444-8444-444444444444"
    )
    assert claim_kwargs["evidence_bundle_id"] == (
        "33333333-3333-4333-8333-333333333333"
    )


@pytest.mark.asyncio
async def test_record_concept_extraction_evidence_records_each_concept():
    api = AsyncMock()
    api.list_note_chunks.return_value = {
        "note": {"title": "Source", "type": "source", "sourceType": "pdf"},
        "chunks": [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "noteId": "22222222-2222-4222-8222-222222222222",
                "headingPath": "Intro",
                "sourceOffsets": {"start": 0, "end": 10},
                "quote": "supporting quote",
            }
        ],
    }
    api.create_evidence_bundle.return_value = {
        "id": "33333333-3333-4333-8333-333333333333"
    }
    api.get_concept.side_effect = [
        {"id": "concept-a", "name": "Alpha", "description": "A"},
        {"id": "concept-b", "name": "Beta", "description": "B"},
        {"id": "concept-a", "name": "Alpha", "description": "A"},
        {"id": "concept-b", "name": "Beta", "description": "B"},
    ]
    api.upsert_edge.return_value = ("edge-1", True)

    await _record_concept_extraction_evidence(
        api,
        {
            "workspace_id": "66666666-6666-4666-8666-666666666666",
            "project_id": "77777777-7777-4777-8777-777777777777",
            "user_id": "user-1",
        },
        CompilerOutput(
            note_id="22222222-2222-4222-8222-222222222222",
            extracted_count=2,
            created_count=2,
            merged_count=0,
            linked_count=2,
            concept_ids=["concept-a", "concept-b"],
        ),
        "compiler-run-1",
    )

    assert api.get_concept.await_count == 4
    assert api.create_concept_extraction.await_count == 2
    assert api.create_knowledge_claim.await_count == 3
    concept_ids = {
        call.kwargs["concept_id"]
        for call in api.create_concept_extraction.await_args_list
    }
    assert concept_ids == {"concept-a", "concept-b"}


@pytest.mark.asyncio
async def test_record_concept_extraction_evidence_skips_when_no_chunks():
    api = AsyncMock()
    api.list_note_chunks.return_value = {"note": {}, "chunks": []}

    await _record_concept_extraction_evidence(
        api,
        {
            "workspace_id": "ws",
            "project_id": "proj",
            "user_id": "user",
        },
        CompilerOutput(
            note_id="note",
            extracted_count=1,
            created_count=1,
            merged_count=0,
            linked_count=1,
            concept_ids=["concept"],
        ),
        "run",
    )

    api.create_evidence_bundle.assert_not_awaited()
    api.create_concept_extraction.assert_not_awaited()
    api.create_knowledge_claim.assert_not_awaited()


@pytest.mark.asyncio
async def test_record_concept_extraction_evidence_ignores_claim_failures():
    api = AsyncMock()
    api.list_note_chunks.return_value = {
        "note": {"title": "Source", "type": "source", "sourceType": "pdf"},
        "chunks": [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "noteId": "22222222-2222-4222-8222-222222222222",
                "headingPath": "Intro",
                "sourceOffsets": {"start": 0, "end": 10},
                "quote": "supporting quote",
            }
        ],
    }
    api.create_evidence_bundle.return_value = {
        "id": "33333333-3333-4333-8333-333333333333"
    }
    api.get_concept.return_value = {
        "id": "44444444-4444-4444-8444-444444444444",
        "name": "OpenCairn",
        "description": "Knowledge OS",
    }
    api.create_knowledge_claim.side_effect = RuntimeError("claim writer down")

    await _record_concept_extraction_evidence(
        api,
        {
            "workspace_id": "66666666-6666-4666-8666-666666666666",
            "project_id": "77777777-7777-4777-8777-777777777777",
            "user_id": "user-1",
        },
        CompilerOutput(
            note_id="22222222-2222-4222-8222-222222222222",
            extracted_count=1,
            created_count=1,
            merged_count=0,
            linked_count=1,
            concept_ids=["44444444-4444-4444-8444-444444444444"],
        ),
        "compiler-run-1",
    )

    api.create_concept_extraction.assert_awaited_once()
    api.create_knowledge_claim.assert_awaited_once()


@pytest.mark.asyncio
async def test_record_compiler_relation_claims_creates_edge_claims():
    api = AsyncMock()
    api.get_concept.side_effect = [
        {"id": "concept-a", "name": "Alpha"},
        {"id": "concept-b", "name": "Beta"},
    ]
    api.upsert_edge.return_value = ("edge-1", True)
    api.create_knowledge_claim.return_value = {
        "claimId": "claim-1",
        "edgeEvidenceIds": ["edge-evidence-1"],
    }

    await _record_compiler_relation_claims(
        api=api,
        inp={
            "workspace_id": "ws-1",
            "project_id": "proj-1",
        },
        output=CompilerOutput(
            note_id="note-1",
            extracted_count=2,
            created_count=2,
            merged_count=0,
            linked_count=2,
            concept_ids=["concept-a", "concept-b"],
        ),
        run_id="compiler-run-1",
        bundle_id="bundle-1",
        extraction_chunks=[
            {
                "noteChunkId": "chunk-1",
                "supportScore": 1.0,
                "quote": "Alpha and Beta appear together.",
            }
        ],
        concept_ids=["concept-a", "concept-b"],
    )

    api.upsert_edge.assert_awaited_once_with(
        source_id="concept-a",
        target_id="concept-b",
        relation_type="co-mentioned",
        weight=0.5,
        evidence_note_id="note-1",
    )
    api.create_knowledge_claim.assert_awaited_once()
    claim_kwargs = api.create_knowledge_claim.await_args.kwargs
    assert claim_kwargs["claim_type"] == "relation"
    assert claim_kwargs["produced_by"] == "ingest"
    assert claim_kwargs["edge_evidence"] == [
        {
            "conceptEdgeId": "edge-1",
            "noteChunkId": "chunk-1",
            "supportScore": 0.7,
            "stance": "mentions",
            "quote": "Alpha and Beta appear together.",
        }
    ]


@pytest.mark.asyncio
async def test_record_compiler_relation_claims_ignores_edge_failures():
    api = AsyncMock()
    api.get_concept.side_effect = [
        {"id": "concept-a", "name": "Alpha"},
        {"id": "concept-b", "name": "Beta"},
    ]
    api.upsert_edge.side_effect = RuntimeError("edge writer down")

    await _record_compiler_relation_claims(
        api=api,
        inp={"workspace_id": "ws-1", "project_id": "proj-1"},
        output=CompilerOutput(
            note_id="note-1",
            extracted_count=2,
            created_count=2,
            merged_count=0,
            linked_count=2,
            concept_ids=["concept-a", "concept-b"],
        ),
        run_id="compiler-run-1",
        bundle_id="bundle-1",
        extraction_chunks=[
            {"noteChunkId": "chunk-1", "supportScore": 1.0, "quote": "quote"}
        ],
        concept_ids=["concept-a", "concept-b"],
    )

    api.create_knowledge_claim.assert_not_awaited()
