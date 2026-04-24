"""Delete stale Plan 3b batch-embed JSONL sidecars from MinIO / R2.

Plan 3b §AD-3 specifies a 7-day retention on ``embeddings/batch/*`` —
request + response JSONL blobs. R2 handles this via a bucket lifecycle
rule. MinIO (local dev, and some self-hosted deployments) doesn't ship
lifecycle out of the box on the community edition, so operators run
this script via cron instead.

Usage::

    python -m scripts.purge_embedding_jsonl                  # live, 7 days
    python -m scripts.purge_embedding_jsonl --max-age-days 3 # tighter sweep
    python -m scripts.purge_embedding_jsonl --dry-run        # preview only

The script is **storage-only** — it never touches ``embedding_batches``
rows. DB rows are small and live for audit (billing reconciliation,
ops debugging). See ``docs/contributing/ops.md`` for the scheduling
recipe.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Iterable, Protocol

logger = logging.getLogger(__name__)


# Protocol captures the ~two methods we use off ``minio.Minio`` so tests
# can inject a fake without pulling in the real client.
class _S3Listing(Protocol):
    def list_objects(self, bucket: str, prefix: str, recursive: bool = ...): ...

    def remove_object(self, bucket: str, object_name: str) -> None: ...


def find_purgeable_keys(
    client: _S3Listing,
    *,
    bucket: str,
    prefix: str,
    max_age_days: int,
    now: datetime,
) -> list[str]:
    """Return object keys older than ``max_age_days`` under ``prefix``.

    Uses strict greater-than on age so the boundary case (exactly
    ``max_age_days`` old) is spared — predictable for ops scripts that
    run slightly past midnight. ``now`` is injected so tests can pin
    wall-clock; production passes ``datetime.now(timezone.utc)``.
    """
    cutoff = now - timedelta(days=max_age_days)
    keys: list[str] = []
    for obj in client.list_objects(bucket, prefix, recursive=True):
        last_modified = getattr(obj, "last_modified", None)
        if last_modified is None:
            # Defensive: unexpected, but don't crash the sweep.
            continue
        if last_modified < cutoff:
            keys.append(obj.object_name)
    return keys


def purge_keys(
    client: _S3Listing,
    *,
    bucket: str,
    keys: Iterable[str],
    dry_run: bool,
) -> int:
    """Delete ``keys`` one at a time. Returns the count of *successful*
    deletes. Per-object errors are logged and swallowed so one missing
    object doesn't kill the rest of the sweep.
    """
    purged = 0
    for key in keys:
        if dry_run:
            logger.info("dry-run: would delete s3://%s/%s", bucket, key)
            continue
        try:
            client.remove_object(bucket, key)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "purge_embedding_jsonl: delete failed for %s (%s)", key, exc
            )
            continue
        purged += 1
        logger.info("deleted s3://%s/%s", bucket, key)
    return purged


def _build_client():
    # Imported lazily so unit tests never instantiate a real Minio
    # client (which would try to connect on some operations).
    from worker.lib.s3_client import get_s3_client

    return get_s3_client()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-age-days",
        type=int,
        default=int(os.environ.get("BATCH_EMBED_JSONL_TTL_DAYS", "7")),
        help="Objects last-modified more than N days ago are deleted (default: 7)",
    )
    parser.add_argument(
        "--prefix",
        default="embeddings/batch/",
        help="S3 prefix to sweep (must end with /).",
    )
    parser.add_argument(
        "--bucket",
        default=os.environ.get("S3_BUCKET", "opencairn-uploads"),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be deleted without touching storage.",
    )
    args = parser.parse_args(argv)

    if not args.prefix.endswith("/"):
        print("--prefix must end with '/'", file=sys.stderr)
        return 2
    if args.max_age_days < 1:
        print("--max-age-days must be >= 1", file=sys.stderr)
        return 2

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    client = _build_client()
    keys = find_purgeable_keys(
        client,
        bucket=args.bucket,
        prefix=args.prefix,
        max_age_days=args.max_age_days,
        now=datetime.now(timezone.utc),
    )
    if not keys:
        logger.info("no objects older than %d days under %s", args.max_age_days, args.prefix)
        return 0
    logger.info("found %d purgeable objects under %s", len(keys), args.prefix)
    purged = purge_keys(
        client, bucket=args.bucket, keys=keys, dry_run=args.dry_run
    )
    logger.info("purged %d objects (dry_run=%s)", purged, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
