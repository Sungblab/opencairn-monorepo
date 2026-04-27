"""IngestWorkflow — Temporal workflow that dispatches per-mime ingest activities.

Plan 3 Task 2 scaffold + Plan: live-ingest-visualization Task 6.

The workflow now also threads ``workflow_id`` and ``started_at_ms`` into every
activity input so the per-activity event emitters (Tasks 3-5) can publish
IngestEvents without each activity needing to read Temporal context. Workflows
are deterministic and may not talk to Redis directly — the small ``emit_started``
activity exists for the same reason: it forwards to ``publish_safe`` for us.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError


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


_QUARANTINE_RETRY = RetryPolicy(maximum_attempts=2, backoff_coefficient=2.0)


def _activity_input(inp: IngestInput, workflow_id: str, started_at_ms: int, **extra) -> dict:
    """Build the dict passed to an ingest activity, with workflow context fields."""
    return {
        **inp.__dict__,
        "workflow_id": workflow_id,
        "started_at_ms": started_at_ms,
        **extra,
    }


@workflow.defn(name="IngestWorkflow")
class IngestWorkflow:
    @workflow.run
    async def run(self, inp: IngestInput) -> str:
        workflow_id = workflow.info().workflow_id
        started_at_ms = int(workflow.now().timestamp() * 1000)

        # Best-effort: emit the started event before parsing kicks off so
        # the spotlight overlay can paint a frame immediately.
        try:
            await workflow.execute_activity(
                "emit_started",
                {
                    "workflow_id": workflow_id,
                    "payload": {
                        "mime": inp.mime_type,
                        "fileName": inp.file_name,
                        "url": inp.url,
                        "totalUnits": None,
                    },
                },
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_QUARANTINE_RETRY,
            )
        except ActivityError:
            # Visibility layer must never break ingest. Fall through.
            pass

        try:
            return await self._run_pipeline(inp, workflow_id, started_at_ms)
        except ActivityError as exc:
            # Plan 3 Task 10 — dead-letter on repeated activity failure.
            # Quarantine + reporting are best-effort; the original ActivityError
            # is always re-raised so Temporal marks the workflow FAILED.
            reason = str(exc.cause or exc)[:500]
            quarantine_key: str | None = None
            if inp.object_key:
                try:
                    result = await workflow.execute_activity(
                        "quarantine_source",
                        {
                            "object_key": inp.object_key,
                            "user_id": inp.user_id,
                            "reason": reason,
                        },
                        schedule_to_close_timeout=_SHORT_TIMEOUT,
                        retry_policy=_QUARANTINE_RETRY,
                    )
                    quarantine_key = result.get("quarantine_key")
                except ActivityError:
                    pass  # quarantine best-effort; don't mask original error
            try:
                await workflow.execute_activity(
                    "report_ingest_failure",
                    {
                        "user_id": inp.user_id,
                        "project_id": inp.project_id,
                        "url": inp.url,
                        "object_key": inp.object_key,
                        "quarantine_key": quarantine_key,
                        "reason": reason,
                        "workflow_id": workflow_id,
                    },
                    schedule_to_close_timeout=_SHORT_TIMEOUT,
                    retry_policy=_QUARANTINE_RETRY,
                )
            except ActivityError:
                pass  # reporting is best-effort
            raise

    async def _run_pipeline(
        self, inp: IngestInput, workflow_id: str, started_at_ms: int
    ) -> str:
        mime = inp.mime_type
        text: str = ""
        needs_enhance = False

        activity_input = _activity_input(inp, workflow_id, started_at_ms)

        if mime == "application/pdf":
            result = await workflow.execute_activity(
                "parse_pdf",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_enhance = result.get("has_complex_layout", False)
        elif mime.startswith("audio/") or mime.startswith("video/"):
            result = await workflow.execute_activity(
                "transcribe_audio",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]
        elif mime.startswith("image/"):
            result = await workflow.execute_activity(
                "analyze_image",
                activity_input,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["description"]
        elif mime == "x-opencairn/youtube":
            result = await workflow.execute_activity(
                "ingest_youtube",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]
        elif mime == "x-opencairn/web-url":
            result = await workflow.execute_activity(
                "scrape_web_url",
                activity_input,
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
                _activity_input(inp, workflow_id, started_at_ms, raw_text=text),
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
                "workflow_id": workflow_id,
                "started_at_ms": started_at_ms,
            },
            schedule_to_close_timeout=_SHORT_TIMEOUT,
            retry_policy=_RETRY,
        )
        return note_id
