"""IngestWorkflow — Temporal workflow that dispatches per-mime ingest activities.

Plan 3 Task 2 scaffold + Plan: live-ingest-visualization Task 6.

The workflow now also threads ``workflow_id`` and ``started_at_ms`` into every
activity input so the per-activity event emitters (Tasks 3-5) can publish
IngestEvents without each activity needing to read Temporal context. Workflows
are deterministic and may not talk to Redis directly — the small ``emit_started``
activity exists for the same reason: it forwards to ``publish_safe`` for us.
"""
from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError


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
    # Spec B — needed by the enrichment activities to scope artifact storage.
    workspace_id: str | None = None
    # Temporal workflows must not read process env during replay. The caller
    # captures the feature flag at workflow start and passes it as input.
    content_enrichment_enabled: bool = False


_RETRY = RetryPolicy(maximum_attempts=3, backoff_coefficient=2.0)
_LONG_TIMEOUT = timedelta(minutes=30)
_SHORT_TIMEOUT = timedelta(minutes=5)

# Heartbeat budgets (S3-006). Without ``heartbeat_timeout`` Temporal can't
# distinguish a hung worker from a long-running activity; it would wait the
# full ``schedule_to_close_timeout`` (5-30 min) before retrying. We pair every
# activity dispatch below with a heartbeat budget proportional to its work
# shape:
#
# * ``_LONG_HEARTBEAT`` (120 s) — for activities backed by long external work
#   (LibreOffice / markitdown / Gemini multimodal / STT / opendataloader-pdf).
#   The budget has to cover a single blocking call that cannot heartbeat from
#   inside (Gemini ``generate_multimodal`` on a large PDF, ``markitdown`` on
#   a heavy PPTX, ``unoconvert`` cold-start). 60 s tripped on Gemini p99 +
#   LibreOffice cold paths in review (PR #160 review thread); 120 s holds
#   p99 with margin while still detecting a wedged worker an order of
#   magnitude faster than the 5-30 min schedule_to_close. A robust
#   background-heartbeat helper that pings every N seconds during awaited
#   single calls is a separate follow-up and would let us drop this budget
#   back toward 30 s.
# * ``_SHORT_HEARTBEAT`` (30 s) — for activities that are mostly DB writes,
#   Redis publishes, or short LLM calls under the 5-min schedule.
#
# Activity bodies that span multiple sub-steps still call
# ``activity.heartbeat()`` between them — see ``office_activity.py`` for the
# canonical pattern. ``test_ingest_heartbeat.py`` pins both the static
# dispatch sites and the runtime kwarg.
_LONG_HEARTBEAT = timedelta(seconds=120)
_SHORT_HEARTBEAT = timedelta(seconds=30)


_QUARANTINE_RETRY = RetryPolicy(maximum_attempts=2, backoff_coefficient=2.0)


# Office MIMEs handled by ``parse_office``. Mirrors
# ``apps/api/src/routes/ingest.ts``'s allowlist for the OOXML + legacy
# binary set; HWP/HWPX go through ``parse_hwp`` instead because they need
# the H2Orestart extension path, not markitdown.
_OFFICE_MIMES = frozenset({
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.ms-powerpoint",
    "application/vnd.ms-excel",
})

_HWP_MIMES = frozenset({
    "application/x-hwp",
    "application/haansofthwp",
    "application/vnd.hancom.hwp",
    "application/vnd.hancom.hwpx",
})

_TEXT_MIMES = frozenset({
    "text/plain",
    "text/markdown",
})


def _activity_input(inp: IngestInput, workflow_id: str, started_at_ms: int, **extra) -> dict:
    """Build the dict passed to an ingest activity, with workflow context fields."""
    return {
        **inp.__dict__,
        "workflow_id": workflow_id,
        "started_at_ms": started_at_ms,
        **extra,
    }


def _read_text_object_bytes(object_key: str) -> bytes:
    """Download and read a text object using blocking object-store/file APIs."""
    from worker.lib.s3_client import download_to_tempfile

    path = download_to_tempfile(object_key)
    try:
        return path.read_bytes()
    finally:
        path.unlink(missing_ok=True)


@activity.defn(name="read_text_object")
async def read_text_object(inp: dict) -> dict[str, str]:
    """Read a UTF-8 text/markdown upload from object storage."""
    object_key = inp.get("object_key")
    if not object_key:
        raise ApplicationError(
            "object_key is required for text ingest",
            non_retryable=True,
        )

    raw = await asyncio.to_thread(_read_text_object_bytes, str(object_key))

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ApplicationError(
            "text ingest supports UTF-8 encoded text only",
            non_retryable=True,
        ) from exc
    return {"text": text}


@workflow.defn(name="IngestWorkflow")
class IngestWorkflow:
    @workflow.run
    async def run(self, inp: IngestInput) -> str:
        workflow_id = workflow.info().workflow_id
        started_at_ms = int(workflow.now().timestamp() * 1000)

        # Best-effort: emit the started event before parsing kicks off so
        # the spotlight overlay can paint a frame immediately.
        with contextlib.suppress(ActivityError):
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
                heartbeat_timeout=_SHORT_HEARTBEAT,
                retry_policy=_QUARANTINE_RETRY,
            )

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
                        heartbeat_timeout=_SHORT_HEARTBEAT,
                        retry_policy=_QUARANTINE_RETRY,
                    )
                    quarantine_key = result.get("quarantine_key")
                except ActivityError:
                    pass  # quarantine best-effort; don't mask original error
            with contextlib.suppress(ActivityError):
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
                    heartbeat_timeout=_SHORT_HEARTBEAT,
                    retry_policy=_QUARANTINE_RETRY,
                )
            raise

    async def _run_pipeline(
        self, inp: IngestInput, workflow_id: str, started_at_ms: int
    ) -> str:
        mime = inp.mime_type
        text: str = ""
        needs_enhance = False
        parse_result: dict = {}

        activity_input = _activity_input(inp, workflow_id, started_at_ms)

        if mime == "application/pdf":
            parse_result = await workflow.execute_activity(
                "parse_pdf",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                heartbeat_timeout=_LONG_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = parse_result["text"]
            needs_enhance = parse_result.get("has_complex_layout", False)
        elif mime.startswith("audio/") or mime.startswith("video/"):
            result = await workflow.execute_activity(
                "transcribe_audio",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                heartbeat_timeout=_LONG_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]
        elif mime.startswith("image/"):
            result = await workflow.execute_activity(
                "analyze_image",
                activity_input,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                heartbeat_timeout=_SHORT_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = result["description"]
        elif mime == "x-opencairn/youtube":
            result = await workflow.execute_activity(
                "ingest_youtube",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                heartbeat_timeout=_LONG_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]
        elif mime == "x-opencairn/web-url":
            result = await workflow.execute_activity(
                "scrape_web_url",
                activity_input,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                heartbeat_timeout=_SHORT_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_enhance = result.get("has_complex_layout", False)
        elif mime in _TEXT_MIMES:
            result = await workflow.execute_activity(
                "read_text_object",
                activity_input,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                heartbeat_timeout=_SHORT_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = result["text"]
        elif mime in _OFFICE_MIMES:
            # Plan 3 follow-up Office/HWP. parse_office returns
            # {text, viewer_pdf_object_key, has_complex_layout}; we drop
            # the viewer key on the floor for now (no consumer wired yet)
            # and pass text/complex flag through the same shape as PDF.
            result = await workflow.execute_activity(
                "parse_office",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                heartbeat_timeout=_LONG_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_enhance = result.get("has_complex_layout", False)
        elif mime in _HWP_MIMES:
            # HWP/HWPX go through unoserver+H2Orestart → opendataloader-pdf.
            result = await workflow.execute_activity(
                "parse_hwp",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                heartbeat_timeout=_LONG_HEARTBEAT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_enhance = result.get("has_complex_layout", False)
        else:
            raise ValueError(f"Unsupported mime_type: {mime}")

        # [Spec B] Content-aware enrichment compute. Runs *before* the source
        # note is created so we don't have to retroactively patch the row,
        # but the result is stored only after we know the note_id (below).
        # Failures are caught — enrichment is best-effort and never blocks
        # note creation.
        enrich_result: dict | None = None
        if inp.content_enrichment_enabled:
            try:
                ct_result = await workflow.execute_activity(
                    "detect_content_type",
                    {
                        "object_key": inp.object_key,
                        "mime_type": inp.mime_type,
                        "parsed_pages": parse_result.get("pages", []),
                    },
                    schedule_to_close_timeout=timedelta(minutes=2),
                    heartbeat_timeout=_SHORT_HEARTBEAT,
                    retry_policy=RetryPolicy(
                        maximum_attempts=2, backoff_coefficient=2.0
                    ),
                )
                enrich_result = await workflow.execute_activity(
                    "enrich_document",
                    _activity_input(
                        inp,
                        workflow_id,
                        started_at_ms,
                        content_type=ct_result["content_type"],
                        parsed_pages=parse_result.get("pages", []),
                        requested_enrichments=[
                            "outline",
                            "figures",
                            "tables",
                            "translation",
                        ],
                    ),
                    schedule_to_close_timeout=timedelta(minutes=20),
                    heartbeat_timeout=_LONG_HEARTBEAT,
                    retry_policy=RetryPolicy(
                        maximum_attempts=2, backoff_coefficient=2.0
                    ),
                )
            except (ActivityError, ApplicationError):
                # Enrichment is best-effort. We catch only Temporal-surfaced
                # activity errors, not bare Exception — workflow-level bugs
                # (typos, missing keys) should still crash so they surface
                # in dev. The feature flag protects prod regardless.
                workflow.logger.warning(
                    "enrichment failed, continuing without artifact"
                )

        if needs_enhance:
            enhanced = await workflow.execute_activity(
                "enhance_with_gemini",
                _activity_input(inp, workflow_id, started_at_ms, raw_text=text),
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                heartbeat_timeout=_SHORT_HEARTBEAT,
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
            heartbeat_timeout=_SHORT_HEARTBEAT,
            retry_policy=_RETRY,
        )

        # [Spec B] Persist artifact once we have the note_id. Best-effort —
        # if storage fails the artifact is lost but the note is fine.
        if enrich_result is not None:
            try:
                await workflow.execute_activity(
                    "store_enrichment_artifact",
                    {
                        "note_id": note_id,
                        "workspace_id": inp.workspace_id or "",
                        **enrich_result,
                    },
                    schedule_to_close_timeout=timedelta(minutes=1),
                    heartbeat_timeout=_SHORT_HEARTBEAT,
                    retry_policy=RetryPolicy(
                        maximum_attempts=3, backoff_coefficient=2.0
                    ),
                )
            except (ActivityError, ApplicationError):
                workflow.logger.warning(
                    "store_enrichment_artifact failed, artifact lost"
                )

        return note_id
