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

The token-loading path is intentionally thin: the activity reads the
encrypted access token from an env var the workflow populates just before
each batch of activity calls. Doing full DB lookups inside each activity
(30+ calls per import) would be chatty and hard to test — the workflow
owns one DB round-trip per user per run instead. Task 9 wires this up.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from typing import Any

from google.oauth2.credentials import Credentials  # type: ignore[import-untyped]
from googleapiclient.discovery import build  # type: ignore[import-untyped]
from googleapiclient.http import MediaIoBaseDownload  # type: ignore[import-untyped]
from temporalio import activity

from worker.lib.integration_crypto import decrypt_token
from worker.lib.s3_client import get_s3_client

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


def _build_service(access_token_env: str = "_DRIVE_ACCESS_TOKEN_HEX") -> Any:
    """Build a Drive v3 service client from an encrypted token in the env.

    The workflow loads the encrypted token from ``user_integrations`` and
    exposes the hex-encoded bytes via ``_DRIVE_ACCESS_TOKEN_HEX`` before
    invoking this activity. Keeping the env-indirect makes the activity
    itself free of DB coupling and trivially mockable in unit tests.
    """
    raw_hex = os.environ.get(access_token_env)
    if not raw_hex:
        raise RuntimeError(
            f"{access_token_env} not set — the ImportWorkflow must populate "
            "it with hex(encrypted_access_token) before calling this activity."
        )
    access_token = decrypt_token(bytes.fromhex(raw_hex))
    creds = Credentials(token=access_token)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


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
        resp = (
            svc.files()
            .list(
                q=f"'{folder_id}' in parents and trashed=false",
                fields="files(id, name, mimeType, size)",
                pageSize=1000,
            )
            .execute()
        )
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
    svc = _build_service()
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
    svc = _build_service()
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
    "_walk_drive",
    "discover_drive_tree",
    "upload_drive_file_to_minio",
]
