"""Unit tests for :mod:`scripts.purge_embedding_jsonl`.

Plan 3b §AD-3 specifies a 7-day retention on ``embeddings/batch/*`` JSONL
sidecars. R2 configures this via a lifecycle rule; MinIO dev doesn't
(the community edition has limited lifecycle support), so the worker
image ships a CLI script that operators can cron. These tests pin the
selection + deletion logic so the "which keys" question has a single
source of truth regardless of bucket backend.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from scripts.purge_embedding_jsonl import find_purgeable_keys, purge_keys


@dataclass
class _FakeObject:
    """Shape-compatible stand-in for minio.datatypes.Object."""

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


def _at(days_ago: int, now: datetime | None = None) -> datetime:
    now = now or datetime(2026, 4, 25, 12, 0, tzinfo=UTC)
    return now - timedelta(days=days_ago)


class TestFindPurgeableKeys:
    def test_returns_keys_older_than_threshold(self) -> None:
        now = datetime(2026, 4, 25, 12, 0, tzinfo=UTC)
        client = _FakeClient(
            [
                _FakeObject("embeddings/batch/a/input.jsonl", _at(10, now)),
                _FakeObject("embeddings/batch/b/input.jsonl", _at(3, now)),
                _FakeObject("embeddings/batch/c/output.jsonl", _at(8, now)),
            ]
        )
        keys = find_purgeable_keys(
            client, bucket="bucket", prefix="embeddings/batch/",
            max_age_days=7, now=now,
        )
        assert sorted(keys) == [
            "embeddings/batch/a/input.jsonl",
            "embeddings/batch/c/output.jsonl",
        ]

    def test_exactly_at_threshold_is_not_purged(self) -> None:
        """A 7-day-old object at exactly the boundary keeps — easier to
        reason about for ops (strict > rather than >=)."""
        now = datetime(2026, 4, 25, 12, 0, tzinfo=UTC)
        client = _FakeClient(
            [
                _FakeObject(
                    "embeddings/batch/x/input.jsonl",
                    now - timedelta(days=7),
                ),
            ]
        )
        keys = find_purgeable_keys(
            client, bucket="bucket", prefix="embeddings/batch/",
            max_age_days=7, now=now,
        )
        assert keys == []

    def test_prefix_scoping_ignores_unrelated_paths(self) -> None:
        """The sweep must not touch ingest uploads / research artifacts
        (different prefixes) even if they're older."""
        now = datetime(2026, 4, 25, 12, 0, tzinfo=UTC)
        client = _FakeClient(
            [
                _FakeObject("uploads/old.pdf", _at(100, now)),
                _FakeObject("research/run-1/report.md", _at(50, now)),
                _FakeObject(
                    "embeddings/batch/keep/input.jsonl", _at(1, now)
                ),
            ]
        )
        keys = find_purgeable_keys(
            client, bucket="bucket", prefix="embeddings/batch/",
            max_age_days=7, now=now,
        )
        assert keys == []

    def test_empty_bucket_returns_empty(self) -> None:
        now = datetime(2026, 4, 25, 12, 0, tzinfo=UTC)
        client = _FakeClient([])
        keys = find_purgeable_keys(
            client, bucket="bucket", prefix="embeddings/batch/",
            max_age_days=7, now=now,
        )
        assert keys == []


class TestPurgeKeys:
    def test_removes_each_key_once(self) -> None:
        client = _FakeClient([])
        purged = purge_keys(
            client,
            bucket="bucket",
            keys=["a/1.jsonl", "b/2.jsonl"],
            dry_run=False,
        )
        assert purged == 2
        assert client.removed == [
            ("bucket", "a/1.jsonl"),
            ("bucket", "b/2.jsonl"),
        ]

    def test_dry_run_does_not_delete(self) -> None:
        client = _FakeClient([])
        purged = purge_keys(
            client,
            bucket="bucket",
            keys=["a/1.jsonl", "b/2.jsonl"],
            dry_run=True,
        )
        assert purged == 0
        assert client.removed == []

    def test_continues_past_per_object_errors(self) -> None:
        """One bad object shouldn't stop the rest of the sweep — ops
        wants best-effort progress, not a crashy nightly cron."""
        client = _FakeClient([])
        client.remove_raises["b/2.jsonl"] = RuntimeError("race: already gone")
        purged = purge_keys(
            client,
            bucket="bucket",
            keys=["a/1.jsonl", "b/2.jsonl", "c/3.jsonl"],
            dry_run=False,
        )
        assert purged == 2  # a and c
        assert client.removed == [
            ("bucket", "a/1.jsonl"),
            ("bucket", "c/3.jsonl"),
        ]
