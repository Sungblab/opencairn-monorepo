"""Smoke tests confirming each non-PDF ingest activity emits the expected
IngestEvents when a ``workflow_id`` is present in its input.

We patch the heavy I/O (provider calls, MinIO downloads, ffmpeg/yt_dlp,
post_internal) and only assert on the publish_safe call list.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

if TYPE_CHECKING:
    from pathlib import Path


def _publish_recorder(bag: list[tuple[str, dict]]):
    async def fake_publish(_wfid, kind, payload):
        bag.append((kind, payload))

    return fake_publish


@pytest.mark.asyncio
async def test_image_activity_emits_parsing_stage(tmp_path: Path):
    from worker.activities.image_activity import analyze_image

    image_path = tmp_path / "img.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\n")

    bag: list[tuple[str, dict]] = []
    fake_provider = MagicMock()
    fake_provider.generate_multimodal = AsyncMock(return_value="caption")

    with (
        patch("worker.activities.image_activity.download_to_tempfile", return_value=image_path),
        patch("worker.activities.image_activity.get_provider", return_value=fake_provider),
        patch("worker.activities.image_activity.publish_safe", side_effect=_publish_recorder(bag)),
    ):
        await analyze_image(
            {
                "object_key": "uploads/u/img.png",
                "mime_type": "image/png",
                "workflow_id": "wf-img",
            }
        )

    assert any(kind == "stage_changed" and p["stage"] == "parsing" for kind, p in bag)


@pytest.mark.asyncio
async def test_enhance_activity_emits_enhancing_stage():
    from worker.activities.enhance_activity import enhance_with_gemini

    bag: list[tuple[str, dict]] = []
    fake_provider = MagicMock()
    fake_provider.generate = AsyncMock(return_value="enhanced")
    fake_provider.generate_multimodal = AsyncMock(return_value=None)

    with (
        patch("worker.activities.enhance_activity.get_provider", return_value=fake_provider),
        patch(
            "worker.activities.enhance_activity.publish_safe", side_effect=_publish_recorder(bag)
        ),
        patch("worker.activities.enhance_activity.activity.heartbeat"),
    ):
        await enhance_with_gemini(
            {
                "raw_text": "some raw text",
                "mime_type": "text/plain",
                "workflow_id": "wf-enh",
            }
        )

    assert any(kind == "stage_changed" and p["stage"] == "enhancing" for kind, p in bag)


@pytest.mark.asyncio
async def test_create_source_note_emits_persisting_and_completed():
    from worker.activities.note_activity import create_source_note

    bag: list[tuple[str, dict]] = []

    post_internal = AsyncMock(return_value={"noteId": "11111111-1111-1111-1111-111111111111"})
    with (
        patch(
            "worker.activities.note_activity.post_internal",
            new=post_internal,
        ),
        patch("worker.activities.note_activity.publish_safe", side_effect=_publish_recorder(bag)),
    ):
        await create_source_note(
            {
                "user_id": "u",
                "project_id": "p",
                "parent_note_id": None,
                "file_name": "x.pdf",
                "url": None,
                "mime_type": "application/pdf",
                "object_key": "uploads/u/x.pdf",
                "text": "hello",
                "workflow_id": "wf-c",
                "started_at_ms": 1_000,
                "tree_label": "full_extract_note",
                "original_file_node_id": "22222222-2222-4222-8222-222222222222",
            }
        )

    kinds = [k for k, _ in bag]
    assert "stage_changed" in kinds
    assert any(k == "stage_changed" and p["stage"] == "persisting" for k, p in bag)
    assert "completed" in kinds
    completed_payload = next(p for k, p in bag if k == "completed")
    assert completed_payload["noteId"] == "11111111-1111-1111-1111-111111111111"
    assert completed_payload["totalDurationMs"] >= 0
    assert (
        post_internal.await_args.args[1]["originalFileNodeId"]
        == "22222222-2222-4222-8222-222222222222"
    )
    assert post_internal.await_args.args[1]["treeLabel"] == "full_extract_note"


@pytest.mark.asyncio
async def test_report_ingest_failure_emits_failed():
    from worker.activities.note_activity import report_ingest_failure

    bag: list[tuple[str, dict]] = []

    post_internal = AsyncMock(return_value={})
    with (
        patch("worker.activities.note_activity.post_internal", new=post_internal),
        patch("worker.activities.note_activity.publish_safe", side_effect=_publish_recorder(bag)),
    ):
        await report_ingest_failure(
            {
                "user_id": "u",
                "project_id": "p",
                "url": None,
                "object_key": "uploads/u/x.pdf",
                "original_file_node_id": "22222222-2222-4222-8222-222222222222",
                "quarantine_key": "quarantine/u/2026-04/x.pdf",
                "reason": "network timeout",
                "workflow_id": "wf-f",
            }
        )

    failed = next(p for k, p in bag if k == "failed")
    assert failed["reason"] == "network timeout"
    assert failed["retryable"] is True
    assert failed["quarantineKey"] == "quarantine/u/2026-04/x.pdf"
    assert (
        post_internal.await_args.args[1]["originalFileNodeId"]
        == "22222222-2222-4222-8222-222222222222"
    )
