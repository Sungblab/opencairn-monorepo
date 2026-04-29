"""Google Drive ingest activities.

Two Temporal activities back the Drive import path added by the
ingest-source-expansion plan:

* ``discover_drive_tree`` — given a user's selected file ids + folder ids,
  walks the Drive tree and returns a tree manifest (pages for folders,
  binaries for files). The manifest is later materialized into OpenCairn
  pages by ``resolve_target`` / ``materialize_page_tree``.
* ``upload_drive_file_to_minio`` — streams a single Drive file into MinIO
  under a per-job prefix so the existing Plan 3 IngestWorkflow can pick it
  up without knowing Drive exists.

The token-loading path is intentionally per-activity: each Drive activity
looks up the encrypted user integration row, decrypts it in-process, and
builds a short-lived Drive client. This keeps plaintext OAuth tokens out of
Temporal workflow history and avoids process-global environment variables.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
import httpx
from google.oauth2.credentials import Credentials  # type: ignore[import-untyped]
from googleapiclient.discovery import build  # type: ignore[import-untyped]
from googleapiclient.http import MediaIoBaseDownload  # type: ignore[import-untyped]
from temporalio import activity
from temporalio.exceptions import ApplicationError

from worker.lib.integration_crypto import decrypt_token, encrypt_token
from worker.lib.s3_client import get_s3_client

# Google's OAuth refresh endpoint. Hardcoded (not env-overridable) because
# any "alternate URL" path is also an exfiltration path for refresh tokens —
# tests monkeypatch the httpx call instead of redirecting at runtime.
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# How close to expiry we proactively refresh. Google access tokens are
# valid for ~1 hour; a 60s skew protects against clock drift between
# the worker and Google's auth servers, and against tokens minted just
# before a long-running activity that would otherwise exceed the
# remaining budget.
_REFRESH_SKEW = timedelta(seconds=60)

# MIME allowlist — mirrors the Plan 3 ingest allowlist. Folders are
# handled separately (see _FOLDER_MIME). Anything outside this set is
# skipped during tree discovery with a summary line rather than an error,
# so a single oddball attachment can't abort an otherwise-valid import.
_SUPPORTED_MIMES: set[str] = {
    "application/pdf",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "video/mp4",
    "video/quicktime",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/markdown",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
}
_FOLDER_MIME = "application/vnd.google-apps.folder"

# Google-native doc types aren't downloadable as-is — we must ask the Drive
# API to export them. The values here become the `mime` we persist and the
# MIME the upload activity passes to `export_media`. Docs/slides collapse to
# PDF (preserves layout); sheets round-trip through xlsx so numeric types
# survive.
_GOOGLE_NATIVE_EXPORT_MIMES: dict[str, str] = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.presentation": "application/pdf",
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
}


@dataclass
class TreeNode:
    idx: int
    parent_idx: int | None
    kind: str  # "page" | "binary"
    path: str
    display_name: str
    meta: dict[str, Any]


def _asyncpg_url(url: str) -> str:
    if url.startswith("postgresql+"):
        return "postgresql://" + url.split("://", 1)[1]
    return url


async def _exchange_refresh_token(refresh_token: str) -> dict[str, Any]:
    """Call Google's /token endpoint with grant_type=refresh_token.

    Returns the parsed JSON body on success. Raises ApplicationError
    (non-retryable) on any non-2xx response — Google distinguishes
    "transient" 5xx from "your refresh_token is dead" 400, but in
    practice both surface as a hard stop for the user (re-connect
    Drive). Retrying a dead refresh_token at the activity level just
    eats budget.
    """
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ApplicationError(
            "GOOGLE_OAUTH_CLIENT_ID/SECRET not configured — cannot refresh "
            "Drive token",
            non_retryable=True,
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
    if resp.status_code != 200:
        # Google returns a JSON body with `error`/`error_description` we
        # surface for ops triage but the user sees just "needs reauth"
        # via the ApplicationError type — handler maps to a UI banner.
        body = resp.text[:500]
        raise ApplicationError(
            f"Drive token refresh failed: HTTP {resp.status_code} — {body}",
            non_retryable=True,
        )
    return resp.json()


async def fetch_google_drive_access_token(
    user_id: str, workspace_id: str
) -> str:
    """Return a decrypted, fresh Google Drive access token for ``(user_id, workspace_id)``.

    The activity performs this lookup itself so no plaintext token (and no
    ciphertext blob) is serialized into Temporal history. The
    ``workspace_id`` scope is the audit S3-022 isolation gate: a token
    connected from workspace A is invisible to imports running in B.

    When ``token_expires_at`` is at or past ``now + _REFRESH_SKEW``, calls
    Google's /token endpoint with the stored ``refresh_token`` and
    persists the new ``access_token`` + ``token_expires_at`` (and the new
    ``refresh_token`` if Google rotates it) before returning. This is the
    audit S3-023 fix — without it, an access_token minted at OAuth time
    silently 401s after the ~1h Google validity window.
    """
    if not user_id:
        raise ApplicationError("user_id is required for Drive import", non_retryable=True)
    if not workspace_id:
        raise ApplicationError(
            "workspace_id is required for Drive import",
            non_retryable=True,
        )

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ApplicationError(
            "DATABASE_URL environment variable is not set",
            non_retryable=True,
        )

    conn = await asyncpg.connect(_asyncpg_url(db_url))
    try:
        row = await conn.fetchrow(
            """
            SELECT id,
                   access_token_encrypted,
                   refresh_token_encrypted,
                   token_expires_at
            FROM user_integrations
            WHERE user_id = $1
              AND workspace_id = $2
              AND provider = $3
            LIMIT 1
            """,
            user_id,
            workspace_id,
            "google_drive",
        )
        if row is None or row["access_token_encrypted"] is None:
            raise ApplicationError(
                "google_drive integration is not connected",
                non_retryable=True,
            )

        access_token = decrypt_token(bytes(row["access_token_encrypted"]))
        expires_at = row["token_expires_at"]
        now = datetime.now(timezone.utc)
        # Treat NULL expires_at as "unknown — assume fresh-ish". OAuth
        # callbacks always write expires_at, so a NULL row would only show
        # up if someone hand-edited the DB; refusing to use it is hostile.
        if expires_at is None or expires_at - _REFRESH_SKEW > now:
            return access_token

        refresh_blob = row["refresh_token_encrypted"]
        if refresh_blob is None:
            raise ApplicationError(
                "google_drive token expired and no refresh_token is on file"
                " — user must reconnect Drive",
                non_retryable=True,
            )
        refresh_token = decrypt_token(bytes(refresh_blob))
        tokens = await _exchange_refresh_token(refresh_token)
        new_access = tokens.get("access_token")
        expires_in = tokens.get("expires_in")
        if not isinstance(new_access, str) or not isinstance(expires_in, int):
            raise ApplicationError(
                "Drive token refresh response missing access_token/expires_in",
                non_retryable=True,
            )
        new_expires_at = now + timedelta(seconds=expires_in)
        # Google occasionally rotates the refresh_token. When it does, we
        # MUST persist the new one — the old one is invalidated server-side.
        new_refresh = tokens.get("refresh_token")
        if isinstance(new_refresh, str) and new_refresh:
            await conn.execute(
                """
                UPDATE user_integrations
                SET access_token_encrypted = $1,
                    refresh_token_encrypted = $2,
                    token_expires_at = $3,
                    updated_at = NOW()
                WHERE id = $4
                """,
                encrypt_token(new_access),
                encrypt_token(new_refresh),
                new_expires_at,
                row["id"],
            )
        else:
            await conn.execute(
                """
                UPDATE user_integrations
                SET access_token_encrypted = $1,
                    token_expires_at = $2,
                    updated_at = NOW()
                WHERE id = $3
                """,
                encrypt_token(new_access),
                new_expires_at,
                row["id"],
            )
        return new_access
    finally:
        await conn.close()


def _build_service(access_token: str) -> Any:
    """Build a Drive v3 service client from a decrypted access token."""
    creds = Credentials(token=access_token)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


async def _build_service_from_payload(payload: dict[str, Any]) -> Any:
    user_id = payload.get("user_id")
    workspace_id = payload.get("workspace_id")
    if not isinstance(user_id, str) or not user_id:
        raise ApplicationError(
            "user_id must be a non-empty string",
            non_retryable=True,
        )
    if not isinstance(workspace_id, str) or not workspace_id:
        raise ApplicationError(
            "workspace_id must be a non-empty string",
            non_retryable=True,
        )
    access_token = await fetch_google_drive_access_token(user_id, workspace_id)
    return _build_service(access_token)


def _walk_drive(
    svc: Any,
    file_ids: list[str],
    folder_ids: list[str],
    file_metadata: dict[str, dict[str, Any]],
) -> list[TreeNode]:
    """Walk the selected Drive ids into a list of ``TreeNode``s.

    Folders become ``"page"`` nodes so that binaries underneath can be
    children in the OpenCairn page tree. Unsupported MIME types are
    skipped silently and reported by the caller via the summary.
    """
    nodes: list[TreeNode] = []
    counter = [0]

    def emit(**node_kwargs: Any) -> int:
        idx = counter[0]
        counter[0] += 1
        nodes.append(TreeNode(idx=idx, **node_kwargs))
        return idx

    def emit_file(
        meta: dict[str, Any],
        parent_idx: int | None,
        path: str,
    ) -> None:
        mime = meta["mimeType"]
        effective_mime = _GOOGLE_NATIVE_EXPORT_MIMES.get(mime, mime)
        if effective_mime not in _SUPPORTED_MIMES:
            return  # skip silently; caller surfaces via summary
        emit(
            parent_idx=parent_idx,
            kind="binary",
            path=path,
            display_name=meta["name"],
            meta={
                "drive_file_id": meta["id"],
                "mime": effective_mime,
                "export_from": mime if mime != effective_mime else None,
                "size": int(meta.get("size", 0)),
            },
        )

    def walk_folder(
        folder_id: str,
        parent_idx: int | None,
        path: str,
        display_name: str,
    ) -> None:
        self_idx = emit(
            parent_idx=parent_idx,
            kind="page",
            path=path,
            display_name=display_name,
            meta={"drive_file_id": folder_id},
        )
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {
                "q": f"'{folder_id}' in parents and trashed=false",
                "fields": "nextPageToken, files(id, name, mimeType, size)",
                "pageSize": 1000,
            }
            if page_token:
                params["pageToken"] = page_token
            resp = svc.files().list(**params).execute()
            for child in resp.get("files", []):
                child_path = f"{path}/{child['name']}"
                if child["mimeType"] == _FOLDER_MIME:
                    walk_folder(
                        child["id"],
                        self_idx,
                        child_path,
                        display_name=child["name"],
                    )
                else:
                    emit_file(child, parent_idx=self_idx, path=child_path)
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    for fid in file_ids:
        meta = file_metadata.get(fid)
        if not meta:
            continue
        emit_file(meta, parent_idx=None, path=meta["name"])

    for fid in folder_ids:
        meta = file_metadata.get(fid, {})
        name = meta.get("name", fid)
        walk_folder(fid, parent_idx=None, path=name, display_name=name)

    return nodes


@activity.defn(name="discover_drive_tree")
async def discover_drive_tree(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve selected Drive ids into a TreeManifest dict.

    Input: ``{ user_id: str, file_ids: list[str], folder_ids: list[str] }``
    Output: ``{ root_display_name, nodes: [TreeNode dicts], uuid_link_map }``
    """
    svc = await _build_service_from_payload(payload)
    root_ids = list(payload.get("file_ids", [])) + list(payload.get("folder_ids", []))
    file_metadata: dict[str, dict[str, Any]] = {}
    for fid in root_ids:
        meta = (
            svc.files()
            .get(fileId=fid, fields="id, name, mimeType, size")
            .execute()
        )
        file_metadata[fid] = meta
    nodes = _walk_drive(
        svc,
        file_ids=list(payload.get("file_ids", [])),
        folder_ids=list(payload.get("folder_ids", [])),
        file_metadata=file_metadata,
    )
    return {
        "root_display_name": "Drive import",
        "nodes": [n.__dict__ for n in nodes],
        # Drive files don't carry OpenCairn uuids — the link-rewrite pass is
        # filled in by materialize_page_tree in Task 9.
        "uuid_link_map": {},
    }


@activity.defn(name="upload_drive_file_to_minio")
async def upload_drive_file_to_minio(payload: dict[str, Any]) -> dict[str, str]:
    """Download a single Drive file and stash it in MinIO.

    The existing Plan 3 IngestWorkflow keys off ``object_key`` in MinIO to
    run the rest of the pipeline (OCR, embedding, etc.), so we just need to
    hand it a valid key after the download completes. Google-native types
    (Docs/Slides/Sheets) go through ``export_media`` with the effective MIME
    chosen by ``_GOOGLE_NATIVE_EXPORT_MIMES``.
    """
    svc = await _build_service_from_payload(payload)
    import_job_id = payload["import_job_id"]
    drive_file_id = payload["drive_file_id"]
    mime = payload["mime"]
    export_from = payload.get("export_from")

    if export_from:
        req = svc.files().export_media(fileId=drive_file_id, mimeType=mime)
    else:
        req = svc.files().get_media(fileId=drive_file_id)

    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _status, done = downloader.next_chunk()
    buf.seek(0)

    object_key = f"imports/drive/{import_job_id}/{drive_file_id}"
    client = get_s3_client()
    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client.put_object(
        bucket,
        object_key,
        buf,
        length=buf.getbuffer().nbytes,
        content_type=mime,
    )
    return {"object_key": object_key, "mime": mime}


__all__ = [
    "TreeNode",
    "_build_service_from_payload",
    "_walk_drive",
    "discover_drive_tree",
    "fetch_google_drive_access_token",
    "upload_drive_file_to_minio",
]
