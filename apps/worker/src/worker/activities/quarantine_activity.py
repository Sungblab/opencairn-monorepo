"""Quarantine (dead-letter) activity.

Plan 3 Task 10. Called by :class:`worker.workflows.ingest_workflow.IngestWorkflow`
when the per-MIME parsing chain fails after 3 retries. Moves the failed source
object from the upload bucket to a quarantine prefix so admins can inspect
failures without polluting the live upload namespace.

Uses the MinIO SDK via :func:`worker.lib.s3_client.get_s3_client` (the worker
standard; boto3 is *not* installed here). The destination key is
``{INGEST_QUARANTINE_PREFIX}{user_id}/{yyyy-mm}/{basename}``. If the copy or
delete fails (e.g. the source is already gone), we log the error and still
return the computed target key — the workflow re-raises the original ingest
error, so the quarantine failure must not mask it.
"""
from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import PurePosixPath

from minio.commonconfig import CopySource
from temporalio import activity

from worker.lib.s3_client import get_s3_client

QUARANTINE_PREFIX = os.environ.get("INGEST_QUARANTINE_PREFIX", "quarantine/")
BUCKET = os.environ.get("S3_BUCKET", "opencairn-uploads")


@activity.defn(name="quarantine_source")
async def quarantine_source(inp: dict) -> dict:
    """Copy a failed source under the quarantine prefix and delete the original.

    Returns ``{"quarantine_key": str}``. Safe to call multiple times — if the
    source is already gone, logs a warning and returns the computed quarantine
    key so the workflow can still report it via ``report_ingest_failure``.
    """
    client = get_s3_client()
    src_key: str = inp["object_key"]
    user_id: str = inp["user_id"]
    reason: str = inp.get("reason", "unknown")

    ym = datetime.now(UTC).strftime("%Y-%m")
    base = PurePosixPath(src_key).name or "unknown.bin"
    prefix = (
        QUARANTINE_PREFIX
        if QUARANTINE_PREFIX.endswith("/")
        else QUARANTINE_PREFIX + "/"
    )
    new_key = f"{prefix}{user_id}/{ym}/{base}"

    try:
        client.copy_object(
            bucket_name=BUCKET,
            object_name=new_key,
            source=CopySource(BUCKET, src_key),
        )
        client.remove_object(BUCKET, src_key)
        activity.logger.warning(
            "Quarantined %s -> %s (reason: %s)", src_key, new_key, reason
        )
    except Exception as exc:  # noqa: BLE001
        # Idempotency: if original already gone, still return the target key.
        # Quarantine is best-effort; we must not mask the original ingest error.
        activity.logger.warning(
            "quarantine_source: copy/delete failed for %s -> %s: %s",
            src_key,
            new_key,
            exc,
        )
    return {"quarantine_key": new_key}
