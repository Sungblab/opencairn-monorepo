"""``persist_deep_research_report`` Temporal activity.

Final activity of a run. Uploads any Google-returned images to MinIO,
converts the markdown body to Plate (with image URL mapping applied),
prepends a ``research-meta`` block, then calls the internal API to
create the note. Idempotent via ``idempotencyKey = run_id`` — a retried
activity won't double-write because the API endpoint (Phase C) dedupes
on that key.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from temporalio import activity

from worker.activities.deep_research.cost import estimate_cost_usd_cents
from worker.activities.deep_research.markdown_plate import markdown_to_plate

_BUCKET = os.environ.get("S3_BUCKET_RESEARCH", "opencairn-research")


@dataclass
class PersistReportInput:
    run_id: str
    workspace_id: str
    project_id: str
    user_id: str
    topic: str
    model: str
    billing_path: str
    approved_plan: str
    report_text: str
    # Plain dicts — the workflow passes these straight through from
    # execute_deep_research's dict output so we avoid nested dataclass
    # round-tripping through the Temporal data converter.
    #   image:    {"url": str, "mime_type": str}
    #   citation: {"url": str, "title": str}
    images: list[dict[str, str]] = field(default_factory=list)
    citations: list[dict[str, str]] = field(default_factory=list)
    duration_minutes: float = 20.0


@dataclass
class PersistReportOutput:
    note_id: str
    total_cost_usd_cents: int


FetchImage = Callable[[str], Awaitable[tuple[bytes, str]]]
PutObject = Callable[[str, str, bytes, str], Awaitable[str]]
PostInternal = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


def _extension_for(mime: str) -> str:
    if mime == "image/png":
        return "png"
    if mime == "image/svg+xml":
        return "svg"
    if mime == "image/jpeg":
        return "jpg"
    return "bin"


async def _run_persist_report(
    inp: PersistReportInput,
    *,
    fetch_image_bytes: FetchImage,
    put_object: PutObject,
    post_internal: PostInternal,
) -> PersistReportOutput:
    # 1. Upload images to MinIO. Failures are tolerated — the image stays
    #    at its original URL in the Plate block and the Plate image
    #    renderer surfaces a broken thumbnail. The raw bytes are still in
    #    research_run_artifacts for manual reconciliation.
    image_urls: dict[str, str] = {}
    for seq, img in enumerate(inp.images):
        try:
            data, mime = await fetch_image_bytes(img["url"])
            key = f"research/{inp.workspace_id}/{inp.run_id}/{seq}.{_extension_for(mime)}"
            url = await put_object(_BUCKET, key, data, mime)
            image_urls[img["url"]] = url
        except Exception:
            pass  # Leave out of image_urls; converter keeps original path.

    # 2. Markdown → Plate with the upload map applied.
    plate_body = markdown_to_plate(
        markdown=inp.report_text,
        image_urls=image_urls,
        citations=[
            {"title": c.get("title", ""), "url": c["url"]}
            for c in inp.citations
        ],
    )

    # 3. Prepend research-meta block so it always anchors the top of the page.
    cost_cents = estimate_cost_usd_cents(
        model=inp.model,
        duration_minutes=inp.duration_minutes,
        billing_path=inp.billing_path,  # type: ignore[arg-type]
    )
    meta_block: dict[str, Any] = {
        "type": "research-meta",
        "runId": inp.run_id,
        "model": inp.model,
        "plan": inp.approved_plan,
        "sources": [
            {"title": c.get("title", ""), "url": c["url"], "seq": seq}
            for seq, c in enumerate(inp.citations)
        ],
        "costUsdCents": cost_cents,
        "children": [{"text": ""}],
    }
    plate_value = [meta_block, *plate_body]

    # 4. Create the note via internal API. Idempotent by run id.
    #    The path must include `/api` — Hono mounts internal routes at
    #    `/api/internal`; the bare `/internal/notes` form silently 404s
    #    (audit S4-008).
    response = await post_internal(
        "/api/internal/notes",
        {
            "idempotencyKey": inp.run_id,
            "projectId": inp.project_id,
            "workspaceId": inp.workspace_id,
            "userId": inp.user_id,
            "title": inp.topic,
            "plateValue": plate_value,
        },
    )
    return PersistReportOutput(
        note_id=response["noteId"],
        total_cost_usd_cents=cost_cents,
    )


# --- Production wiring below. Unit tests never hit these. ---


async def _production_fetch_image(url: str) -> tuple[bytes, str]:
    """Read back the image bytes from research_run_artifacts via a
    Phase-C internal endpoint. Returns (bytes, mime_type)."""
    import base64

    from worker.lib.api_client import post_internal

    body = await post_internal(
        "/api/internal/research/image-bytes", {"url": url}
    )
    return base64.b64decode(body["base64"]), body["mimeType"]


async def _production_put_object(
    bucket: str, key: str, data: bytes, content_type: str
) -> str:
    from io import BytesIO

    from worker.lib.s3_client import get_s3_client

    client = get_s3_client()
    client.put_object(
        bucket, key, BytesIO(data), length=len(data), content_type=content_type
    )
    # Path-form URL — the web layer wraps this with a signed URL helper
    # before serving to users.
    return f"/{bucket}/{key}"


async def _production_post_internal(
    path: str, body: dict[str, Any]
) -> dict[str, Any]:
    from worker.lib.api_client import post_internal

    return await post_internal(path, body)


@activity.defn(name="persist_deep_research_report")
async def persist_deep_research_report(
    inp: PersistReportInput,
) -> dict[str, Any]:
    out = await _run_persist_report(
        inp,
        fetch_image_bytes=_production_fetch_image,
        put_object=_production_put_object,
        post_internal=_production_post_internal,
    )
    return {
        "note_id": out.note_id,
        "total_cost_usd_cents": out.total_cost_usd_cents,
    }
