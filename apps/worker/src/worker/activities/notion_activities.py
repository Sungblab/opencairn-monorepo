"""Notion ZIP ingest + MD → Plate conversion activities.

Task 7 adds the unzip half: given a Notion export ZIP uploaded via the
presigned URL from ``/api/import/notion/upload-url``, walk it into a tree
manifest compatible with the Drive manifest from Task 6. Task 8 will add
the Markdown → Plate JSON converter on top of the same staging output.

The defenses here are deliberately paranoid — a Notion export is a blob
we effectively accept from a logged-in user's browser, so the ZIP itself
is adversary-controlled. ``_safe_extract`` gates on three properties
before writing anything to disk:

* file count (zip-bomb via many tiny files)
* total uncompressed size (zip-bomb via deep compression ratio)
* per-entry path (zip-slip via ``../`` escape)

Each defense raises a distinct ``ZipDefenseError`` subtype string so the
caller can map the failure to an i18n'd user-facing message.
"""
from __future__ import annotations

import os
import re
import zipfile
from pathlib import Path
from typing import Any

from temporalio import activity


class ZipDefenseError(Exception):
    """Raised when a ZIP fails one of the pre-extract safety checks."""


# Notion suffixes an md file's stem with " <32-char-hex>" derived from the
# page's canonical ID. The trailing lookahead keeps us from matching when
# the 32 hex run happens to sit inside a longer name without a boundary.
_UUID_RE = re.compile(r" ([0-9a-f]{32})(?=\.md$|/|$)", re.IGNORECASE)


def _strip_uuid(name: str) -> tuple[str, str | None]:
    """Split ``"Foo <id>"`` into ``("Foo", "<id>")``.

    ``name`` should already have any ``.md`` suffix removed (we tolerate
    both for defense-in-depth against callers forgetting). A trailing ``/``
    is also tolerated because walk_dir passes Path.name for directories.
    """
    cleaned = name.rstrip("/").removesuffix(".md")
    m = _UUID_RE.search(cleaned)
    if m:
        return cleaned.replace(m.group(0), "", 1), m.group(1)
    return cleaned, None


def _safe_extract(
    zf: zipfile.ZipFile,
    staging: Path,
    max_files: int,
    max_uncompressed: int,
) -> list[zipfile.ZipInfo]:
    """Extract all entries into ``staging``, enforcing the 3 defenses.

    Returns the ZipInfo list on success. The caller doesn't need it for
    the walk but it's useful when the activity wants to report totals.
    """
    infos = zf.infolist()
    if len(infos) > max_files:
        raise ZipDefenseError(f"too_many_files: {len(infos)} > {max_files}")
    total = sum(i.file_size for i in infos)
    if total > max_uncompressed:
        raise ZipDefenseError(
            f"uncompressed_too_large: {total} > {max_uncompressed}"
        )

    staging.mkdir(parents=True, exist_ok=True)
    staging_resolved = staging.resolve()

    for info in infos:
        target = (staging / info.filename).resolve()
        # target must either be the staging dir itself (allowed if the zip
        # lists the top-level dir) OR sit strictly underneath it. os.sep
        # keeps this cross-platform — starts-with "staging/" vs "staging\".
        if target != staging_resolved and not str(target).startswith(
            str(staging_resolved) + os.sep
        ):
            raise ZipDefenseError(f"zip_slip: {info.filename}")
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as dst:
            dst.write(src.read())

    return infos


def _guess_mime(name: str) -> str:
    """Extension-based MIME guess. Conservative — unknowns become
    ``application/octet-stream`` so the ingest step can route them to the
    binary-unknown quarantine rather than trying to parse them."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "csv": "text/csv",
        "mp3": "audio/mpeg",
        "mp4": "video/mp4",
        "md": "text/markdown",
        "txt": "text/plain",
    }.get(ext, "application/octet-stream")


def unzip_and_walk(
    zip_path: str,
    staging_dir: str,
    max_files: int,
    max_uncompressed: int,
) -> dict[str, Any]:
    """Extract a Notion export ZIP into ``staging_dir`` and return a manifest.

    Manifest shape mirrors the Drive discovery output so the materialize
    step in Task 9 can consume either source via a single codepath:
        {
          root_display_name: str,
          nodes: [{idx, parent_idx, kind, path, display_name, meta}],
          uuid_link_map: {notion_id: page_idx},
        }

    Notion export layout:
        Page A <id>.md              ← becomes a page node
        Page A <id>/                ← companion folder (same basename, no .md)
            Child B <id>.md         ← child page
            Child B <id>/           ← child's companion folder
                img.png             ← attachment (binary)
            Tasks <id>.csv          ← sibling database (binary, not a page)
    """
    staging = Path(staging_dir)
    with zipfile.ZipFile(zip_path) as zf:
        _safe_extract(zf, staging, max_files, max_uncompressed)

    nodes: list[dict[str, Any]] = []
    uuid_link_map: dict[str, int] = {}

    def emit(**kw: Any) -> int:
        idx = len(nodes)
        nodes.append({"idx": idx, **kw})
        return idx

    def walk_dir(dir_path: Path, parent_idx: int | None, rel_path: str) -> None:
        entries = sorted(dir_path.iterdir())
        md_files = [e for e in entries if e.is_file() and e.suffix == ".md"]
        other_files = [e for e in entries if e.is_file() and e.suffix != ".md"]
        subdir_by_stem = {e.name: e for e in entries if e.is_dir()}

        for md in md_files:
            display, uuid = _strip_uuid(md.stem)
            sub_rel = f"{rel_path}/{md.name}".lstrip("/")
            page_idx = emit(
                parent_idx=parent_idx,
                kind="page",
                path=sub_rel,
                display_name=display,
                meta={
                    "uuid": uuid,
                    "md_path": str(md.relative_to(staging)).replace(os.sep, "/"),
                },
            )
            if uuid:
                uuid_link_map[uuid] = page_idx
            # Companion folder holds the page's own children + attachments.
            companion = subdir_by_stem.pop(md.stem, None)
            if companion:
                walk_dir(
                    companion,
                    page_idx,
                    f"{rel_path}/{md.stem}".lstrip("/"),
                )

        for f in other_files:
            kind_rel = f"{rel_path}/{f.name}".lstrip("/")
            emit(
                parent_idx=parent_idx,
                kind="binary",
                path=kind_rel,
                display_name=f.name,
                meta={
                    "staged_path": str(f.relative_to(staging)).replace(os.sep, "/"),
                    "mime": _guess_mime(f.name),
                    "size": f.stat().st_size,
                },
            )

        # Any remaining subdirs have no matching .md (rare — stray folders in
        # the export). Recurse as plain containers so their contents still
        # land in the manifest.
        for leftover in subdir_by_stem.values():
            walk_dir(
                leftover,
                parent_idx,
                f"{rel_path}/{leftover.name}".lstrip("/"),
            )

    walk_dir(staging, parent_idx=None, rel_path="")

    return {
        "root_display_name": "Notion import",
        "nodes": nodes,
        "uuid_link_map": uuid_link_map,
    }


def _staging_base() -> Path:
    """Where the activity stages unzipped files. Overridable via env so
    Windows dev machines (and CI) aren't forced into the /var path."""
    return Path(
        os.environ.get(
            "NOTION_IMPORT_STAGING_DIR",
            "/var/opencairn/import-staging",
        )
    )


@activity.defn(name="unzip_notion_export")
async def unzip_notion_export(payload: dict[str, Any]) -> dict[str, Any]:
    """Download the Notion export ZIP from MinIO, extract it, and return
    a tree manifest. Activity-side envelope only; real work is in
    :func:`unzip_and_walk` so unit tests can bypass S3.
    """
    from worker.lib.s3_client import download_to_tempfile

    zip_path = download_to_tempfile(payload["zip_object_key"])
    staging = _staging_base() / payload["job_id"]
    return unzip_and_walk(
        str(zip_path),
        staging_dir=str(staging),
        max_files=int(payload["max_files"]),
        max_uncompressed=int(payload["max_uncompressed"]),
    )


__all__ = [
    "ZipDefenseError",
    "_safe_extract",
    "_strip_uuid",
    "unzip_and_walk",
    "unzip_notion_export",
]
