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
        parse_result: dict = {}

        activity_input = _activity_input(inp, workflow_id, started_at_ms)

        if mime == "application/pdf":
            parse_result = await workflow.execute_activity(
                "parse_pdf",
                activity_input,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = parse_result["text"]
            needs_enhance = parse_result.get("has_complex_layout", False)
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

        # [Spec B] Content-aware enrichment compute. Runs *before* the source
        # note is created so we don't have to retroactively patch the row,
        # but the result is stored only after we know the note_id (below).
        # Failures are caught — enrichment is best-effort and never blocks
        # note creation.
        import os as _os

        enrich_result: dict | None = None
        if _os.environ.get("FEATURE_CONTENT_ENRICHMENT") == "true":
            try:
                ct_result = await workflow.execute_activity(
                    "detect_content_type",
                    {
                        "object_key": inp.object_key,
                        "mime_type": inp.mime_type,
                        "parsed_pages": parse_result.get("pages", []),
                    },
                    schedule_to_close_timeout=timedelta(minutes=2),
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
                    retry_policy=RetryPolicy(
                        maximum_attempts=3, backoff_coefficient=2.0
                    ),
                )
            except (ActivityError, ApplicationError):
                workflow.logger.warning(
                    "store_enrichment_artifact failed, artifact lost"
                )

        return note_id
