"""Generic Markdown export ZIP discovery.

This is intentionally source-agnostic: Obsidian, Bear, and plain folder
exports all enter as a Markdown package rather than provider identities.
"""
from __future__ import annotations

import os
import zipfile
from pathlib import Path
from typing import Any

import yaml
from temporalio import activity

from worker.activities.notion_activities import (
    ZipDefenseError,
    _guess_mime,
    _safe_extract,
    _staging_base,
)


def normalize_markdown_link_target(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("\\", "/")
        .removesuffix(".md")
        .removesuffix(".markdown")
    )


def _display_name(path: Path) -> str:
    name = path.name
    if name.lower().endswith(".markdown"):
        return name[: -len(".markdown")]
    if name.lower().endswith(".md"):
        return name[: -len(".md")]
    return path.stem


def _is_markdown_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in {".md", ".markdown"}


def _parse_frontmatter(text: str) -> dict[str, Any]:
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return {}
    normalized = text.replace("\r\n", "\n")
    end = normalized.find("\n---\n", 4)
    if end < 0:
        return {}
    raw = normalized[4:end]
    parsed = yaml.safe_load(raw) if raw.strip() else {}
    return parsed if isinstance(parsed, dict) else {}


def _link_keys_for_page(rel_path: str, display_name: str) -> set[str]:
    normalized = normalize_markdown_link_target(rel_path)
    basename = normalize_markdown_link_target(display_name)
    return {normalized, basename}


def unzip_and_walk_markdown(
    zip_path: str,
    staging_dir: str,
    *,
    job_id: str,
    original_name: str,
    max_files: int,
    max_uncompressed: int,
) -> dict[str, Any]:
    staging = Path(staging_dir)
    with zipfile.ZipFile(zip_path) as zf:
        _safe_extract(zf, staging, max_files, max_uncompressed)

    nodes: list[dict[str, Any]] = []
    dir_page: dict[Path, int] = {}
    candidate_links: dict[str, list[int]] = {}

    def emit(**kw: Any) -> int:
        idx = len(nodes)
        nodes.append({"idx": idx, **kw})
        return idx

    markdown_files = sorted(p for p in staging.rglob("*") if _is_markdown_file(p))
    for md in markdown_files:
        rel = md.relative_to(staging)
        rel_path = str(rel).replace(os.sep, "/")
        parent_idx = dir_page.get(rel.parent)
        text = md.read_text(encoding="utf-8-sig")
        display = _display_name(md)
        page_idx = emit(
            parent_idx=parent_idx,
            kind="page",
            path=rel_path,
            display_name=display,
            meta={
                "md_path": rel_path,
                "frontmatter": _parse_frontmatter(text),
                "source_format": "markdown",
            },
        )
        dir_page[rel.parent / md.stem] = page_idx
        for key in _link_keys_for_page(rel_path, display):
            candidate_links.setdefault(key, []).append(page_idx)

    for f in sorted(p for p in staging.rglob("*") if p.is_file() and not _is_markdown_file(p)):
        rel = f.relative_to(staging)
        rel_path = str(rel).replace(os.sep, "/")
        parent_idx = dir_page.get(rel.parent)
        emit(
            parent_idx=parent_idx,
            kind="binary",
            path=rel_path,
            display_name=f.name,
            meta={
                "staged_path": rel_path,
                "mime": _guess_mime(f.name),
                "size": f.stat().st_size,
                "source_format": "markdown",
            },
        )

    link_title_map = {
        key: values[0] for key, values in candidate_links.items() if len(values) == 1
    }

    return {
        "job_id": job_id,
        "root_display_name": original_name,
        "nodes": nodes,
        "uuid_link_map": {},
        "link_title_map": link_title_map,
    }


@activity.defn(name="unzip_markdown_export")
async def unzip_markdown_export(payload: dict[str, Any]) -> dict[str, Any]:
    from worker.lib.s3_client import download_to_tempfile

    zip_path = download_to_tempfile(payload["zip_object_key"])
    staging = _staging_base() / payload["job_id"]
    return unzip_and_walk_markdown(
        str(zip_path),
        str(staging),
        job_id=payload["job_id"],
        original_name=payload.get("original_name", "Markdown export"),
        max_files=int(payload["max_files"]),
        max_uncompressed=int(payload["max_uncompressed"]),
    )


__all__ = [
    "ZipDefenseError",
    "normalize_markdown_link_target",
    "unzip_and_walk_markdown",
    "unzip_markdown_export",
]
