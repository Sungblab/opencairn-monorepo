"""IngestWorkflow — Temporal workflow that dispatches per-mime ingest activities.

Plan 3 Task 2 scaffold: activities are referenced by name so the workflow module
can be imported (and the worker can register it) even before Plan 3 Tasks 3-10
land the concrete activity implementations.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy


@dataclass
class IngestInput:
    """Input to :class:`IngestWorkflow`.

    Either ``object_key`` (uploaded to MinIO/R2) or ``url`` (youtube/web) must
    be set depending on ``mime_type``. ``file_name`` is used for display and
    source-note creation, ``note_id`` pins the result under a parent page.
    """

    object_key: str | None
    file_name: str | None
    mime_type: str
    user_id: str
    project_id: str
    note_id: str | None
    url: str | None = None


_RETRY = RetryPolicy(maximum_attempts=3, backoff_coefficient=2.0)
_LONG_TIMEOUT = timedelta(minutes=30)
_SHORT_TIMEOUT = timedelta(minutes=5)


@workflow.defn(name="IngestWorkflow")
class IngestWorkflow:
    @workflow.run
    async def run(self, inp: IngestInput) -> str:
        mime = inp.mime_type
        text: str = ""
        needs_enhance = False

        if mime == "application/pdf":
            result = await workflow.execute_activity(
                "parse_pdf",
                inp,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_enhance = result.get("has_complex_layout", False)
        elif mime.startswith("audio/") or mime.startswith("video/"):
            result = await workflow.execute_activity(
                "transcribe_audio",
                inp,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]
        elif mime.startswith("image/"):
            result = await workflow.execute_activity(
                "analyze_image",
                inp,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["description"]
        elif mime == "x-opencairn/youtube":
            result = await workflow.execute_activity(
                "ingest_youtube",
                inp,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]
        elif mime == "x-opencairn/web-url":
            result = await workflow.execute_activity(
                "scrape_web_url",
                inp,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_enhance = result.get("has_complex_layout", False)
        else:
            raise ValueError(f"Unsupported mime_type: {mime}")

        if needs_enhance:
            enhanced = await workflow.execute_activity(
                "enhance_with_gemini",
                {**inp.__dict__, "raw_text": text},
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = enhanced.get("text", text)

        note_id: str = await workflow.execute_activity(
            "create_source_note",
            {
                "user_id": inp.user_id,
                "project_id": inp.project_id,
                "parent_note_id": inp.note_id,
                "file_name": inp.file_name,
                "url": inp.url,
                "mime_type": mime,
                "object_key": inp.object_key,
                "text": text,
            },
            schedule_to_close_timeout=_SHORT_TIMEOUT,
            retry_policy=_RETRY,
        )
        return note_id
