"""OpenDataLoader PDF command helpers.

The current upstream distribution ships a Python-installed ``opendataloader-pdf``
CLI that wraps the Java engine. Older OpenCairn images looked for a manually
downloaded fat JAR at ``/app/opendataloader-pdf.jar``; keep that path as a
legacy fallback, but never treat an empty marker file as usable.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

OPENDATALOADER_CMD = os.environ.get("OPENCAIRN_OPENDATALOADER_CMD", "opendataloader-pdf")
LEGACY_JAR_PATH = os.environ.get("OPENDATALOADER_JAR", "/app/opendataloader-pdf.jar")
DEFAULT_TIMEOUT_SECONDS = int(os.environ.get("OPENCAIRN_OPENDATALOADER_TIMEOUT_SECONDS", "300"))

_TEXT_TYPES = {"paragraph", "heading", "caption", "list item", "text"}
_TABLE_TYPES = {"table"}
_IMAGE_TYPES = {"image", "picture", "figure"}


def opendataloader_cli_available() -> bool:
    cmd_path = Path(OPENDATALOADER_CMD)
    return cmd_path.is_file() or shutil.which(OPENDATALOADER_CMD) is not None


def legacy_jar_available() -> bool:
    jar = Path(LEGACY_JAR_PATH)
    return jar.is_file() and jar.stat().st_size > 0


def opendataloader_available() -> bool:
    return opendataloader_cli_available() or legacy_jar_available()


def run_opendataloader_pdf(
    pdf_path: Path,
    out_dir: Path,
    *,
    extract_images: bool,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> Path:
    """Run OpenDataLoader PDF into ``out_dir`` and return that directory."""
    if opendataloader_cli_available():
        return _run_cli(pdf_path, out_dir, extract_images=extract_images, timeout=timeout)
    if legacy_jar_available():
        return _run_legacy_jar(pdf_path, out_dir, extract_images=extract_images, timeout=timeout)
    raise FileNotFoundError(
        "opendataloader-pdf CLI is not on PATH and legacy JAR is missing or empty "
        f"at {LEGACY_JAR_PATH}"
    )


def read_opendataloader_json(out_dir: Path) -> dict[str, Any]:
    json_files = list(out_dir.glob("*.json"))
    if not json_files:
        raise FileNotFoundError("opendataloader-pdf produced no JSON output")
    with open(json_files[0], encoding="utf-8") as f:
        return json.load(f)


def normalize_opendataloader_pages(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize legacy ``pages`` JSON and current v2 ``kids`` JSON.

    OpenCairn downstream activities consume ``pages[].text``,
    ``pages[].figures[]`` and ``pages[].tables[]``. OpenDataLoader v2 emits a
    hierarchical root with ``kids`` and per-element ``page number`` fields, so
    collapse that tree back into the page-shaped contract.
    """
    pages = data.get("pages")
    if isinstance(pages, list):
        return pages

    kids = data.get("kids")
    if not isinstance(kids, list):
        return []

    page_count = _int_or_zero(data.get("number of pages")) or _max_page_number(kids)
    normalized: list[dict[str, Any]] = [
        {"text": "", "figures": [], "tables": []} for _ in range(page_count)
    ]
    text_parts: list[list[str]] = [[] for _ in range(page_count)]

    for child in kids:
        _collect_node(child, normalized, text_parts, current_page=None)

    for idx, parts in enumerate(text_parts):
        normalized[idx]["text"] = "\n\n".join(parts)
    return normalized


def _run_cli(
    pdf_path: Path,
    out_dir: Path,
    *,
    extract_images: bool,
    timeout: int,
) -> Path:
    image_dir = out_dir / "images"
    cmd = [
        OPENDATALOADER_CMD,
        str(pdf_path),
        "-o",
        str(out_dir),
        "-f",
        "json",
        "--quiet",
    ]
    if extract_images:
        image_dir.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--image-output", "external", "--image-dir", str(image_dir)])
    else:
        cmd.extend(["--image-output", "off"])

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    _raise_for_failure(result)
    return out_dir


def _run_legacy_jar(
    pdf_path: Path,
    out_dir: Path,
    *,
    extract_images: bool,
    timeout: int,
) -> Path:
    result = subprocess.run(
        [
            "java",
            "-jar",
            LEGACY_JAR_PATH,
            "--input",
            str(pdf_path),
            "--output",
            str(out_dir),
            "--format",
            "json",
            "--extract-images",
            "true" if extract_images else "false",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    _raise_for_failure(result)
    return out_dir


def _raise_for_failure(result: subprocess.CompletedProcess[str]) -> None:
    if result.returncode == 0:
        return
    stderr = (result.stderr or "").strip()
    stdout = (result.stdout or "").strip()
    detail = stderr or stdout or f"exit code {result.returncode}"
    raise RuntimeError(f"opendataloader-pdf failed: {detail[:2000]}")


def _collect_node(
    node: Any,
    pages: list[dict[str, Any]],
    text_parts: list[list[str]],
    *,
    current_page: int | None,
) -> None:
    if not isinstance(node, dict):
        return

    page = _int_or_zero(node.get("page number")) or current_page
    if page is not None:
        _ensure_page(pages, text_parts, page)

    node_type = str(node.get("type") or "").strip().lower()
    if page is not None and 1 <= page <= len(pages):
        page_state = pages[page - 1]
        if node_type in _TEXT_TYPES:
            content = str(node.get("content") or "").strip()
            if content:
                text_parts[page - 1].append(content)
        if node_type in _TABLE_TYPES:
            page_state["tables"].append(node)
        if node_type in _IMAGE_TYPES:
            figure = _figure_from_node(node)
            if figure:
                page_state["figures"].append(figure)

    for child in _iter_children(node):
        _collect_node(child, pages, text_parts, current_page=page)


def _figure_from_node(node: dict[str, Any]) -> dict[str, Any] | None:
    source = node.get("source")
    data = node.get("data")
    if not source and not data:
        return None
    bbox = node.get("bounding box")
    figure: dict[str, Any] = {
        "file": str(source) if source else None,
        "kind": "image",
        "caption": node.get("caption"),
    }
    if isinstance(bbox, list) and len(bbox) == 4:
        try:
            figure["width"] = abs(float(bbox[2]) - float(bbox[0]))
            figure["height"] = abs(float(bbox[3]) - float(bbox[1]))
        except (TypeError, ValueError):
            pass
    return figure


def _iter_children(node: dict[str, Any]) -> list[Any]:
    children: list[Any] = []
    for key in ("kids", "list items", "rows", "cells"):
        value = node.get(key)
        if isinstance(value, list):
            children.extend(value)
    return children


def _max_page_number(value: Any) -> int:
    max_page = 0
    if isinstance(value, dict):
        max_page = max(max_page, _int_or_zero(value.get("page number")))
        for child in _iter_children(value):
            max_page = max(max_page, _max_page_number(child))
    elif isinstance(value, list):
        for item in value:
            max_page = max(max_page, _max_page_number(item))
    return max_page


def _ensure_page(
    pages: list[dict[str, Any]],
    text_parts: list[list[str]],
    page: int,
) -> None:
    while len(pages) < page:
        pages.append({"text": "", "figures": [], "tables": []})
        text_parts.append([])


def _int_or_zero(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
