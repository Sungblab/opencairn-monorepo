"""Unit tests for the Notion ZIP unzip + walk activity.

We build the fixture ZIP at test time rather than committing a binary —
the file is trivially small and rebuilding on every run makes it obvious
what the shape is. Defenses (zip-slip, file-count, bomb) are exercised
against adversarial zips generated per-test so the fixture stays clean.
"""
from __future__ import annotations

import tempfile
import zipfile
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    import pathlib

from worker.activities.notion_activities import (
    ZipDefenseError,
    unzip_and_walk,
)

# Real Notion page IDs are 32-char hex. Hard-code three valid-length ids for
# the small fixture so the UUID regex matches the same way it would in prod.
ROOT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
CHILD_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
TASKS_ID = "cccccccccccccccccccccccccccccccc"


@pytest.fixture
def notion_small_zip(tmp_path: pathlib.Path) -> pathlib.Path:
    """Build a minimal Notion-like export ZIP in a temp dir.

    Shape:
        My Workspace <root>.md
        My Workspace <root>/
            Child Page <child>.md
            Child Page <child>/
                img.png
            Tasks <tasks>.csv
    """
    out = tmp_path / "notion_small.zip"
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(
            f"My Workspace {ROOT_ID}.md",
            f"# My Workspace\n\nWelcome.\n\n"
            f"- [Child Page](./My%20Workspace%20{ROOT_ID}/"
            f"Child%20Page%20{CHILD_ID}.md)\n",
        )
        z.writestr(
            f"My Workspace {ROOT_ID}/Child Page {CHILD_ID}.md",
            f"# Child Page\n\nSome text with "
            f"![embedded](./Child%20Page%20{CHILD_ID}/img.png)\n",
        )
        z.writestr(
            f"My Workspace {ROOT_ID}/Child Page {CHILD_ID}/img.png",
            b"\x89PNG\r\n\x1a\n" + b"\x00" * 16,
        )
        z.writestr(
            f"My Workspace {ROOT_ID}/Tasks {TASKS_ID}.csv",
            "Name,Status\nA,Done\nB,Todo\n",
        )
    return out


def test_unzip_small_fixture(notion_small_zip: pathlib.Path) -> None:
    with tempfile.TemporaryDirectory() as staging:
        manifest = unzip_and_walk(
            str(notion_small_zip),
            staging_dir=staging,
            max_files=10_000,
            max_uncompressed=100 * 1024 * 1024,
        )
    pages = [n for n in manifest["nodes"] if n["kind"] == "page"]
    binaries = [n for n in manifest["nodes"] if n["kind"] == "binary"]
    assert len(pages) == 2
    assert len(binaries) == 2

    # Exactly one root (parent_idx=None). Its display_name has the UUID
    # suffix stripped and the trailing " " trimmed.
    root_pages = [n for n in pages if n["parent_idx"] is None]
    assert len(root_pages) == 1
    assert root_pages[0]["display_name"] == "My Workspace"

    # Child page is nested under the root.
    child_pages = [n for n in pages if n["parent_idx"] == root_pages[0]["idx"]]
    assert len(child_pages) == 1
    assert child_pages[0]["display_name"] == "Child Page"

    # UUID-link-map resolves both page ids the workflow will later need to
    # rewrite cross-page Markdown links against.
    assert ROOT_ID in manifest["uuid_link_map"]
    assert CHILD_ID in manifest["uuid_link_map"]
    # CSV is not a page → its id must NOT appear in the link map.
    assert TASKS_ID not in manifest["uuid_link_map"]


def test_rejects_zip_slip(tmp_path: pathlib.Path) -> None:
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("../../../etc/passwd", "pwned")
    with (
        tempfile.TemporaryDirectory() as staging,
        pytest.raises(ZipDefenseError, match="zip_slip"),
    ):
        unzip_and_walk(
            str(evil),
            staging_dir=staging,
            max_files=10,
            max_uncompressed=1_000_000,
        )


def test_rejects_too_many_files(tmp_path: pathlib.Path) -> None:
    big = tmp_path / "big.zip"
    with zipfile.ZipFile(big, "w") as z:
        for i in range(20):
            z.writestr(f"file{i}.md", "# hi")
    with (
        tempfile.TemporaryDirectory() as staging,
        pytest.raises(ZipDefenseError, match="too_many_files"),
    ):
        unzip_and_walk(
            str(big),
            staging_dir=staging,
            max_files=10,
            max_uncompressed=1_000_000,
        )


def test_rejects_bomb(tmp_path: pathlib.Path) -> None:
    bomb = tmp_path / "bomb.zip"
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("big.txt", "A" * 10_000_000)
    with (
        tempfile.TemporaryDirectory() as staging,
        pytest.raises(ZipDefenseError, match="uncompressed_too_large"),
    ):
        unzip_and_walk(
            str(bomb),
            staging_dir=staging,
            max_files=10,
            max_uncompressed=1_000_000,
        )
