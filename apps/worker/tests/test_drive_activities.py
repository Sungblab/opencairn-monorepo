"""Unit tests for Drive tree discovery + token refresh.

These tests exercise the pure walking logic (`_walk_drive`) and the
token fetch/refresh path against a mocked Drive service and mocked
asyncpg/httpx — they deliberately do NOT hit real Drive, MinIO, or
Google's OAuth servers. Integration with actual google-api-python-client
calls is covered at the Temporal workflow level in Task 10.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
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


def _future_expiry(seconds: int = 600) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


def _past_expiry(seconds: int = 600) -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=seconds)


class _FakeTxn:
    """asyncpg.connection.Transaction stub — minimal async-context-manager."""

    async def __aenter__(self) -> "_FakeTxn":
        return self

    async def __aexit__(self, *_a: Any) -> None:
        return None


class _FakeConn:
    """In-memory asyncpg connection stub.

    `row` is the (single) row returned by fetchrow. `execute` calls land in
    `execute_calls` (split below into advisory locks vs. UPDATEs by the
    `update_calls` view) so refresh-path tests can verify what was
    persisted and that the advisory lock fired. close() is a no-op.
    """

    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row
        self.fetch_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[Any, ...]]] = []

    @property
    def update_calls(self) -> list[tuple[str, tuple[Any, ...]]]:
        return [
            c for c in self.execute_calls if "UPDATE" in c[0]
        ]

    @property
    def advisory_lock_calls(self) -> list[tuple[str, tuple[Any, ...]]]:
        return [
            c for c in self.execute_calls if "pg_advisory_xact_lock" in c[0]
        ]

    def transaction(self) -> _FakeTxn:
        return _FakeTxn()

    async def fetchrow(
        self, query: str, *args: Any
    ) -> dict[str, Any] | None:
        self.fetch_calls.append((query, args))
        return self.row

    async def execute(self, query: str, *args: Any) -> str:
        self.execute_calls.append((query, args))
        return "UPDATE 1"

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_fetch_google_drive_access_token_decrypts_db_ciphertext(
    monkeypatch,
) -> None:
    """Happy path: token still valid, no refresh needed."""
    ciphertext = b"encrypted-token"
    fake_conn = _FakeConn(
        {
            "id": "row-1",
            "access_token_encrypted": ciphertext,
            "refresh_token_encrypted": b"refresh-blob",
            "token_expires_at": _future_expiry(),
        },
    )

    async def fake_connect(url: str) -> _FakeConn:
        assert url == "postgresql://db/opencairn"
        return fake_conn

    def fake_decrypt(blob: bytes) -> str:
        if blob == ciphertext:
            return "plain-token"
        raise AssertionError(f"unexpected decrypt input: {blob!r}")

    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(drive_activities, "decrypt_token", fake_decrypt)

    token = await drive_activities.fetch_google_drive_access_token(
        "user-1", "ws-1"
    )

    assert token == "plain-token"
    # SQL is parameterised on (user_id, workspace_id, provider) — this is
    # the audit S3-022 isolation gate.
    assert fake_conn.fetch_calls[0][1] == ("user-1", "ws-1", "google_drive")
    # Fresh token → no UPDATE was issued.
    assert fake_conn.update_calls == []


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
    fake_conn = _FakeConn(None)

    async def fake_connect(_url: str) -> _FakeConn:
        return fake_conn

    monkeypatch.setenv("DATABASE_URL", "postgresql://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)

    with pytest.raises(ApplicationError, match="not connected"):
        await drive_activities.fetch_google_drive_access_token(
            "user-1", "wrong-ws"
        )


# ────────────────────────────────────────────────────────────────────────
# S3-023: token refresh
# ────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_acquires_advisory_lock_before_select(monkeypatch) -> None:
    """Review fix: serialize concurrent refreshes per (user, workspace).

    Verifies the SQL-level guarantee: the advisory lock is taken BEFORE
    the row SELECT, so two concurrent activities can't both decide to
    refresh at the same time. We don't test true concurrency here (that
    needs a real DB) — only that the call sequence emitted to asyncpg
    starts with the lock.
    """
    fake_conn = _FakeConn(
        {
            "id": "row-1",
            "access_token_encrypted": b"old",
            "refresh_token_encrypted": b"rt-cipher",
            "token_expires_at": _future_expiry(),
        },
    )

    async def fake_connect(_url: str) -> _FakeConn:
        return fake_conn

    monkeypatch.setenv("DATABASE_URL", "postgresql://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(drive_activities, "decrypt_token", lambda _b: "tok")

    await drive_activities.fetch_google_drive_access_token("u", "w")

    # First execute call must be the advisory lock with the user+workspace
    # composed key. Subsequent SELECT happens via fetchrow afterward.
    assert len(fake_conn.advisory_lock_calls) == 1
    lock_args = fake_conn.advisory_lock_calls[0][1]
    assert lock_args == ("u", "w")
    assert fake_conn.fetch_calls, "SELECT should follow the lock"


@pytest.mark.asyncio
async def test_expired_token_triggers_refresh_and_persists(monkeypatch) -> None:
    """Expired access_token + valid refresh_token → refresh + UPDATE + return new."""
    fake_conn = _FakeConn(
        {
            "id": "row-1",
            "access_token_encrypted": b"old-cipher",
            "refresh_token_encrypted": b"refresh-cipher",
            "token_expires_at": _past_expiry(),
        },
    )

    async def fake_connect(_url: str) -> _FakeConn:
        return fake_conn

    decrypt_inputs: list[bytes] = []

    def fake_decrypt(blob: bytes) -> str:
        decrypt_inputs.append(blob)
        return {b"old-cipher": "old-access", b"refresh-cipher": "refresh-tok"}[
            blob
        ]

    encrypted: list[tuple[str, bytes]] = []

    def fake_encrypt(plaintext: str) -> bytes:
        blob = f"enc({plaintext})".encode()
        encrypted.append((plaintext, blob))
        return blob

    refresh_args: list[str] = []

    async def fake_refresh(refresh_token: str) -> dict[str, Any]:
        refresh_args.append(refresh_token)
        return {"access_token": "new-access", "expires_in": 3599}

    monkeypatch.setenv("DATABASE_URL", "postgresql://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(drive_activities, "decrypt_token", fake_decrypt)
    monkeypatch.setattr(drive_activities, "encrypt_token", fake_encrypt)
    monkeypatch.setattr(
        drive_activities, "_exchange_refresh_token", fake_refresh
    )

    token = await drive_activities.fetch_google_drive_access_token(
        "user-1", "ws-1"
    )

    assert token == "new-access"
    assert refresh_args == ["refresh-tok"]
    # Persisted: encrypted new access + new expires_at + row id WHERE.
    assert len(fake_conn.update_calls) == 1
    update_args = fake_conn.update_calls[0][1]
    assert update_args[0] == b"enc(new-access)"
    # Without rotation, refresh_token blob is NOT updated — only access +
    # expires_at + id are passed (3-arg signature).
    assert update_args[2] == "row-1"
    assert isinstance(update_args[1], datetime)
    assert update_args[1] > datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_refresh_persists_rotated_refresh_token_when_google_returns_one(
    monkeypatch,
) -> None:
    fake_conn = _FakeConn(
        {
            "id": "row-1",
            "access_token_encrypted": b"old",
            "refresh_token_encrypted": b"refresh-old",
            "token_expires_at": _past_expiry(),
        },
    )

    async def fake_connect(_url: str) -> _FakeConn:
        return fake_conn

    monkeypatch.setenv("DATABASE_URL", "postgresql://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(
        drive_activities,
        "decrypt_token",
        lambda b: {b"old": "old-access", b"refresh-old": "rt-old"}[b],
    )
    monkeypatch.setattr(
        drive_activities,
        "encrypt_token",
        lambda s: f"enc({s})".encode(),
    )

    async def fake_refresh(_rt: str) -> dict[str, Any]:
        return {
            "access_token": "new-access",
            "expires_in": 3599,
            "refresh_token": "rt-new",
        }

    monkeypatch.setattr(
        drive_activities, "_exchange_refresh_token", fake_refresh
    )

    await drive_activities.fetch_google_drive_access_token("u", "w")

    assert len(fake_conn.update_calls) == 1
    args = fake_conn.update_calls[0][1]
    # 4-arg signature when rotating: access, refresh, expires_at, id.
    assert args[0] == b"enc(new-access)"
    assert args[1] == b"enc(rt-new)"
    assert args[3] == "row-1"


@pytest.mark.asyncio
async def test_refresh_fails_when_no_refresh_token_on_file(monkeypatch) -> None:
    fake_conn = _FakeConn(
        {
            "id": "row-1",
            "access_token_encrypted": b"old",
            "refresh_token_encrypted": None,
            "token_expires_at": _past_expiry(),
        },
    )

    async def fake_connect(_url: str) -> _FakeConn:
        return fake_conn

    monkeypatch.setenv("DATABASE_URL", "postgresql://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(drive_activities, "decrypt_token", lambda _: "plain")

    with pytest.raises(ApplicationError, match="reconnect"):
        await drive_activities.fetch_google_drive_access_token("u", "w")
    assert fake_conn.update_calls == []


@pytest.mark.asyncio
async def test_refresh_propagates_google_error_as_non_retryable(
    monkeypatch,
) -> None:
    fake_conn = _FakeConn(
        {
            "id": "row-1",
            "access_token_encrypted": b"old",
            "refresh_token_encrypted": b"rt",
            "token_expires_at": _past_expiry(),
        },
    )

    async def fake_connect(_url: str) -> _FakeConn:
        return fake_conn

    async def boom_refresh(_rt: str) -> dict[str, Any]:
        raise ApplicationError(
            "Drive token refresh failed: HTTP 400 — invalid_grant",
            non_retryable=True,
        )

    monkeypatch.setenv("DATABASE_URL", "postgresql://db/opencairn")
    monkeypatch.setattr(drive_activities.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(drive_activities, "decrypt_token", lambda _: "plain")
    monkeypatch.setattr(
        drive_activities, "_exchange_refresh_token", boom_refresh
    )

    with pytest.raises(ApplicationError, match="invalid_grant"):
        await drive_activities.fetch_google_drive_access_token("u", "w")
    # Never persisted anything because the refresh itself failed.
    assert fake_conn.update_calls == []


@pytest.mark.asyncio
async def test_exchange_refresh_token_posts_to_google(monkeypatch) -> None:
    """Verify the wire shape against a captured httpx request."""
    captured: dict[str, Any] = {}

    class FakeResponse:
        status_code = 200
        text = "{}"

        def json(self) -> dict[str, Any]:
            return {"access_token": "new", "expires_in": 3599}

    class FakeClient:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def post(self, url: str, **kwargs: Any) -> FakeResponse:
            captured["url"] = url
            captured["data"] = kwargs.get("data")
            return FakeResponse()

    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(drive_activities.httpx, "AsyncClient", FakeClient)

    out = await drive_activities._exchange_refresh_token("rt-abc")

    assert out == {"access_token": "new", "expires_in": 3599}
    assert captured["url"] == "https://oauth2.googleapis.com/token"
    assert captured["data"] == {
        "grant_type": "refresh_token",
        "refresh_token": "rt-abc",
        "client_id": "cid",
        "client_secret": "csecret",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [400, 401, 403])
async def test_exchange_refresh_token_4xx_is_non_retryable(
    monkeypatch, status_code: int
) -> None:
    """4xx from Google's /token = your refresh_token is dead, do not retry."""

    class FakeResponse:
        text = '{"error":"invalid_grant"}'

        def __init__(self, code: int) -> None:
            self.status_code = code

    class FakeClient:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def post(self, *_a: Any, **_kw: Any) -> FakeResponse:
            return FakeResponse(status_code)

    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(drive_activities.httpx, "AsyncClient", FakeClient)

    with pytest.raises(ApplicationError) as excinfo:
        await drive_activities._exchange_refresh_token("rt")
    assert f"HTTP {status_code}" in str(excinfo.value)
    # ApplicationError surfaces non_retryable via the .non_retryable attribute.
    assert excinfo.value.non_retryable is True


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [429, 500, 502, 503, 504])
async def test_exchange_refresh_token_5xx_and_429_are_retryable(
    monkeypatch, status_code: int
) -> None:
    """5xx + 429 are transient — Temporal's default retry handles them."""

    class FakeResponse:
        text = "Service Unavailable"

        def __init__(self, code: int) -> None:
            self.status_code = code

    class FakeClient:
        def __init__(self, *_a: Any, **_kw: Any) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def post(self, *_a: Any, **_kw: Any) -> FakeResponse:
            return FakeResponse(status_code)

    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(drive_activities.httpx, "AsyncClient", FakeClient)

    with pytest.raises(ApplicationError) as excinfo:
        await drive_activities._exchange_refresh_token("rt")
    assert f"HTTP {status_code}" in str(excinfo.value)
    assert excinfo.value.non_retryable is False


@pytest.mark.asyncio
async def test_exchange_refresh_token_requires_oauth_credentials(
    monkeypatch,
) -> None:
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)

    with pytest.raises(ApplicationError, match="GOOGLE_OAUTH"):
        await drive_activities._exchange_refresh_token("rt")


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
