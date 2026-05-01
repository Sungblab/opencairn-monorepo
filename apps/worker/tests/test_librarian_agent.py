"""Tests for :mod:`worker.agents.librarian.agent`."""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from llm.base import LLMProvider, ProviderConfig

from runtime.tools import ToolContext
from worker.agents.librarian.agent import (
    LibrarianAgent,
    _build_clusters,
    _collect_concept_details,
    _evidence_entries_from_pair_chunks,
    _parse_contradiction,
)

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_build_clusters_groups_transitive_duplicates() -> None:
    # a ~ b, b ~ c should produce one {a,b,c} cluster.
    pairs = [
        {"idA": "a", "idB": "b"},
        {"idA": "b", "idB": "c"},
        {"idA": "d", "idB": "e"},
    ]
    clusters = _build_clusters(pairs)
    # Sort for stable comparison.
    assert sorted([sorted(c) for c in clusters]) == [
        ["a", "b", "c"],
        ["d", "e"],
    ]


def test_build_clusters_uses_lex_smallest_as_primary() -> None:
    pairs = [{"idA": "zzz", "idB": "aaa"}]
    clusters = _build_clusters(pairs)
    assert clusters[0][0] == "aaa"


def test_collect_concept_details_dedupes_by_id() -> None:
    pairs = [
        {
            "idA": "a",
            "nameA": "N-a",
            "descriptionA": "d-a",
            "idB": "b",
            "nameB": "N-b",
            "descriptionB": "d-b",
        },
        {
            "idA": "a",  # repeated id
            "nameA": "N-a-v2",
            "descriptionA": "d-a-v2",
            "idB": "c",
            "nameB": "N-c",
            "descriptionB": "d-c",
        },
    ]
    details = _collect_concept_details(pairs)
    assert details["a"]["name"] == "N-a"  # first write wins
    assert details["b"]["name"] == "N-b"
    assert details["c"]["name"] == "N-c"


def test_parse_contradiction_accepts_plain_json() -> None:
    assert _parse_contradiction(
        '{"is_contradiction": true, "reason": "x"}'
    ) == {"is_contradiction": True, "reason": "x"}


def test_parse_contradiction_strips_markdown_fence() -> None:
    raw = '```json\n{"is_contradiction": false}\n```'
    assert _parse_contradiction(raw) == {"is_contradiction": False}


def test_parse_contradiction_returns_empty_dict_on_garbage() -> None:
    assert _parse_contradiction("not json") == {}
    assert _parse_contradiction("") == {}


def test_evidence_entries_from_pair_chunks_maps_citations() -> None:
    entries = _evidence_entries_from_pair_chunks(
        [
            {
                "id": "chunk-1",
                "noteId": "note-1",
                "noteTitle": "Source",
                "noteType": "source",
                "sourceType": "pdf",
                "headingPath": "Intro",
                "sourceOffsets": {"start": 0, "end": 42},
                "quote": "Alpha and Beta co-occur.",
            }
        ]
    )

    assert entries == [
        {
            "noteChunkId": "chunk-1",
            "noteId": "note-1",
            "noteType": "source",
            "sourceType": "pdf",
            "headingPath": "Intro",
            "sourceOffsets": {"start": 0, "end": 42},
            "score": 1.0,
            "rank": 1,
            "retrievalChannel": "graph",
            "quote": "Alpha and Beta co-occur.",
            "citation": {
                "label": "S1",
                "title": "Source",
                "locator": "Intro",
            },
            "metadata": {"producer": "librarian"},
        }
    ]


# ---------------------------------------------------------------------------
# LibrarianAgent.run — end-to-end with mocked collaborators
# ---------------------------------------------------------------------------


def _make_ctx() -> ToolContext:
    async def _emit(_: Any) -> None:
        return None

    return ToolContext(
        workspace_id="ws-1",
        project_id="proj-1",
        page_id=None,
        user_id="user-1",
        run_id="librarian-run-1",
        scope="project",
        emit=_emit,
    )


def _make_provider(generate_responses: list[str]) -> LLMProvider:
    p = MagicMock(spec=LLMProvider)
    p.config = ProviderConfig(
        provider="gemini", model="gemini-test", embed_model="e"
    )
    p.generate = AsyncMock(side_effect=list(generate_responses))
    p.embed = AsyncMock(return_value=[[0.1] * 8])
    return p


def _make_api() -> MagicMock:
    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(return_value=[])
    api.list_concept_pairs = AsyncMock(return_value=[])
    api.list_link_candidates = AsyncMock(return_value=[])
    api.list_concept_pair_chunks = AsyncMock(return_value={"chunks": []})
    api.create_evidence_bundle = AsyncMock(return_value={"id": "bundle-1"})
    api.create_knowledge_claim = AsyncMock(
        return_value={"claimId": "claim-1", "edgeEvidenceIds": ["ee-1"]}
    )
    api.merge_concepts = AsyncMock(return_value=0)
    api.upsert_concept = AsyncMock(return_value=("primary-id", False))
    api.upsert_edge = AsyncMock(return_value=("edge-id", True))
    return api


async def _collect(agent: LibrarianAgent) -> list:
    events = []
    async for ev in agent.run(
        {
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)
    return events


@pytest.mark.asyncio
async def test_librarian_empty_project_is_noop() -> None:
    provider = _make_provider([])
    api = _make_api()
    agent = LibrarianAgent(provider=provider, api=api)

    events = await _collect(agent)

    types = [e.type for e in events]
    assert types[0] == "agent_start"
    assert types[-1] == "agent_end"
    # No LLM calls when there are no pairs / no duplicates.
    provider.generate.assert_not_called()

    end = events[-1]
    assert end.output == {
        "project_id": "proj-1",
        "orphan_count": 0,
        "contradictions": [],
        "duplicates_merged": 0,
        "links_strengthened": 0,
    }


@pytest.mark.asyncio
async def test_librarian_counts_orphans() -> None:
    provider = _make_provider([])
    api = _make_api()
    api.list_orphan_concepts = AsyncMock(
        return_value=[
            {"id": "c1", "name": "iso1"},
            {"id": "c2", "name": "iso2"},
            {"id": "c3", "name": "iso3"},
        ]
    )
    agent = LibrarianAgent(provider=provider, api=api)

    events = await _collect(agent)

    end = events[-1]
    assert end.output["orphan_count"] == 3
    # Custom event fired with the count.
    customs = [
        e
        for e in events
        if e.type == "custom" and e.label == "librarian.orphans_detected"
    ]
    assert customs and customs[0].payload["count"] == 3


@pytest.mark.asyncio
async def test_librarian_flags_contradictions() -> None:
    # Two candidate pairs; LLM says first is a contradiction, second isn't.
    responses = [
        json.dumps({"is_contradiction": True, "reason": "Different numbers"}),
        json.dumps({"is_contradiction": False, "reason": "Complementary"}),
    ]
    provider = _make_provider(responses)
    api = _make_api()
    api.list_concept_pairs = AsyncMock(
        side_effect=[
            # Contradiction band → 2 pairs
            [
                {
                    "idA": "a",
                    "nameA": "A",
                    "descriptionA": "a1",
                    "idB": "b",
                    "nameB": "B",
                    "descriptionB": "b1",
                    "similarity": 0.85,
                },
                {
                    "idA": "c",
                    "nameA": "C",
                    "descriptionA": "c1",
                    "idB": "d",
                    "nameB": "D",
                    "descriptionB": "d1",
                    "similarity": 0.80,
                },
            ],
            # Duplicate band → empty
            [],
        ]
    )
    agent = LibrarianAgent(provider=provider, api=api)

    events = await _collect(agent)

    end = events[-1]
    assert len(end.output["contradictions"]) == 1
    assert end.output["contradictions"][0]["concept_id_a"] == "a"
    assert end.output["contradictions"][0]["concept_id_b"] == "b"


@pytest.mark.asyncio
async def test_librarian_merges_duplicate_clusters() -> None:
    # Three pairs forming two clusters: {a,b,c} (transitive) + {x,y}.
    dup_pairs = [
        {
            "idA": "a",
            "nameA": "A",
            "descriptionA": "adesc",
            "idB": "b",
            "nameB": "B",
            "descriptionB": "bdesc",
            "similarity": 0.98,
        },
        {
            "idA": "b",
            "nameA": "B",
            "descriptionA": "bdesc",
            "idB": "c",
            "nameB": "C",
            "descriptionB": "cdesc",
            "similarity": 0.98,
        },
        {
            "idA": "x",
            "nameA": "X",
            "descriptionA": "xdesc",
            "idB": "y",
            "nameB": "Y",
            "descriptionB": "ydesc",
            "similarity": 0.99,
        },
    ]
    # merge summary responses — one per duplicate id across both clusters
    # (cluster {a,b,c} needs 2 summary calls; cluster {x,y} needs 1).
    summaries = ["merged-ab", "merged-abc", "merged-xy"]
    provider = _make_provider(summaries)
    api = _make_api()
    api.list_concept_pairs = AsyncMock(
        side_effect=[
            [],  # contradictions band
            dup_pairs,  # duplicates band
        ]
    )
    api.merge_concepts = AsyncMock(side_effect=[2, 1])
    agent = LibrarianAgent(provider=provider, api=api)

    events = await _collect(agent)

    # 3 summary LLM calls, 2 merge_concepts invocations.
    assert provider.generate.await_count == 3
    assert api.merge_concepts.await_count == 2

    end = events[-1]
    assert end.output["duplicates_merged"] == 3

    # merge_concepts called with primary="a" (lex smallest) for first cluster
    # and primary="x" for second.
    call_args = [c.kwargs for c in api.merge_concepts.await_args_list]
    primaries = sorted(c["primary_id"] for c in call_args)
    assert primaries == ["a", "x"]


@pytest.mark.asyncio
async def test_librarian_strengthens_links() -> None:
    provider = _make_provider([])
    api = _make_api()
    api.list_link_candidates = AsyncMock(
        return_value=[
            {"sourceId": "s1", "targetId": "t1", "coOccurrenceCount": 4},
            {"sourceId": "s2", "targetId": "t2", "coOccurrenceCount": 30},
        ]
    )
    agent = LibrarianAgent(provider=provider, api=api)

    events = await _collect(agent)

    end = events[-1]
    assert end.output["links_strengthened"] == 2
    # First call: 4 * 0.05 = 0.2
    # Second call: 30 * 0.05 = 1.5 → clamped to 1.0
    weights = [
        c.kwargs["weight"] for c in api.upsert_edge.await_args_list
    ]
    assert weights == [0.2, 1.0]
    # Relation type is always "co-occurs".
    assert all(
        c.kwargs["relation_type"] == "co-occurs"
        for c in api.upsert_edge.await_args_list
    )


@pytest.mark.asyncio
async def test_librarian_strengthen_links_creates_evidence_backed_claim() -> None:
    provider = _make_provider([])
    api = _make_api()
    api.list_link_candidates = AsyncMock(
        return_value=[
            {"sourceId": "s1", "targetId": "t1", "coOccurrenceCount": 4},
        ]
    )
    api.upsert_edge = AsyncMock(return_value=("edge-1", True))
    api.list_concept_pair_chunks = AsyncMock(
        return_value={
            "source": {"id": "s1", "name": "Alpha"},
            "target": {"id": "t1", "name": "Beta"},
            "chunks": [
                {
                    "id": "chunk-1",
                    "noteId": "note-1",
                    "noteTitle": "Source",
                    "noteType": "source",
                    "sourceType": "pdf",
                    "headingPath": "Intro",
                    "sourceOffsets": {"start": 0, "end": 24},
                    "quote": "Alpha and Beta co-occur.",
                }
            ],
        }
    )
    api.create_evidence_bundle = AsyncMock(return_value={"id": "bundle-1"})
    api.create_knowledge_claim = AsyncMock(
        return_value={"claimId": "claim-1", "edgeEvidenceIds": ["ee-1"]}
    )
    agent = LibrarianAgent(provider=provider, api=api)

    events = await _collect(agent)

    assert events[-1].output["links_strengthened"] == 1
    api.create_evidence_bundle.assert_awaited_once()
    bundle_kwargs = api.create_evidence_bundle.await_args.kwargs
    assert bundle_kwargs["purpose"] == "kg_edge"
    assert bundle_kwargs["producer"]["tool"] == "librarian.strengthen_links"
    api.create_knowledge_claim.assert_awaited_once()
    claim_kwargs = api.create_knowledge_claim.await_args.kwargs
    assert claim_kwargs["produced_by"] == "wiki_maintenance"
    assert claim_kwargs["subject_concept_id"] == "s1"
    assert claim_kwargs["object_concept_id"] == "t1"
    assert claim_kwargs["edge_evidence"][0] == {
        "conceptEdgeId": "edge-1",
        "noteChunkId": "chunk-1",
        "supportScore": 0.5,
        "stance": "mentions",
        "quote": "Alpha and Beta co-occur.",
    }


@pytest.mark.asyncio
async def test_librarian_strengthen_links_skips_claim_without_chunks() -> None:
    provider = _make_provider([])
    api = _make_api()
    api.list_link_candidates = AsyncMock(
        return_value=[
            {"sourceId": "s1", "targetId": "t1", "coOccurrenceCount": 4},
        ]
    )
    api.list_concept_pair_chunks = AsyncMock(return_value={"chunks": []})
    agent = LibrarianAgent(provider=provider, api=api)

    events = await _collect(agent)

    assert events[-1].output["links_strengthened"] == 1
    api.create_evidence_bundle.assert_not_awaited()
    api.create_knowledge_claim.assert_not_awaited()
