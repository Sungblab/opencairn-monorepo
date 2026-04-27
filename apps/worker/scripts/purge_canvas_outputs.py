"""Delete orphaned Plan 7 canvas-outputs from MinIO / R2.

Plan 7 Canvas Phase 2 stores plot artifacts at
``canvas-outputs/<workspaceId>/<noteId>/<contentHash>.{png,svg}`` inside the
shared ``S3_BUCKET`` bucket. The DB row in ``canvas_outputs`` is the source
of truth for "in use"; soft-deleted notes still keep their rows (and so
their objects), but a *hard* note delete cascades the rows away and the
storage object is left dangling.

This script is the cron that finds and deletes those dangling objects:

* List ``canvas-outputs/*`` keys whose ``last_modified`` is older than the
  TTL (default 30 days — the same grace window ops.md documents).
* Filter to the subset with **no matching ``canvas_outputs.s3_key`` row** —
  these are the orphans. In-use rows are left strictly alone, even when
  they're older than the TTL, so an active long-form note doesn't lose
  its figures to a sweep.
* Delete those keys, log per-object failures, keep going.

Usage::

    python -m scripts.purge_canvas_outputs                    # live, 30 days
    python -m scripts.purge_canvas_outputs --max-age-days 7   # tighter sweep
    python -m scripts.purge_canvas_outputs --dry-run          # preview only
    python -m scripts.purge_canvas_outputs --skip-db          # storage-only,
                                                              # treats every aged
                                                              # key as an orphan
                                                              # (use only when
                                                              # the DB is down
                                                              # and you accept
                                                              # gallery 404s)

The script is **best-effort** — a dropped row or a missing object never
crashes the sweep. See ``docs/contributing/ops.md`` § canvas_outputs for
the cron recipe.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Iterable, Protocol

logger = logging.getLogger(__name__)


class _S3Listing(Protocol):
    """Two-method subset of ``minio.Minio`` we exercise from the sweep —
    keeps the unit tests free of any real client dependency."""

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

    Strict ``>``: an object exactly ``max_age_days`` old keeps so that a
    cron running a few seconds past midnight isn't sensitive to clock
    skew. ``now`` is injected so tests pin the wall-clock; production
    passes ``datetime.now(timezone.utc)``.
    """
    cutoff = now - timedelta(days=max_age_days)
    keys: list[str] = []
    for obj in client.list_objects(bucket, prefix, recursive=True):
        last_modified = getattr(obj, "last_modified", None)
        if last_modified is None:
            # Defensive: minio never returns this, but a flaky listing
            # backend shouldn't crash the sweep.
            continue
        if last_modified < cutoff:
            keys.append(obj.object_name)
    return keys


class _DbConn(Protocol):
    """Subset of ``asyncpg.Connection`` we use — `fetch` returning rows
    with a ``__getitem__`` accessor. Tests inject a coroutine fake."""

    async def fetch(self, query: str, *args): ...


async def find_orphan_keys(
    conn: _DbConn,
    *,
    candidates: list[str],
) -> list[str]:
    """Filter ``candidates`` down to keys with **no** matching
    ``canvas_outputs.s3_key`` row. Active rows are skipped — only
    orphan storage is collected."""
    if not candidates:
        return []
    rows = await conn.fetch(
        "SELECT s3_key FROM canvas_outputs WHERE s3_key = ANY($1::text[])",
        candidates,
    )
    in_use = {row["s3_key"] for row in rows}
    return [k for k in candidates if k not in in_use]


def purge_keys(
    client: _S3Listing,
    *,
    bucket: str,
    keys: Iterable[str],
    dry_run: bool,
) -> int:
    """Delete ``keys`` one by one. Returns the count of *successful*
    deletes. Per-object failures are logged and swallowed — a single
    missing object (or a transient 503) shouldn't kill the sweep."""
    purged = 0
    for key in keys:
        if dry_run:
            logger.info("dry-run: would delete s3://%s/%s", bucket, key)
            continue
        try:
            client.remove_object(bucket, key)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "purge_canvas_outputs: delete failed for %s (%s)", key, exc
            )
            continue
        purged += 1
        logger.info("deleted s3://%s/%s", bucket, key)
    return purged


def _build_client():
    # Lazy import so unit tests never instantiate a real Minio client.
    from worker.lib.s3_client import get_s3_client

    return get_s3_client()


def _asyncpg_url(url: str) -> str:
    # Mirror db_readonly._asyncpg_url so SQLAlchemy-style URLs (e.g. the
    # ones some compose templates emit) still connect.
    if url.startswith("postgresql+"):
        return "postgresql://" + url.split("://", 1)[1]
    return url


async def _connect_db():
    import asyncpg  # local import — keeps test discovery cheap

    return await asyncpg.connect(_asyncpg_url(os.environ["DATABASE_URL"]))


async def _filter_orphans_async(candidates: list[str]) -> list[str]:
    conn = await _connect_db()
    try:
        return await find_orphan_keys(conn, candidates=candidates)
    finally:
        await conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-age-days",
        type=int,
        default=int(os.environ.get("CANVAS_OUTPUTS_TTL_DAYS", "30")),
        help="Objects last-modified more than N days ago are eligible (default: 30)",
    )
    parser.add_argument(
        "--prefix",
        default="canvas-outputs/",
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
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help=(
            "Storage-only mode — treat every aged key as an orphan. "
            "Use only when the DB is unreachable; in-use figures will 404."
        ),
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
    aged = find_purgeable_keys(
        client,
        bucket=args.bucket,
        prefix=args.prefix,
        max_age_days=args.max_age_days,
        now=datetime.now(timezone.utc),
    )
    if not aged:
        logger.info(
            "no objects older than %d days under %s",
            args.max_age_days,
            args.prefix,
        )
        return 0
    logger.info(
        "found %d aged objects under %s; filtering against DB",
        len(aged),
        args.prefix,
    )

    if args.skip_db:
        orphans = aged
        logger.warning(
            "--skip-db: deleting all %d aged keys without DB lookup",
            len(aged),
        )
    else:
        orphans = asyncio.run(_filter_orphans_async(aged))
        logger.info(
            "%d/%d aged keys are orphans (no DB row)", len(orphans), len(aged)
        )

    if not orphans:
        return 0
    purged = purge_keys(
        client, bucket=args.bucket, keys=orphans, dry_run=args.dry_run
    )
    logger.info("purged %d objects (dry_run=%s)", purged, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
