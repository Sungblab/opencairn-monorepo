"""``persist_deep_research_report`` — last activity of a run.

Steps:
  1. For each image ref, fetch bytes (Phase B: via a callback stubbed in
     tests; Phase C wires production to an internal API endpoint that
     reads the base64 from research_run_artifacts).
  2. Upload to MinIO at research/{workspace_id}/{run_id}/{seq}.{ext}.
  3. Convert the report markdown → Plate using the Task 9 helper.
  4. Prepend a research-meta block.
  5. POST /internal/notes with the Plate value + idempotency key = run_id.
  6. Return the new note id + estimated cost cents.
"""
from __future__ import annotations

import asyncio

from worker.activities.deep_research.persist_report import (
    PersistReportInput,
    PersistReportOutput,
    _run_persist_report,
)


def test_happy_path_uploads_images_and_creates_note():
    uploaded: list[tuple[str, bytes]] = []
    posted: list[dict] = []

    async def _fetch_image(url: str) -> tuple[bytes, str]:
        return b"\x89PNGfake" + url.encode(), "image/png"

    async def _put_object(bucket: str, key: str, data: bytes, content_type: str) -> str:
        assert bucket
        uploaded.append((key, data))
        return f"https://minio.local/{bucket}/{key}"

    async def _post_internal(path: str, body: dict) -> dict:
        posted.append({"path": path, "body": body})
        return {"noteId": "note-xyz"}

    result = asyncio.run(
        _run_persist_report(
            PersistReportInput(
                run_id="run-1",
                workspace_id="ws-1",
                project_id="proj-1",
                user_id="user-1",
                topic="Topic",
                model="deep-research-preview-04-2026",
                billing_path="byok",
                approved_plan="Plan text",
                report_text="# H\n\nBody with ![c1](gs://a.png)",
                images=[{"url": "gs://a.png", "mime_type": "image/png"}],
                citations=[{"url": "https://example.com/s", "title": "S"}],
                duration_minutes=15.0,
            ),
            fetch_image_bytes=_fetch_image,
            put_object=_put_object,
            post_internal=_post_internal,
        )
    )

    assert isinstance(result, PersistReportOutput)
    assert result.note_id == "note-xyz"
    assert isinstance(result.total_cost_usd_cents, int)
    assert result.total_cost_usd_cents > 0

    # One image uploaded under the workspace-scoped prefix.
    assert len(uploaded) == 1
    assert uploaded[0][0].startswith("research/ws-1/run-1/")

    # Internal POST shape. The path must include the `/api` prefix the Hono
    # router mounts at (`app.route("/api/internal", internalRoutes)`); the
    # `/internal/notes` form silently 404s in production (audit S4-008).
    assert posted[0]["path"] == "/api/internal/notes"
    body = posted[0]["body"]
    assert body["title"] == "Topic"
    assert body["projectId"] == "proj-1"
    assert body["userId"] == "user-1"
    assert body["workspaceId"] == "ws-1"
    assert body["idempotencyKey"] == "run-1"

    # Plate value must start with the research-meta block.
    plate = body["plateValue"]
    assert plate[0]["type"] == "research-meta"
    assert plate[0]["runId"] == "run-1"
    assert plate[0]["model"] == "deep-research-preview-04-2026"
    assert plate[0]["plan"] == "Plan text"
    assert plate[0]["sources"][0]["url"] == "https://example.com/s"


def test_image_fetch_failure_does_not_abort_the_run():
    async def _fetch_image(_url: str):
        raise RuntimeError("Google transient")

    async def _put_object(*_args, **_kwargs):
        raise AssertionError("should not be called when fetch failed")

    async def _post_internal(_path: str, _body: dict) -> dict:
        return {"noteId": "note-xyz"}

    result = asyncio.run(
        _run_persist_report(
            PersistReportInput(
                run_id="run-1",
                workspace_id="ws-1",
                project_id="proj-1",
                user_id="user-1",
                topic="Topic",
                model="deep-research-preview-04-2026",
                billing_path="byok",
                approved_plan="Plan",
                report_text="Body with ![x](gs://a.png)",
                images=[{"url": "gs://a.png", "mime_type": "image/png"}],
                citations=[],
                duration_minutes=10.0,
            ),
            fetch_image_bytes=_fetch_image,
            put_object=_put_object,
            post_internal=_post_internal,
        )
    )
    # Note still created; the image stays at its original gs:// URL in the
    # Plate block (renders as broken image — ops can reconcile from artifacts).
    assert result.note_id == "note-xyz"


def test_idempotency_key_is_run_id():
    posted: list[dict] = []

    async def _fetch_image(_url: str):
        raise AssertionError("no images in this test")

    async def _put_object(*_args, **_kwargs):
        raise AssertionError("no uploads in this test")

    async def _post_internal(path: str, body: dict) -> dict:
        posted.append(body)
        return {"noteId": "note-xyz"}

    asyncio.run(
        _run_persist_report(
            PersistReportInput(
                run_id="custom-run-42",
                workspace_id="ws-1",
                project_id="proj-1",
                user_id="user-1",
                topic="T",
                model="deep-research-preview-04-2026",
                billing_path="byok",
                approved_plan="P",
                report_text="Just some body text.",
                images=[],
                citations=[],
                duration_minutes=20.0,
            ),
            fetch_image_bytes=_fetch_image,
            put_object=_put_object,
            post_internal=_post_internal,
        )
    )
    assert posted[0]["idempotencyKey"] == "custom-run-42"
