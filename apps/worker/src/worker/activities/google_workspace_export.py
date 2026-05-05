"""Google Workspace export activity skeleton.

The production live Google client is intentionally not enabled in this slice.
Tests inject a fake client so the worker contract, MIME mapping, and retryable
error handling are covered without making Google API calls.
"""
from __future__ import annotations

from contextlib import suppress
from dataclasses import asdict, dataclass, is_dataclass
from typing import TYPE_CHECKING, Any, Literal, Protocol

from temporalio import activity
from temporalio.exceptions import ApplicationError

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
    def upload(
        self,
        *,
        file_path: Path,
        filename: str,
        source_mime_type: str,
        target_mime_type: str | None,
    ) -> GoogleWorkspaceExportUploadResult:
        ...


class LiveGoogleWorkspaceExportDisabledClient:
    def upload(
        self,
        *,
        file_path: Path,
        filename: str,
        source_mime_type: str,
        target_mime_type: str | None,
    ) -> GoogleWorkspaceExportUploadResult:
        raise ApplicationError(
            "Live Google Workspace export is not enabled in this foundation slice",
            type="google_export_live_disabled",
            non_retryable=True,
        )


_client: GoogleWorkspaceExportClient = LiveGoogleWorkspaceExportDisabledClient()


def set_google_workspace_export_client(client: GoogleWorkspaceExportClient) -> None:
    global _client
    _client = client


def reset_google_workspace_export_client() -> None:
    global _client
    _client = LiveGoogleWorkspaceExportDisabledClient()


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
        return _client.upload(
            file_path=tmp_path,
            filename=params.object.filename,
            source_mime_type=params.object.mime_type,
            target_mime_type=target_mime_type,
        )
    finally:
        with suppress(FileNotFoundError):
            tmp_path.unlink()


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
