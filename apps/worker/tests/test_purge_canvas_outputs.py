"""Unit tests for :mod:`scripts.purge_canvas_outputs`.

Plan 7 Phase 2 stores plot artifacts under ``canvas-outputs/*`` with the
DB row in ``canvas_outputs`` as the source of truth for "in use". The
30-day cron must be **orphan-only**: aged storage objects with no
matching DB row are deleted, in-use rows are left alone (otherwise an
active long-form note would lose its figures to a sweep).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from scripts.purge_canvas_outputs import (
    find_orphan_keys,
    find_purgeable_keys,
    purge_keys,
)


@dataclass
class _FakeObject:
    object_name: str
    last_modified: datetime


class _FakeClient:
    def __init__(self, objects: list[_FakeObject]):
        self._objects = objects
        self.removed: list[tuple[str, str]] = []
        self.remove_raises: dict[str, Exception] = {}

    def list_objects(self, bucket: str, prefix: str, recursive: bool = True):
        assert recursive, "lifecycle sweep must recurse the whole prefix"
        assert prefix.endswith("/"), "prefix should be directory-like"
        for obj in self._objects:
            if obj.object_name.startswith(prefix):
                yield obj

    def remove_object(self, bucket: str, object_name: str) -> None:
        if object_name in self.remove_raises:
            raise self.remove_raises[object_name]
        self.removed.append((bucket, object_name))


class _FakeRow(dict):
    """Minimal asyncpg.Record stand-in supporting `row['col']` access."""


class _FakeConn:
    def __init__(self, in_use: set[str]):
        self._in_use = in_use
        self.queries: list[tuple[str, tuple]] = []

    async def fetch(self, query: str, *args):
        self.queries.append((query, args))
        # The real query is `s3_key = ANY($1::text[])`; we mirror that
        # filter against the in-use set.
        candidates: list[str] = list(args[0]) if args else []
        return [_FakeRow(s3_key=k) for k in candidates if k in self._in_use]


def _at(days_ago: int, now: datetime | None = None) -> datetime:
    now = now or datetime(2026, 4, 26, 12, 0, tzinfo=timezone.utc)
    return now - timedelta(days=days_ago)


class TestFindPurgeableKeys:
    def test_returns_keys_older_than_threshold(self) -> None:
        now = datetime(2026, 4, 26, 12, 0, tzinfo=timezone.utc)
        client = _FakeClient(
            [
                _FakeObject("canvas-outputs/ws/note/old.png", _at(40, now)),
                _FakeObject("canvas-outputs/ws/note/new.png", _at(2, now)),
                _FakeObject("canvas-outputs/ws/note/mid.svg", _at(31, now)),
            ]
        )
        keys = find_purgeable_keys(
            client,
            bucket="bucket",
            prefix="canvas-outputs/",
            max_age_days=30,
            now=now,
        )
        assert sorted(keys) == [
            "canvas-outputs/ws/note/mid.svg",
            "canvas-outputs/ws/note/old.png",
        ]

    def test_exactly_at_threshold_is_not_purged(self) -> None:
        now = datetime(2026, 4, 26, 12, 0, tzinfo=timezone.utc)
        client = _FakeClient(
            [
                _FakeObject(
                    "canvas-outputs/ws/n/x.png",
                    now - timedelta(days=30),
                ),
            ]
        )
        keys = find_purgeable_keys(
            client,
            bucket="bucket",
            prefix="canvas-outputs/",
            max_age_days=30,
            now=now,
        )
        assert keys == []

    def test_prefix_scoping_ignores_other_buckets_paths(self) -> None:
        """Embedding sidecars + ingest uploads share the bucket — the
        sweep must not touch them."""
        now = datetime(2026, 4, 26, 12, 0, tzinfo=timezone.utc)
        client = _FakeClient(
            [
                _FakeObject("uploads/old.pdf", _at(100, now)),
                _FakeObject("embeddings/batch/old.jsonl", _at(50, now)),
                _FakeObject("canvas-outputs/ws/n/keep.png", _at(1, now)),
            ]
        )
        keys = find_purgeable_keys(
            client,
            bucket="bucket",
            prefix="canvas-outputs/",
            max_age_days=30,
            now=now,
        )
        assert keys == []


class TestFindOrphanKeys:
    @pytest.mark.asyncio
    async def test_filters_in_use_keys_out(self) -> None:
        conn = _FakeConn(
            in_use={"canvas-outputs/ws/n/in-use.png"},
        )
        orphans = await find_orphan_keys(
            conn,
            candidates=[
                "canvas-outputs/ws/n/orphan-a.png",
                "canvas-outputs/ws/n/in-use.png",
                "canvas-outputs/ws/n/orphan-b.svg",
            ],
        )
        assert sorted(orphans) == [
            "canvas-outputs/ws/n/orphan-a.png",
            "canvas-outputs/ws/n/orphan-b.svg",
        ]
        # The DB query was sent with the candidate list as a parameter
        # so Postgres can plan a single index scan.
        assert len(conn.queries) == 1
        assert "ANY($1::text[])" in conn.queries[0][0]

    @pytest.mark.asyncio
    async def test_empty_candidates_skips_db(self) -> None:
        conn = _FakeConn(in_use=set())
        orphans = await find_orphan_keys(conn, candidates=[])
        assert orphans == []
        assert conn.queries == []  # no point in a 0-row IN clause

    @pytest.mark.asyncio
    async def test_all_in_use_returns_empty(self) -> None:
        conn = _FakeConn(in_use={"canvas-outputs/ws/n/a.png"})
        orphans = await find_orphan_keys(
            conn,
            candidates=["canvas-outputs/ws/n/a.png"],
        )
        assert orphans == []


class TestPurgeKeys:
    def test_removes_each_key_once(self) -> None:
        client = _FakeClient([])
        purged = purge_keys(
            client,
            bucket="bucket",
            keys=["canvas-outputs/ws/n/a.png", "canvas-outputs/ws/n/b.svg"],
            dry_run=False,
        )
        assert purged == 2
        assert client.removed == [
            ("bucket", "canvas-outputs/ws/n/a.png"),
            ("bucket", "canvas-outputs/ws/n/b.svg"),
        ]

    def test_dry_run_does_not_delete(self) -> None:
        client = _FakeClient([])
        purged = purge_keys(
            client,
            bucket="bucket",
            keys=["canvas-outputs/ws/n/a.png"],
            dry_run=True,
        )
        assert purged == 0
        assert client.removed == []

    def test_continues_past_per_object_errors(self) -> None:
        client = _FakeClient([])
        client.remove_raises["canvas-outputs/ws/n/b.svg"] = RuntimeError(
            "race: already gone"
        )
        purged = purge_keys(
            client,
            bucket="bucket",
            keys=[
                "canvas-outputs/ws/n/a.png",
                "canvas-outputs/ws/n/b.svg",
                "canvas-outputs/ws/n/c.png",
            ],
            dry_run=False,
        )
        assert purged == 2
        assert client.removed == [
            ("bucket", "canvas-outputs/ws/n/a.png"),
            ("bucket", "canvas-outputs/ws/n/c.png"),
        ]
