"""Google Workspace export activities.

The default client performs the actual Drive upload/conversion when the worker
feature flag is enabled and the user has a Google Drive grant. Tests still
inject a fake client so the normal suite stays offline.
"""
from __future__ import annotations

from contextlib import suppress
from dataclasses import asdict, dataclass, is_dataclass
from typing import TYPE_CHECKING, Any, Literal, Protocol

from google.oauth2.credentials import Credentials  # type: ignore[import-untyped]
from googleapiclient.discovery import build  # type: ignore[import-untyped]
from googleapiclient.errors import HttpError  # type: ignore[import-untyped]
from googleapiclient.http import MediaFileUpload  # type: ignore[import-untyped]
from temporalio import activity
from temporalio.exceptions import ApplicationError

from worker.activities.drive_activities import fetch_google_drive_access_token
from worker.lib.api_client import post_internal
from worker.lib.s3_client import download_to_tempfile

if TYPE_CHECKING:
    from pathlib import Path

GoogleExportProvider = Literal[
    "google_drive",
    "google_docs",
    "google_sheets",
    "google_slides",
]

GOOGLE_NATIVE_MIME_TYPES: dict[GoogleExportProvider, str | None] = {
    "google_drive": None,
    "google_docs": "application/vnd.google-apps.document",
    "google_sheets": "application/vnd.google-apps.spreadsheet",
    "google_slides": "application/vnd.google-apps.presentation",
}


@dataclass(frozen=True)
class GoogleWorkspaceExportObject:
    id: str
    title: str
    filename: str
    kind: str
    mime_type: str
    bytes: int
    object_key: str | None


@dataclass(frozen=True)
class GoogleWorkspaceExportParams:
    action_id: str
    request_id: str
    workspace_id: str
    project_id: str
    user_id: str
    provider: GoogleExportProvider
    object: GoogleWorkspaceExportObject
    format: str | None = None


@dataclass(frozen=True)
class GoogleWorkspaceExportUploadResult:
    externalObjectId: str
    externalUrl: str
    exportedMimeType: str


@dataclass(frozen=True)
class GoogleWorkspaceExportResult:
    ok: Literal[True]
    requestId: str
    workflowId: str
    objectId: str
    provider: GoogleExportProvider
    externalObjectId: str
    externalUrl: str
    exportedMimeType: str
    exportStatus: Literal["completed"]


@dataclass(frozen=True)
class GoogleWorkspaceExportErrorResult:
    ok: Literal[False]
    requestId: str
    workflowId: str | None
    objectId: str
    provider: GoogleExportProvider
    exportStatus: Literal["failed"]
    errorCode: str
    retryable: bool = False


GoogleWorkspaceExportTerminalResult = (
    GoogleWorkspaceExportResult | GoogleWorkspaceExportErrorResult
)


class GoogleWorkspaceExportClient(Protocol):
    async def upload(
        self,
        *,
        file_path: Path,
        filename: str,
        source_mime_type: str,
        target_mime_type: str | None,
        user_id: str,
        workspace_id: str,
    ) -> GoogleWorkspaceExportUploadResult:
        ...


class LiveGoogleWorkspaceExportClient:
    async def upload(
        self,
        *,
        file_path: Path,
        filename: str,
        source_mime_type: str,
        target_mime_type: str | None,
        user_id: str,
        workspace_id: str,
    ) -> GoogleWorkspaceExportUploadResult:
        access_token = await fetch_google_drive_access_token(user_id, workspace_id)
        service = build(
            "drive",
            "v3",
            credentials=Credentials(token=access_token),
            cache_discovery=False,
        )
        media = MediaFileUpload(
            str(file_path),
            mimetype=source_mime_type,
            resumable=True,
        )
        body = {
            "name": filename,
            "mimeType": target_mime_type or source_mime_type,
        }
        try:
            uploaded = (
                service.files()
                .create(
                    body=body,
                    media_body=media,
                    fields="id, webViewLink, mimeType",
                    supportsAllDrives=True,
                )
                .execute()
            )
        except HttpError as exc:
            raise _google_http_error(exc) from exc
        finally:
            _close_media_upload(media)
        external_id = str(uploaded.get("id") or "")
        if not external_id:
            raise ApplicationError(
                "Google Drive upload response did not include a file id",
                type="google_export_missing_external_id",
                non_retryable=False,
            )
        exported_mime_type = str(
            uploaded.get("mimeType")
            or target_mime_type
            or source_mime_type
        )
        external_url = str(
            uploaded.get("webViewLink")
            or f"https://drive.google.com/open?id={external_id}"
        )
        return GoogleWorkspaceExportUploadResult(
            externalObjectId=external_id,
            externalUrl=external_url,
            exportedMimeType=exported_mime_type,
        )


_client: GoogleWorkspaceExportClient = LiveGoogleWorkspaceExportClient()


def set_google_workspace_export_client(client: GoogleWorkspaceExportClient) -> None:
    global _client
    _client = client


def reset_google_workspace_export_client() -> None:
    global _client
    _client = LiveGoogleWorkspaceExportClient()


def _google_http_error(exc: HttpError) -> ApplicationError:
    status = getattr(getattr(exc, "resp", None), "status", None)
    is_retryable = status in (408, 429) or (
        isinstance(status, int) and 500 <= status < 600
    )
    if status in (401, 403):
        err_type = "google_workspace_permission_required"
    elif status == 404:
        err_type = "google_workspace_destination_not_found"
    elif status == 413:
        err_type = "google_workspace_file_too_large"
    elif is_retryable:
        err_type = "google_workspace_provider_unavailable"
    else:
        err_type = "google_workspace_export_failed"
    return ApplicationError(
        f"Google Drive upload failed: HTTP {status}",
        type=err_type,
        non_retryable=not is_retryable,
    )


def normalize_google_workspace_export_params(
    raw: GoogleWorkspaceExportParams | dict[str, Any],
) -> GoogleWorkspaceExportParams:
    if isinstance(raw, GoogleWorkspaceExportParams):
        return raw
    obj = raw["object"]
    export_object = (
        obj
        if isinstance(obj, GoogleWorkspaceExportObject)
        else GoogleWorkspaceExportObject(
            id=str(obj["id"]),
            title=str(obj.get("title") or obj["filename"]),
            filename=str(obj["filename"]),
            kind=str(obj["kind"]),
            mime_type=str(obj.get("mime_type", obj.get("mimeType", ""))),
            bytes=int(obj.get("bytes", 0)),
            object_key=(
                str(obj.get("object_key", obj.get("objectKey")))
                if obj.get("object_key", obj.get("objectKey")) is not None
                else None
            ),
        )
    )
    return GoogleWorkspaceExportParams(
        action_id=str(raw["action_id"]),
        request_id=str(raw["request_id"]),
        workspace_id=str(raw["workspace_id"]),
        project_id=str(raw["project_id"]),
        user_id=str(raw["user_id"]),
        provider=raw["provider"],
        format=raw.get("format"),
        object=export_object,
    )


def stable_google_export_error_code(exc: Exception) -> str:
    current: BaseException | None = exc
    while current is not None:
        err_type = getattr(current, "type", None)
        if isinstance(err_type, str) and err_type:
            return err_type
        current = getattr(current, "cause", None) or current.__cause__
    return "google_workspace_export_failed"


@activity.defn(name="export_project_object_to_google_workspace")
async def export_project_object_to_google_workspace(
    raw: GoogleWorkspaceExportParams | dict[str, Any],
) -> GoogleWorkspaceExportUploadResult:
    params = normalize_google_workspace_export_params(raw)
    if not params.object.object_key:
        raise ApplicationError(
            "agent file object_key is required for Google export",
            type="google_export_missing_object_key",
            non_retryable=True,
        )
    target_mime_type = GOOGLE_NATIVE_MIME_TYPES[params.provider]
    tmp_path = download_to_tempfile(params.object.object_key)
    try:
        return await _client.upload(
            file_path=tmp_path,
            filename=params.object.filename,
            source_mime_type=params.object.mime_type,
            target_mime_type=target_mime_type,
            user_id=params.user_id,
            workspace_id=params.workspace_id,
        )
    finally:
        with suppress(OSError):
            tmp_path.unlink()


def _close_media_upload(media: MediaFileUpload) -> None:
    stream = media.stream()
    close = getattr(stream, "close", None)
    if callable(close):
        close()


@activity.defn(name="finalize_google_workspace_export")
async def finalize_google_workspace_export(
    raw_params: GoogleWorkspaceExportParams | dict[str, Any],
    raw_result: GoogleWorkspaceExportTerminalResult | dict[str, Any],
) -> dict[str, Any]:
    params = normalize_google_workspace_export_params(raw_params)
    result = (
        asdict(raw_result)
        if is_dataclass(raw_result)
        else dict(raw_result)
    )
    body = {
        **result,
        "actionId": params.action_id,
        "workspaceId": params.workspace_id,
        "projectId": params.project_id,
        "userId": params.user_id,
    }
    return await post_internal("/api/internal/google-workspace/export-results", body)


__all__ = [
    "GOOGLE_NATIVE_MIME_TYPES",
    "GoogleWorkspaceExportErrorResult",
    "GoogleWorkspaceExportObject",
    "GoogleWorkspaceExportParams",
    "GoogleWorkspaceExportResult",
    "GoogleWorkspaceExportTerminalResult",
    "GoogleWorkspaceExportUploadResult",
    "export_project_object_to_google_workspace",
    "finalize_google_workspace_export",
    "normalize_google_workspace_export_params",
    "reset_google_workspace_export_client",
    "set_google_workspace_export_client",
    "stable_google_export_error_code",
]
