"""Unit tests for Drive tree discovery.

These tests exercise the pure walking logic (`_walk_drive`) against a mocked
Drive service — they deliberately do NOT hit real Drive or MinIO. Integration
with actual google-api-python-client calls is covered at the Temporal
workflow level in Task 10.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from temporalio.exceptions import ApplicationError

from worker.activities import drive_activities
from worker.activities.drive_activities import _build_service, _walk_drive


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


def test_build_service_uses_access_token_argument_not_process_env(monkeypatch) -> None:
    """Drive activities must not read user tokens from process-global env."""
    monkeypatch.delenv("_DRIVE_ACCESS_TOKEN_HEX", raising=False)
    built: dict[str, Any] = {}

    def fake_build(api: str, version: str, **kwargs: Any) -> str:
        built["api"] = api
        built["version"] = version
        built["credentials"] = kwargs["credentials"]
        return "svc"

    monkeypatch.setattr(drive_activities, "build", fake_build)

    svc = _build_service("token-user-a")

    assert svc == "svc"
    assert built["api"] == "drive"
    assert built["version"] == "v3"
    assert built["credentials"].token == "token-user-a"


@pytest.mark.asyncio
async def test_fetch_google_drive_access_token_decrypts_db_ciphertext(monkeypatch) -> None:
    ciphertext = b"encrypted-token"
    queries: list[tuple[str, tuple[Any, ...]]] = []

    class FakeConn:
        async def fetchrow(self, query: str, *args: Any) -> dict[str, bytes]:
            queries.append((query, args))
            return {"access_token_encrypted": ciphertext}

        async def close(self) -> None:
            queries.append(("close", ()))

    async def fake_connect(url: str) -> FakeConn:
        assert url == "postgresql://db/opencairn"
        return FakeConn()

    def fake_decrypt(blob: bytes) -> str:
        assert blob == ciphertext
        return "plain-token"

    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(drive_activities, "decrypt_token", fake_decrypt)

    token = await drive_activities.fetch_google_drive_access_token(
        "user-1", "ws-1"
    )

    assert token == "plain-token"
    # SQL is parameterised on (user_id, workspace_id, provider) — this is
    # the audit S3-022 isolation gate. A user in workspace A imports get a
    # different row from the same user's workspace B import.
    assert queries[0][1] == ("user-1", "ws-1", "google_drive")


@pytest.mark.asyncio
async def test_fetch_google_drive_access_token_requires_database_url(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(ApplicationError, match="DATABASE_URL"):
        await drive_activities.fetch_google_drive_access_token(
            "user-1", "ws-1"
        )


@pytest.mark.asyncio
async def test_fetch_google_drive_access_token_requires_workspace_id() -> None:
    with pytest.raises(ApplicationError, match="workspace_id"):
        await drive_activities.fetch_google_drive_access_token("user-1", "")


@pytest.mark.asyncio
async def test_fetch_returns_not_connected_when_workspace_lookup_misses(
    monkeypatch,
) -> None:
    """Wrong workspace_id must NOT fall back to a different workspace's row."""

    class FakeConn:
        async def fetchrow(
            self, _query: str, *_args: Any
        ) -> dict[str, bytes] | None:
            return None

        async def close(self) -> None:
            return None

    async def fake_connect(_url: str) -> FakeConn:
        return FakeConn()

    monkeypatch.setenv("DATABASE_URL", "postgresql://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)

    with pytest.raises(ApplicationError, match="not connected"):
        await drive_activities.fetch_google_drive_access_token(
            "user-1", "wrong-ws"
        )


@pytest.mark.asyncio
async def test_drive_service_from_payload_fetches_token_per_activity(monkeypatch) -> None:
    calls: list[tuple[str, str]] = []

    async def fake_fetch(user_id: str, workspace_id: str) -> str:
        calls.append((user_id, workspace_id))
        return "fresh-token"

    def fake_build_service(access_token: str) -> str:
        assert access_token == "fresh-token"
        return "svc"

    monkeypatch.setattr(
        drive_activities, "fetch_google_drive_access_token", fake_fetch
    )
    monkeypatch.setattr(drive_activities, "_build_service", fake_build_service)

    svc = await drive_activities._build_service_from_payload(
        {"user_id": "user-1", "workspace_id": "ws-1"}
    )

    assert svc == "svc"
    assert calls == [("user-1", "ws-1")]


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{}, {"user_id": None}, {"user_id": 123}, {"user_id": ""}])
async def test_drive_service_from_payload_rejects_invalid_user_id(
    payload: dict[str, Any],
) -> None:
    with pytest.raises(ApplicationError, match="user_id"):
        await drive_activities._build_service_from_payload(payload)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"user_id": "u"},
        {"user_id": "u", "workspace_id": None},
        {"user_id": "u", "workspace_id": ""},
        {"user_id": "u", "workspace_id": 123},
    ],
)
async def test_drive_service_from_payload_rejects_invalid_workspace_id(
    payload: dict[str, Any],
) -> None:
    with pytest.raises(ApplicationError, match="workspace_id"):
        await drive_activities._build_service_from_payload(payload)


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


def test_walk_drive_folder_paginates_all_children() -> None:
    svc = MagicMock()
    first_req = MagicMock()
    first_req.execute.return_value = {
        "files": [
            {
                "id": "file-1",
                "name": "a.pdf",
                "mimeType": "application/pdf",
                "size": "1",
            },
        ],
        "nextPageToken": "page-2",
    }
    second_req = MagicMock()
    second_req.execute.return_value = {
        "files": [
            {
                "id": "file-2",
                "name": "b.pdf",
                "mimeType": "application/pdf",
                "size": "1",
            },
        ],
    }
    svc.files.return_value.list.side_effect = [first_req, second_req]

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

    assert [n.display_name for n in nodes if n.kind == "binary"] == [
        "a.pdf",
        "b.pdf",
    ]
    assert svc.files.return_value.list.call_args_list[1].kwargs["pageToken"] == "page-2"


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
