"""Source hydration for worker-backed document generation."""

from __future__ import annotations

import asyncio
from typing import Any

from temporalio import activity

from worker.activities.document_generation.generate import (
    heartbeat_safe,
    normalize_generation,
    normalize_params,
)
from worker.activities.document_generation.types import (
    DocumentGenerationSourceBundle,
    DocumentGenerationSourceItem,
    DocumentGenerationWorkflowParams,
)
from worker.lib.api_client import post_internal

SOURCE_TOKEN_BUDGET = 40_000
SOURCE_HYDRATION_CONCURRENCY = 8


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


async def _hydrate_note(source: dict[str, Any]) -> DocumentGenerationSourceItem:
    source_id = str(source["noteId"])
    raw = await post_internal(
        "/api/internal/synthesis-export/fetch-source",
        {"source_id": source_id, "kind": "note"},
    )
    body = str(raw.get("body") or "")
    return DocumentGenerationSourceItem(
        id=str(raw.get("id") or source_id),
        title=str(raw.get("title") or source_id),
        body=body,
        kind="note",
        token_count=_approx_tokens(body),
    )


async def _hydrate_source(
    source: dict[str, Any],
    semaphore: asyncio.Semaphore,
) -> DocumentGenerationSourceItem:
    async with semaphore:
        source_type = source.get("type")
        heartbeat_safe(f"hydrating document source {source_type}")
        if source_type == "note":
            return await _hydrate_note(source)
        return _reference_only_source(source)


def _reference_only_source(source: dict[str, Any]) -> DocumentGenerationSourceItem:
    kind = str(source.get("type") or "source")
    source_id = str(
        source.get("objectId")
        or source.get("threadId")
        or source.get("runId")
        or source.get("noteId")
        or "unknown"
    )
    title = {
        "agent_file": "Project object",
        "chat_thread": "Chat thread",
        "research_run": "Research run",
        "synthesis_run": "Synthesis run",
    }.get(kind, kind)
    return DocumentGenerationSourceItem(
        id=source_id,
        title=title,
        body=f"{kind}: {source_id}",
        kind=kind,
        token_count=_approx_tokens(source_id),
    )


def _fit_budget(items: list[DocumentGenerationSourceItem]) -> list[DocumentGenerationSourceItem]:
    included: list[DocumentGenerationSourceItem] = []
    used = 0
    for item in sorted(items, key=lambda source: source.token_count):
        if used + item.token_count <= SOURCE_TOKEN_BUDGET:
            included.append(item)
            used += item.token_count
        else:
            included.append(
                DocumentGenerationSourceItem(
                    id=item.id,
                    title=item.title,
                    body="",
                    kind=item.kind,
                    token_count=item.token_count,
                    included=False,
                )
            )
    return included


@activity.defn(name="hydrate_document_generation_sources")
async def hydrate_document_generation_sources(
    params: DocumentGenerationWorkflowParams | dict[str, Any],
) -> DocumentGenerationSourceBundle:
    normalized = normalize_params(params)
    generation = normalize_generation(normalized.generation)
    semaphore = asyncio.Semaphore(SOURCE_HYDRATION_CONCURRENCY)
    hydrated = await asyncio.gather(
        *(_hydrate_source(source, semaphore) for source in generation.sources)
    )

    return DocumentGenerationSourceBundle(items=_fit_budget(hydrated))
