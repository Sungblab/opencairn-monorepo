"""MinIO / S3-compatible object storage helper for ingest activities.

Activities download uploaded files from MinIO (local dev) or Cloudflare R2
(production) using the :mod:`minio` client. Endpoint is parsed to strip any
``http://``/``https://`` scheme so it matches ``apps/api/src/lib/s3.ts``.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from minio import Minio

_client: Minio | None = None


def get_s3_client() -> Minio:
    """Return a process-wide :class:`Minio` client, initialised from env vars."""
    global _client
    if _client is None:
        endpoint = os.environ.get("S3_ENDPOINT", "localhost:9000")
        # Strip protocol if present (matches apps/api/src/lib/s3.ts parser).
        if endpoint.startswith("http://"):
            endpoint = endpoint[7:]
        elif endpoint.startswith("https://"):
            endpoint = endpoint[8:]
        _client = Minio(
            endpoint,
            access_key=os.environ.get("S3_ACCESS_KEY", "minioadmin"),
            secret_key=os.environ.get("S3_SECRET_KEY", "minioadmin"),
            secure=os.environ.get("S3_USE_SSL", "false").lower() == "true",
        )
    return _client


def download_to_tempfile(object_key: str) -> Path:
    """Download a MinIO/R2 object to a temp file and return its path.

    Callers are responsible for deleting the returned file (``Path.unlink``)
    once they no longer need it.
    """
    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    suffix = Path(object_key).suffix or ".bin"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    client.fget_object(bucket, object_key, tmp.name)
    tmp.close()
    return Path(tmp.name)


def upload_object(object_key: str, data: bytes, content_type: str) -> None:
    """Upload arbitrary bytes to ``object_key`` in the configured bucket.

    Used by the live-ingest figure-extraction path: the PDF activity uploads
    extracted page figures so the API ``/api/ingest/figures/...`` proxy can
    stream them back to the browser without exposing presigned URLs.
    """
    import io

    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    buf = io.BytesIO(data)
    client.put_object(
        bucket,
        object_key,
        data=buf,
        length=len(data),
        content_type=content_type,
    )


def upload_jsonl(object_key: str, lines: list[dict]) -> None:
    """Write ``lines`` as newline-delimited JSON to ``object_key``.

    Used by the Plan 3b batch-embed pipeline for audit sidecars. We pack
    the bytes in-memory because individual batches are bounded (v0 has
    no caller-side split above a few thousand items), so the JSONL for
    inputs stays well under 10 MiB even at the upper end.
    """
    import io
    import json

    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    payload = "\n".join(json.dumps(line, ensure_ascii=False) for line in lines).encode(
        "utf-8"
    )
    buf = io.BytesIO(payload)
    client.put_object(
        bucket,
        object_key,
        data=buf,
        length=len(payload),
        content_type="application/x-ndjson",
    )


def download_jsonl(object_key: str) -> list[dict]:
    """Read a JSONL blob and return one dict per line.

    Lines that fail to parse are logged and skipped — callers treating
    the sidecar as aligned-by-index should not receive an exception in
    the middle of a run when one row is corrupt.
    """
    import json
    import logging

    logger = logging.getLogger(__name__)
    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    resp = client.get_object(bucket, object_key)
    try:
        data = resp.read()
    finally:
        resp.close()
        resp.release_conn()
    out: list[dict] = []
    for i, raw in enumerate(data.decode("utf-8").splitlines()):
        if not raw.strip():
            continue
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError as exc:
            logger.warning("download_jsonl: bad line %d in %s: %s", i, object_key, exc)
    return out
