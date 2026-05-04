from __future__ import annotations

import zipfile
from typing import TYPE_CHECKING

import pytest

from worker.activities.markdown_import_activities import (
    ZipDefenseError,
    normalize_markdown_link_target,
    unzip_and_walk_markdown,
)

if TYPE_CHECKING:
    from pathlib import Path


def _zip(path: Path, files: dict[str, bytes | str]) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        for name, body in files.items():
            data = body.encode("utf-8") if isinstance(body, str) else body
            zf.writestr(name, data)


def _manifest(tmp_path: Path, files: dict[str, bytes | str]) -> dict:
    zip_path = tmp_path / "vault.zip"
    staging = tmp_path / "staging"
    _zip(zip_path, files)
    return unzip_and_walk_markdown(
        str(zip_path),
        str(staging),
        job_id="job-1",
        original_name="vault.zip",
        max_files=100,
        max_uncompressed=1024 * 1024,
    )


def test_rejects_zip_slip(tmp_path: Path) -> None:
    zip_path = tmp_path / "bad.zip"
    _zip(zip_path, {"../evil.md": "# nope"})

    with pytest.raises(ZipDefenseError, match="zip_slip"):
        unzip_and_walk_markdown(
            str(zip_path),
            str(tmp_path / "staging"),
            job_id="job-1",
            original_name="bad.zip",
            max_files=100,
            max_uncompressed=1024 * 1024,
        )


def test_rejects_file_count_cap(tmp_path: Path) -> None:
    zip_path = tmp_path / "many.zip"
    _zip(zip_path, {"a.md": "A", "b.md": "B"})

    with pytest.raises(ZipDefenseError, match="too_many_files"):
        unzip_and_walk_markdown(
            str(zip_path),
            str(tmp_path / "staging"),
            job_id="job-1",
            original_name="many.zip",
            max_files=1,
            max_uncompressed=1024 * 1024,
        )


def test_markdown_pages_and_attachments_become_manifest_nodes(tmp_path: Path) -> None:
    manifest = _manifest(
        tmp_path,
        {
            "Index.md": "# Home",
            "Index/image.png": b"png",
            "Folder/Linked.markdown": "linked",
        },
    )

    pages = [n for n in manifest["nodes"] if n["kind"] == "page"]
    binaries = [n for n in manifest["nodes"] if n["kind"] == "binary"]
    assert [p["path"] for p in pages] == ["Folder/Linked.markdown", "Index.md"]
    assert binaries[0]["path"] == "Index/image.png"
    assert binaries[0]["parent_idx"] == next(p["idx"] for p in pages if p["path"] == "Index.md")
    assert binaries[0]["meta"]["mime"] == "image/png"


def test_markdown_parent_page_is_processed_before_child_page(tmp_path: Path) -> None:
    manifest = _manifest(
        tmp_path,
        {
            "Folder/File.md": "# Child",
            "Folder.markdown": "# Parent",
        },
    )

    parent = next(n for n in manifest["nodes"] if n["path"] == "Folder.markdown")
    child = next(n for n in manifest["nodes"] if n["path"] == "Folder/File.md")
    assert parent["idx"] < child["idx"]
    assert child["parent_idx"] == parent["idx"]


def test_frontmatter_is_captured(tmp_path: Path) -> None:
    manifest = _manifest(
        tmp_path,
        {"Note.md": "---\ntags:\n  - research\ndraft: true\n---\n# Body"},
    )

    page = manifest["nodes"][0]
    assert page["meta"]["frontmatter"] == {"tags": ["research"], "draft": True}
    assert page["meta"]["source_format"] == "markdown"


def test_malformed_frontmatter_is_ignored(tmp_path: Path) -> None:
    manifest = _manifest(
        tmp_path,
        {"Note.md": "---\ntags: [broken\n---\n# Body"},
    )

    page = manifest["nodes"][0]
    assert "frontmatter" not in page["meta"]
    assert page["meta"]["source_format"] == "markdown"


def test_invalid_utf8_markdown_does_not_crash_discovery(tmp_path: Path) -> None:
    manifest = _manifest(
        tmp_path,
        {"Note.md": b"# Title\n\nbad byte: \xff\n"},
    )

    assert manifest["nodes"][0]["path"] == "Note.md"
    assert manifest["nodes"][0]["kind"] == "page"


def test_rejects_manifest_above_temporal_payload_budget(tmp_path: Path) -> None:
    zip_path = tmp_path / "large.zip"
    staging = tmp_path / "staging"
    _zip(zip_path, {"Note.md": "# Body"})

    with pytest.raises(ZipDefenseError, match="manifest_too_large"):
        unzip_and_walk_markdown(
            str(zip_path),
            str(staging),
            job_id="job-1",
            original_name="vault.zip",
            max_files=100,
            max_uncompressed=1024 * 1024,
            max_manifest_bytes=1,
        )


def test_wikilink_targets_are_normalized_and_unambiguous(tmp_path: Path) -> None:
    manifest = _manifest(
        tmp_path,
        {
            "Index.md": "[[My Note]]",
            "folder/My Note.MD": "target",
        },
    )
    target_idx = next(n["idx"] for n in manifest["nodes"] if n["path"] == "folder/My Note.MD")

    assert manifest["link_title_map"]["my note"] == target_idx
    assert manifest["link_title_map"]["folder/my note"] == target_idx
    assert normalize_markdown_link_target("My Note.Markdown") == "my note"
    assert normalize_markdown_link_target("folder\\My Note.md") == "folder/my note"
