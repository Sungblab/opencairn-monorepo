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
