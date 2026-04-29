"""fetch_sources_activity — collect source content for synthesis export.

Two modes (composable):
  1. explicit_source_ids — uploaded files (s3_object) the user picked
  2. note_ids — Plate notes the user picked
  3. auto_search (toggle) — semantic search on workspace notes via api

Token budget (180K) caps the bundle; excess sources are persisted with
included=false so the UI can show "auto-excluded".
"""
from __future__ import annotations

from temporalio import activity

from worker.activities.synthesis_export.types import (
    SourceBundle,
    SourceItem,
    SynthesisRunParams,
)
from worker.lib.api_client import patch_internal, post_internal

TOKEN_BUDGET = 180_000


async def _set_status(run_id: str, status: str) -> None:
    await patch_internal(
        f"/api/internal/synthesis-export/runs/{run_id}",
        {"status": status},
    )


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


async def _fetch_s3_object(source_id: str) -> dict:
    return await post_internal(
        "/api/internal/synthesis-export/fetch-source",
        {"source_id": source_id, "kind": "s3_object"},
    )


async def _fetch_note(note_id: str) -> dict:
    return await post_internal(
        "/api/internal/synthesis-export/fetch-source",
        {"source_id": note_id, "kind": "note"},
    )


async def _semantic_search(workspace_id: str, query: str, limit: int = 10) -> list[dict]:
    res = await post_internal(
        "/api/internal/synthesis-export/auto-search",
        {"workspace_id": workspace_id, "query": query, "limit": limit},
    )
    return res.get("hits", [])


async def _persist_sources(run_id: str, rows: list[dict]) -> None:
    await post_internal(
        "/api/internal/synthesis-export/sources",
        {"run_id": run_id, "rows": rows},
    )


@activity.defn(name="fetch_sources_activity")
async def fetch_sources_activity(params: SynthesisRunParams) -> SourceBundle:
    activity.heartbeat("fetching sources")
    await _set_status(params.run_id, "fetching")
    items: list[SourceItem] = []

    for sid in params.explicit_source_ids:
        raw = await _fetch_s3_object(sid)
        items.append(SourceItem(
            id=raw["id"], title=raw.get("title", sid),
            body=raw.get("body", ""), token_count=_approx_tokens(raw.get("body", "")),
            kind="s3_object",
        ))
        activity.heartbeat(f"fetched s3:{sid}")

    for nid in params.note_ids:
        raw = await _fetch_note(nid)
        items.append(SourceItem(
            id=raw["id"], title=raw.get("title", nid),
            body=raw.get("body", ""), token_count=_approx_tokens(raw.get("body", "")),
            kind="note",
        ))
        activity.heartbeat(f"fetched note:{nid}")

    if params.auto_search:
        hits = await _semantic_search(params.workspace_id, params.user_prompt, limit=10)
        for h in hits:
            items.append(SourceItem(
                id=h["id"], title=h.get("title", ""), body=h.get("body", ""),
                token_count=_approx_tokens(h.get("body", "")), kind="note",
            ))

    items.sort(key=lambda it: it.token_count)
    included: list[SourceItem] = []
    excluded: list[SourceItem] = []
    used = 0
    for it in items:
        if used + it.token_count <= TOKEN_BUDGET:
            included.append(it)
            used += it.token_count
        else:
            excluded.append(it)

    rows = [
        {"source_id": it.id, "kind": it.kind, "title": it.title,
         "token_count": it.token_count, "included": True}
        for it in included
    ] + [
        {"source_id": it.id, "kind": it.kind, "title": it.title,
         "token_count": it.token_count, "included": False}
        for it in excluded
    ]
    await _persist_sources(params.run_id, rows)

    return SourceBundle(items=included)
