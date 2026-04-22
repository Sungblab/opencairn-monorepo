"""Unit tests for Drive tree discovery.

These tests exercise the pure walking logic (`_walk_drive`) against a mocked
Drive service — they deliberately do NOT hit real Drive or MinIO. Integration
with actual google-api-python-client calls is covered at the Temporal
workflow level in Task 10.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from worker.activities.drive_activities import _walk_drive


def _mock_drive_service(files_by_parent: dict[str, list[dict[str, Any]]]) -> MagicMock:
    """Build a MagicMock drive service returning canned list responses.

    Matches the `svc.files().list(q=..., fields=..., pageSize=...).execute()`
    chain that `_walk_drive` uses. `q` is parsed to extract the folder id so
    we can look up the canned response for that parent.
    """
    svc = MagicMock()

    def list_side_effect(q: str, **_kw: Any) -> MagicMock:
        # q is like "'folderId' in parents and trashed=false"
        folder_id = q.split("'")[1]
        req = MagicMock()
        req.execute.return_value = {
            "files": files_by_parent.get(folder_id, []),
        }
        return req

    svc.files.return_value.list.side_effect = list_side_effect
    return svc


def test_walk_drive_single_file() -> None:
    svc = _mock_drive_service({})
    nodes = _walk_drive(
        svc,
        file_ids=["file-1"],
        folder_ids=[],
        file_metadata={
            "file-1": {
                "id": "file-1",
                "name": "paper.pdf",
                "mimeType": "application/pdf",
                "size": "1024",
            },
        },
    )
    assert len(nodes) == 1
    assert nodes[0].kind == "binary"
    assert nodes[0].display_name == "paper.pdf"
    assert nodes[0].parent_idx is None


def test_walk_drive_folder_recursion() -> None:
    svc = _mock_drive_service(
        {
            "root-folder": [
                {
                    "id": "sub-1",
                    "name": "paper.pdf",
                    "mimeType": "application/pdf",
                    "size": "500",
                },
                {
                    "id": "nested-folder",
                    "name": "nested",
                    "mimeType": "application/vnd.google-apps.folder",
                },
            ],
            "nested-folder": [
                {
                    "id": "sub-2",
                    "name": "deep.pdf",
                    "mimeType": "application/pdf",
                    "size": "200",
                },
            ],
        },
    )
    nodes = _walk_drive(
        svc,
        file_ids=[],
        folder_ids=["root-folder"],
        file_metadata={
            "root-folder": {
                "id": "root-folder",
                "name": "root",
                "mimeType": "application/vnd.google-apps.folder",
            },
        },
    )
    # Expect: root-folder (page) + sub-1 (binary) + nested-folder (page) + sub-2 (binary)
    assert len(nodes) == 4
    pages = [n for n in nodes if n.kind == "page"]
    binaries = [n for n in nodes if n.kind == "binary"]
    assert len(pages) == 2  # root and nested folder
    assert len(binaries) == 2
    # Nested folder must point back at the root folder as its parent
    nested = next(n for n in nodes if n.display_name == "nested")
    root = next(n for n in nodes if n.display_name == "root")
    assert nested.parent_idx == root.idx


def test_walk_drive_rejects_unsupported_mime() -> None:
    svc = _mock_drive_service({})
    nodes = _walk_drive(
        svc,
        file_ids=["file-1"],
        folder_ids=[],
        file_metadata={
            "file-1": {
                "id": "file-1",
                "name": "weird.xyz",
                "mimeType": "application/x-random",
            },
        },
    )
    # Unsupported MIME → skipped silently so one stray attachment doesn't
    # abort the entire import. The workflow-level summary surfaces the skips.
    assert nodes == []


def test_walk_drive_google_doc_exports_as_pdf() -> None:
    svc = _mock_drive_service({})
    nodes = _walk_drive(
        svc,
        file_ids=["doc-1"],
        folder_ids=[],
        file_metadata={
            "doc-1": {
                "id": "doc-1",
                "name": "Design notes",
                "mimeType": "application/vnd.google-apps.document",
            },
        },
    )
    assert len(nodes) == 1
    assert nodes[0].kind == "binary"
    # Effective MIME is flipped to PDF and the source native MIME is recorded
    # on meta.export_from so the upload activity knows to call `export_media`.
    assert nodes[0].meta["mime"] == "application/pdf"
    assert nodes[0].meta["export_from"] == "application/vnd.google-apps.document"
