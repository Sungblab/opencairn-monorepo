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
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote, urlparse

from markdown_it import MarkdownIt
from temporalio import activity

if TYPE_CHECKING:
    from collections.abc import Callable

    from markdown_it.token import Token


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


# ─────────────────────────────────────────────────────────────────────────────
# Task 8: Markdown → Plate converter
# ─────────────────────────────────────────────────────────────────────────────
#
# We work directly off markdown-it's token stream rather than an HTML
# intermediate. Plate elements (especially wikilink, which has a noteId
# attribute) can't round-trip through HTML cleanly, and a token walker is
# simpler than trying to rehydrate cross-references after the fact.


# Link hrefs from Notion exports look like
#   ../Other%20Page%20abc123....md
# We match the 32-char hex id immediately before `.md` at the end of the
# URL path. Narrower than _UUID_RE above (no leading space, end-anchored).
_UUID_IN_LINK = re.compile(r"([0-9a-f]{32})(?=\.md$)", re.IGNORECASE)
_WIKILINK_RE = re.compile(r"\[\[([^\]\|#]+)(?:[#\|][^\]]*)?\]\]")


def _text_leaf(text: str, **marks: Any) -> dict[str, Any]:
    return {"text": text, **marks}


def _flatten_inline(
    tokens: list[Token],
    *,
    uuid_link_map: dict[str, int],
    idx_to_note_id: dict[int, str],
    link_title_map: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Walk markdown-it inline tokens and emit Plate leaves + link elements.

    Bold/italic/code marks are tracked in a mutable dict keyed by mark name;
    each emitted text leaf snapshots the current mark set. Links are tracked
    on a stack so their children collect text pushed between link_open and
    link_close. A link resolves to a ``wikilink`` element when the href
    matches a known Notion id, otherwise a regular ``a`` element (keeping
    the original href so dead cross-page links still show something
    clickable in the editor).
    """
    out: list[dict[str, Any]] = []
    marks: dict[str, bool] = {}
    link_stack: list[dict[str, Any]] = []

    def sink() -> list[dict[str, Any]]:
        return link_stack[-1]["children"] if link_stack else out

    def push_text(text: str) -> None:
        if not link_title_map or "[[" not in text:
            sink().append(_text_leaf(text, **marks))
            return
        pos = 0
        for match in _WIKILINK_RE.finditer(text):
            if match.start() > pos:
                sink().append(_text_leaf(text[pos : match.start()], **marks))
            target = match.group(1).strip()
            key = target.lower().replace("\\", "/").removesuffix(".md").removesuffix(
                ".markdown"
            )
            idx = link_title_map.get(key)
            note_id = idx_to_note_id.get(idx) if idx is not None else None
            label = target.rsplit("/", 1)[-1]
            if note_id:
                sink().append(
                    {
                        "type": "wikilink",
                        "noteId": note_id,
                        "label": label,
                        "children": [_text_leaf(label)],
                    }
                )
            else:
                sink().append(_text_leaf(match.group(0), **marks))
            pos = match.end()
        if pos < len(text):
            sink().append(_text_leaf(text[pos:], **marks))

    for t in tokens:
        if t.type == "text":
            push_text(t.content)
        elif t.type == "strong_open":
            marks["bold"] = True
        elif t.type == "strong_close":
            marks.pop("bold", None)
        elif t.type == "em_open":
            marks["italic"] = True
        elif t.type == "em_close":
            marks.pop("italic", None)
        elif t.type == "code_inline":
            # Code is its own mark — merge with any currently-active marks
            # so `**bold `inline code`**` survives as bold+code.
            sink().append(_text_leaf(t.content, code=True, **marks))
        elif t.type == "link_open":
            href = t.attrs.get("href", "") if t.attrs else ""
            href_decoded = unquote(href)
            parsed = urlparse(href_decoded)
            m = _UUID_IN_LINK.search(parsed.path)
            if m and m.group(1) in uuid_link_map:
                idx = uuid_link_map[m.group(1)]
                note_id = idx_to_note_id.get(idx)
                link_stack.append(
                    {
                        "type": "wikilink",
                        "noteId": note_id,
                        "label": "",
                        "children": [],
                    }
                )
            else:
                link_stack.append(
                    {"type": "a", "url": href_decoded, "children": []}
                )
        elif t.type == "link_close":
            node = link_stack.pop()
            if node.get("type") == "wikilink":
                label = "".join(c.get("text", "") for c in node["children"])
                node["label"] = label
                node["children"] = [_text_leaf(label)]
            sink().append(node)
        elif t.type in {"softbreak", "hardbreak"}:
            push_text("\n")
        elif t.type == "image":
            # Inline images are unusual; the block-level paragraph handler
            # catches the common single-image-paragraph case. Anything
            # showing up here is an image nested inside other inline markup
            # — we downgrade to a plaintext marker rather than dropping it.
            push_text(f"[image: {t.attrs.get('alt', '') if t.attrs else ''}]")

    if not out:
        out = [_text_leaf("")]
    return out


def md_to_plate(
    markdown: str,
    *,
    uuid_link_map: dict[str, int],
    idx_to_note_id: dict[int, str],
    resolve_asset: Callable[[str], str | None],
    link_title_map: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Convert a Markdown string into a list of Plate JSON blocks.

    ``resolve_asset(relative_path)`` should return an absolute URL if the
    path can be upgraded to an uploaded asset (typically a MinIO presigned
    GET), or ``None`` to fall back to the raw path. The callback shape
    keeps md_to_plate pure — the asset-upload side-effect lives in the
    Temporal activity wrapper below.
    """
    md = MarkdownIt("commonmark", {"breaks": False, "html": False})
    tokens = md.parse(markdown)
    blocks: list[dict[str, Any]] = []

    def inline_of(tok: Token) -> list[dict[str, Any]]:
        return _flatten_inline(
            tok.children or [],
            uuid_link_map=uuid_link_map,
            idx_to_note_id=idx_to_note_id,
            link_title_map=link_title_map,
        )

    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.type == "heading_open":
            level = int(t.tag[1])  # 'h1' → 1
            inline_tok = tokens[i + 1]
            blocks.append(
                {"type": f"h{level}", "children": inline_of(inline_tok)}
            )
            i += 3  # open, inline, close

        elif t.type == "paragraph_open":
            inline_tok = tokens[i + 1]
            children = inline_tok.children or []
            img_children = [c for c in children if c.type == "image"]
            # Collapse "paragraph with a single image" into a Plate image
            # block so the editor shows it as a media element rather than
            # an empty paragraph.
            if len(children) == 1 and len(img_children) == 1:
                img = img_children[0]
                src = img.attrs.get("src", "") if img.attrs else ""
                # markdown-it-py stores the alt text in `.content`, not in
                # attrs — attrs["alt"] is always empty by design.
                alt = img.content or ""
                resolved = resolve_asset(src)
                blocks.append(
                    {
                        "type": "image",
                        "url": resolved or src,
                        "alt": alt,
                        "children": [_text_leaf("")],
                    }
                )
            else:
                blocks.append(
                    {"type": "p", "children": inline_of(inline_tok)}
                )
            i += 3  # open, inline, close

        elif t.type in {"fence", "code_block"}:
            blocks.append(
                {
                    "type": "code_block",
                    "lang": (t.info.strip() or None) if t.info else None,
                    "children": [_text_leaf(t.content.rstrip("\n"))],
                }
            )
            i += 1

        elif t.type == "hr":
            blocks.append({"type": "hr", "children": [_text_leaf("")]})
            i += 1

        elif t.type in {"bullet_list_open", "ordered_list_open"}:
            kind = "ul" if t.type.startswith("bullet") else "ol"
            close_tag = f"{kind}_close"
            items: list[dict[str, Any]] = []
            j = i + 1
            while j < len(tokens) and tokens[j].type != close_tag:
                if tokens[j].type == "list_item_open":
                    # List item body is usually paragraph_open → inline →
                    # paragraph_close. We grab the first inline we see and
                    # flatten it; nested block structure inside a list item
                    # is a v2 concern.
                    k = j + 1
                    while (
                        k < len(tokens)
                        and tokens[k].type != "list_item_close"
                    ):
                        if tokens[k].type == "inline":
                            items.append(
                                {"type": "li", "children": inline_of(tokens[k])}
                            )
                            break
                        k += 1
                    # advance past the list_item_close we didn't already hit
                    while (
                        k < len(tokens)
                        and tokens[k].type != "list_item_close"
                    ):
                        k += 1
                    j = k + 1
                else:
                    j += 1
            blocks.append(
                {
                    "type": kind,
                    "children": items
                    or [{"type": "li", "children": [_text_leaf("")]}],
                }
            )
            i = j + 1  # skip the ul/ol_close

        elif t.type == "blockquote_open":
            collected: list[dict[str, Any]] = []
            j = i + 1
            while j < len(tokens) and tokens[j].type != "blockquote_close":
                if tokens[j].type == "inline":
                    collected.extend(inline_of(tokens[j]))
                j += 1
            blocks.append(
                {
                    "type": "blockquote",
                    "children": collected or [_text_leaf("")],
                }
            )
            i = j + 1

        else:
            i += 1

    if not blocks:
        blocks = [{"type": "p", "children": [_text_leaf("")]}]
    return blocks


@activity.defn(name="convert_notion_md_to_plate")
async def convert_notion_md_to_plate(payload: dict[str, Any]) -> None:
    """Convert a single staged Markdown file and PATCH the target note.

    Payload: ``{ staging_dir, staging_path, note_id, uuid_link_map,
    idx_to_note_id, job_id }``. The materialize step (Task 9) primes
    ``idx_to_note_id`` after creating OpenCairn pages; by the time this
    activity runs every referenced id has a resolution.
    """
    from worker.lib.api_client import patch_internal

    staging_dir = Path(payload["staging_dir"])
    md_path = staging_dir / payload["staging_path"]
    md_text = md_path.read_text(encoding="utf-8-sig", errors="replace")

    def resolve_asset(_href: str) -> str | None:
        # Placeholder: Task 9 will upload referenced assets to MinIO and
        # return a presigned GET. For Plan 3a MVP we return None so the
        # converter falls back to the raw path — good enough for the first
        # ship since images render via same-origin proxy.
        return None

    plate = md_to_plate(
        md_text,
        uuid_link_map=payload["uuid_link_map"],
        idx_to_note_id=payload["idx_to_note_id"],
        resolve_asset=resolve_asset,
        link_title_map=payload.get("link_title_map"),
    )
    await patch_internal(
        f"/api/internal/notes/{payload['note_id']}",
        {"content": plate, "sourceType": payload.get("source_type", "notion")},
    )


@activity.defn(name="upload_staging_to_minio")
async def upload_staging_to_minio(payload: dict[str, Any]) -> dict[str, str]:
    """Copy a staged file out of the Notion unzip tree into MinIO.

    Called per-binary by the ImportWorkflow after unzip_notion_export has
    extracted everything to ``NOTION_IMPORT_STAGING_DIR/<job_id>/``. The
    staged file is read into memory (Notion attachments are small — images
    and small CSVs — so streaming chunking is overkill here) and pushed
    under the object_key the workflow picked. Returns the pair back so
    the child IngestWorkflow can pick up from a canonical record.
    """
    from worker.lib.s3_client import get_s3_client

    staged_path = (
        _staging_base() / payload["job_id"] / payload["staging_path"]
    )
    with open(staged_path, "rb") as f:
        data = f.read()
    import io

    client = get_s3_client()
    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    buf = io.BytesIO(data)
    client.put_object(
        bucket,
        payload["object_key"],
        buf,
        length=len(data),
        content_type=payload["mime"],
    )
    return {"object_key": payload["object_key"], "mime": payload["mime"]}


__all__ = [
    "ZipDefenseError",
    "_safe_extract",
    "_strip_uuid",
    "convert_notion_md_to_plate",
    "md_to_plate",
    "unzip_and_walk",
    "unzip_notion_export",
    "upload_staging_to_minio",
]
