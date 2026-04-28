"""Activities for LitImportWorkflow.

fetch_paper_metadata     — resolves DOI / arXiv ID → metadata + OA PDF url
lit_dedupe_check         — checks workspace for pre-existing DOI notes
create_metadata_note     — creates a paper-meta-only note (paywall case)
fetch_and_upload_oa_pdf  — downloads OA PDF → MinIO object key

Plan: Literature Search & Auto-Import (2026-04-27).
"""
from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import urllib.parse
from typing import Any

import httpx
from temporalio import activity

from worker.lib.api_client import get_internal, post_internal
from worker.lib.s3_client import upload_object


# ── Helpers ──────────────────────────────────────────────────────────────────


def _normalize_doi(doi: str | None) -> str | None:
    """Strip the canonical https://doi.org/ prefix if present.

    Some upstream sources (Crossref, dx.doi.org redirects) hand back URLs
    rather than bare identifiers. Normalising here keeps the dedupe check
    keyed on the bare DOI that the API stores in notes.doi.
    """
    if doi is None:
        return None
    bare = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi).strip()
    return bare or None


async def _fetch_arxiv_metadata(arxiv_id: str) -> dict[str, Any] | None:
    url = f"https://export.arxiv.org/api/query?id_list={arxiv_id}&max_results=1"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
    except httpx.HTTPError:
        return None

    xml = r.text
    # arXiv Atom feeds wrap each paper in <entry>...</entry>. The feed
    # itself also has a <title> ("ArXiv Query: id_list=...") and <author>
    # block at the top level — searching the whole doc would pick those
    # up first. Scope every per-paper field to the entry block instead.
    entry_m = re.search(r"<entry>([\s\S]*?)</entry>", xml)
    if entry_m is None:
        return None
    entry = entry_m.group(1)

    title_m = re.search(r"<title>([\s\S]*?)</title>", entry)
    abstract_m = re.search(r"<summary>([\s\S]*?)</summary>", entry)
    year_m = re.search(r"<published>(\d{4})", entry)
    doi_m = re.search(r"<arxiv:doi[^>]*>(.*?)</arxiv:doi>", entry)
    authors = re.findall(r"<name>([\s\S]*?)</name>", entry)

    title = (title_m.group(1).strip() if title_m else "Untitled").replace("\n", " ")
    abstract = abstract_m.group(1).strip() if abstract_m else None
    doi = _normalize_doi(doi_m.group(1).strip() if doi_m else None)

    return {
        "id": doi or f"arxiv:{arxiv_id}",
        "doi": doi,
        "arxivId": arxiv_id,
        "title": title,
        "authors": [a.strip() for a in authors],
        "year": int(year_m.group(1)) if year_m else None,
        "abstract": abstract,
        "openAccessPdfUrl": f"https://arxiv.org/pdf/{arxiv_id}.pdf",
        "citationCount": None,
    }


async def _fetch_ss_metadata(doi: str) -> dict[str, Any] | None:
    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
    headers: dict[str, str] = {}
    if api_key:
        headers["x-api-key"] = api_key

    url = (
        f"https://api.semanticscholar.org/graph/v1/paper/{doi}"
        "?fields=title,authors,year,abstract,citationCount,openAccessPdf,externalIds"
    )
    try:
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            r = await client.get(url)
            if r.status_code == 404:
                return None
            r.raise_for_status()
    except httpx.HTTPError:
        return None

    p = r.json()
    ext = p.get("externalIds") or {}
    arxiv_id = ext.get("ArXiv")
    oa = (p.get("openAccessPdf") or {}).get("url")

    return {
        "id": doi,
        "doi": doi,
        "arxivId": arxiv_id,
        "title": p.get("title", "Untitled"),
        "authors": [a["name"] for a in (p.get("authors") or [])],
        "year": p.get("year"),
        "abstract": p.get("abstract"),
        "openAccessPdfUrl": oa,
        "citationCount": p.get("citationCount"),
    }


async def _resolve_oa_url(doi: str) -> str | None:
    email = os.environ.get("UNPAYWALL_EMAIL", "contact@opencairn.app")
    url = f"https://api.unpaywall.org/v2/{doi}?email={email}"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url)
            if not r.is_success:
                return None
            best = r.json().get("best_oa_location") or {}
            return best.get("url_for_pdf")
    except httpx.HTTPError:
        return None


# ── Activities ────────────────────────────────────────────────────────────────


@activity.defn(name="fetch_paper_metadata")
async def fetch_paper_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve metadata + OA PDF URL for a list of DOI / arXiv IDs.

    payload: { ids: list[str] }   (DOI or "arxiv:<id>")
    returns: { papers: list[PaperNode] }
    Workflow timeout: 2 min (set on the workflow side).
    """
    ids: list[str] = payload["ids"]
    papers: list[dict[str, Any]] = []

    for raw_id in ids:
        paper: dict[str, Any] | None = None

        if raw_id.startswith("arxiv:"):
            arxiv_id = raw_id[len("arxiv:") :]
            paper = await _fetch_arxiv_metadata(arxiv_id)
        else:
            doi = _normalize_doi(raw_id)
            if doi:
                paper = await _fetch_ss_metadata(doi)
                if paper and not paper.get("openAccessPdfUrl"):
                    paper["openAccessPdfUrl"] = await _resolve_oa_url(doi)

        if paper is None:
            # Skip unresolvable IDs; the workflow tallies them as failed
            # without aborting the rest of the batch.
            continue

        papers.append(
            {
                "doi": paper.get("doi"),
                "arxiv_id": paper.get("arxivId"),
                "title": paper.get("title", "Untitled"),
                "authors": paper.get("authors", []),
                "year": paper.get("year"),
                "abstract": paper.get("abstract"),
                "citation_count": paper.get("citationCount"),
                "oa_pdf_url": paper.get("openAccessPdfUrl"),
                "is_paywalled": paper.get("openAccessPdfUrl") is None,
            }
        )

    return {"papers": papers}


@activity.defn(name="lit_dedupe_check")
async def lit_dedupe_check(payload: dict[str, Any]) -> dict[str, Any]:
    """Check workspace for pre-existing notes with matching DOI.

    payload: { workspace_id: str, ids: list[str] }
    returns: { fresh: list[str], skipped: list[str] }
    Workflow timeout: 30 s.

    arxiv-only IDs (no DOI) are always treated as fresh — the partial
    unique index notes_workspace_doi_idx skips NULL doi rows, so we have
    no cheap way to dedupe by arXiv id at this layer. Title-based dedupe
    is a Tier-1 follow-up.
    """
    workspace_id: str = payload["workspace_id"]
    ids: list[str] = payload["ids"]
    fresh: list[str] = []
    skipped: list[str] = []

    for raw_id in ids:
        if raw_id.startswith("arxiv:"):
            fresh.append(raw_id)
            continue
        doi = _normalize_doi(raw_id) or raw_id
        # urlencode doi — DOIs frequently contain '/' which httpx will pass
        # through, but downstream Hono parses path before query so we want
        # to be explicit.
        encoded = urllib.parse.quote(doi, safe="")
        result = await get_internal(
            f"/api/internal/notes?workspaceId={workspace_id}&doi={encoded}"
        )
        if result.get("exists"):
            skipped.append(raw_id)
        else:
            fresh.append(raw_id)

    return {"fresh": fresh, "skipped": skipped}


@activity.defn(name="create_metadata_note")
async def create_metadata_note(payload: dict[str, Any]) -> dict[str, Any]:
    """Create a metadata-only note for a paywalled paper.

    payload: { paper: PaperNode, project_id: str, job_id: str }
    returns: { note_id: str }
    Workflow timeout: 30 s.
    """
    paper = payload["paper"]
    project_id = payload["project_id"]
    job_id = payload["job_id"]

    authors_str = ", ".join(paper.get("authors") or [])
    year = paper.get("year", "")
    abstract = paper.get("abstract") or ""

    # Plate content: paper_meta block (renders the rich card) + a paragraph
    # explaining the paywall. The actual block schema lands in Plan 2D's
    # editor-blocks layer; until then the API persists this opaquely as
    # JSONB and the editor renders unknown blocks as code-fence fallback.
    plate_content = [
        {
            "type": "paper_meta",
            "doi": paper.get("doi"),
            "arxivId": paper.get("arxiv_id"),
            "title": paper.get("title", "Untitled"),
            "authors": paper.get("authors", []),
            "year": paper.get("year"),
            "abstract": abstract[:1000] if abstract else None,
            "citationCount": paper.get("citation_count"),
            "openAccessUrl": None,
            "isPaywalled": True,
            "children": [{"text": ""}],
        },
        {
            "type": "p",
            "children": [
                {
                    "text": "이 논문의 OA PDF를 찾지 못했습니다. PDF를 직접 업로드하거나 기관 구독으로 접근하세요.",
                }
            ],
        },
    ]

    content_text = (
        f"{paper.get('title', '')} {authors_str} {year} {abstract[:500]}"
    ).strip()

    resp = await post_internal(
        "/api/internal/notes",
        {
            "projectId": project_id,
            "title": paper.get("title", "Untitled"),
            "type": "source",
            "sourceType": "paper",
            "doi": paper.get("doi"),
            "content": plate_content,
            "contentText": content_text,
            "importJobId": job_id,
        },
    )
    return {"note_id": resp["id"]}


@activity.defn(name="fetch_and_upload_oa_pdf")
async def fetch_and_upload_oa_pdf(payload: dict[str, Any]) -> dict[str, Any]:
    """Download an OA PDF, upload to MinIO, return the object key.

    payload: { oa_pdf_url: str, job_id: str, paper_id: str }
    returns: { object_key: str }
    Workflow timeout: 5 min. Caller enforces a 50 MiB ceiling here so
    pathological PDFs (e.g. scanned theses) don't OOM the worker.
    """
    oa_url: str = payload["oa_pdf_url"]
    job_id: str = payload["job_id"]
    paper_id: str = payload["paper_id"]  # DOI or arxiv:<id> — used in object key

    MAX_BYTES = 50 * 1024 * 1024  # 50 MiB

    # SSRF guard: reject loopback / RFC-1918 / link-local targets *before*
    # paying for the round-trip. httpx will follow redirects so we re-check
    # after the response comes back via r.url.
    _ssrf_guard(oa_url)

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        r = await client.get(oa_url)
        r.raise_for_status()
        _ssrf_guard(str(r.url))

        ct = r.headers.get("content-type", "")
        if "application/pdf" not in ct and not str(r.url).lower().endswith(".pdf"):
            raise ValueError(f"Unexpected content-type from OA URL: {ct}")

        content = r.content
        if len(content) > MAX_BYTES:
            raise ValueError(f"PDF exceeds 50MiB limit: {len(content)} bytes")

    safe_id = re.sub(r"[^a-zA-Z0-9._-]", "_", paper_id)[:80]
    object_key = f"imports/literature/{job_id}/{safe_id}.pdf"
    # upload_object is sync — run on a thread so the activity event loop
    # is not blocked while MinIO writes 50MiB.
    await asyncio.to_thread(upload_object, object_key, content, "application/pdf")

    return {"object_key": object_key}


def _ssrf_guard(url: str) -> None:
    """Raise ValueError for RFC-1918, loopback, or link-local targets."""
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""

    private_prefixes = ("127.", "169.254.", "0.")
    if any(host.startswith(p) for p in private_prefixes):
        raise ValueError(f"SSRF: blocked private/loopback host: {host}")

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # hostname (not an IP literal) — let DNS resolve at request time.
        return
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        raise ValueError(f"SSRF: blocked IP: {host}")


__all__ = [
    "_normalize_doi",
    "_fetch_arxiv_metadata",
    "_fetch_ss_metadata",
    "fetch_paper_metadata",
    "lit_dedupe_check",
    "create_metadata_note",
    "fetch_and_upload_oa_pdf",
]
