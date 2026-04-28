"""Unit tests for lit_import_activities pure helpers and activity bodies.

Activities are dispatched via temporalio.testing.ActivityEnvironment so the
@activity.defn wrapper exercises its real registration / heartbeat code
path rather than being bypassed.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from temporalio.testing import ActivityEnvironment

from worker.activities import lit_import_activities as lia


# ── _normalize_doi ───────────────────────────────────────────────────────────


def test_normalize_doi_strips_url_prefix():
    assert lia._normalize_doi("https://doi.org/10.1234/test") == "10.1234/test"
    assert lia._normalize_doi("http://dx.doi.org/10.5678/foo") == "10.5678/foo"


def test_normalize_doi_passthrough():
    assert lia._normalize_doi("10.1234/test") == "10.1234/test"


def test_normalize_doi_none_and_empty():
    assert lia._normalize_doi(None) is None
    assert lia._normalize_doi("") is None
    assert lia._normalize_doi("   ") is None


# ── fetch_paper_metadata ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_paper_metadata_arxiv_id():
    mock_resp = {
        "id": "arxiv:1706.03762",
        "doi": None,
        "arxivId": "1706.03762",
        "title": "Attention Is All You Need",
        "authors": ["Vaswani"],
        "year": 2017,
        "abstract": "We propose...",
        "openAccessPdfUrl": "https://arxiv.org/pdf/1706.03762.pdf",
        "citationCount": None,
    }

    with patch.object(
        lia, "_fetch_arxiv_metadata", new=AsyncMock(return_value=mock_resp)
    ), patch.object(lia, "_fetch_ss_metadata", new=AsyncMock(return_value=None)):
        env = ActivityEnvironment()
        result = await env.run(
            lia.fetch_paper_metadata, {"ids": ["arxiv:1706.03762"]}
        )

    papers = result["papers"]
    assert len(papers) == 1
    assert papers[0]["title"] == "Attention Is All You Need"
    assert papers[0]["oa_pdf_url"] == "https://arxiv.org/pdf/1706.03762.pdf"
    assert papers[0]["is_paywalled"] is False


@pytest.mark.asyncio
async def test_fetch_paper_metadata_skips_unresolvable():
    with patch.object(
        lia, "_fetch_arxiv_metadata", new=AsyncMock(return_value=None)
    ), patch.object(lia, "_fetch_ss_metadata", new=AsyncMock(return_value=None)):
        env = ActivityEnvironment()
        result = await env.run(
            lia.fetch_paper_metadata,
            {"ids": ["arxiv:9999.9999", "10.invalid/missing"]},
        )

    assert result["papers"] == []


# ── lit_dedupe_check ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lit_dedupe_check_splits_correctly():
    async def fake_get(path: str) -> dict:
        # DOIs get URL-encoded (slashes become %2F); match on a fragment
        # that survives both forms.
        if "10.already" in path:
            return {"exists": True, "noteId": "note-abc"}
        return {"exists": False, "noteId": None}

    with patch.object(
        lia, "get_internal", new=AsyncMock(side_effect=fake_get)
    ):
        env = ActivityEnvironment()
        result = await env.run(
            lia.lit_dedupe_check,
            {
                "workspace_id": "ws-1",
                "ids": ["10.already/x", "10.fresh/y", "arxiv:2306.00001"],
            },
        )

    # arxiv-only ids are always fresh (no DOI dedupe possible at this layer)
    assert result["skipped"] == ["10.already/x"]
    assert set(result["fresh"]) == {"10.fresh/y", "arxiv:2306.00001"}


# ── _ssrf_guard ──────────────────────────────────────────────────────────────


def test_ssrf_guard_blocks_loopback_and_private():
    with pytest.raises(ValueError, match="SSRF"):
        lia._ssrf_guard("http://127.0.0.1/foo.pdf")
    with pytest.raises(ValueError, match="SSRF"):
        lia._ssrf_guard("http://10.0.0.5/secret.pdf")
    with pytest.raises(ValueError, match="SSRF"):
        lia._ssrf_guard("http://169.254.169.254/aws-metadata")


def test_ssrf_guard_passes_public_host():
    # Should not raise — these are public.
    lia._ssrf_guard("https://arxiv.org/pdf/1706.03762.pdf")
    lia._ssrf_guard("https://example.com/paper.pdf")
