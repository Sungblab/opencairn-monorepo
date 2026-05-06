from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from temporalio.exceptions import ApplicationError

from worker.activities import google_workspace_export as gwe

if TYPE_CHECKING:
    from pathlib import Path

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class FakeGoogleClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def upload(
        self,
        *,
        file_path: Path,
        filename: str,
        source_mime_type: str,
        target_mime_type: str | None,
        user_id: str,
        workspace_id: str,
    ) -> gwe.GoogleWorkspaceExportUploadResult:
        self.calls.append(
            {
                "file_path": file_path,
                "filename": filename,
                "source_mime_type": source_mime_type,
                "target_mime_type": target_mime_type,
                "user_id": user_id,
                "workspace_id": workspace_id,
                "exists": file_path.exists(),
            }
        )
        return gwe.GoogleWorkspaceExportUploadResult(
            externalObjectId="google-file-1",
            externalUrl="https://docs.google.com/document/d/google-file-1/edit",
            exportedMimeType=target_mime_type or source_mime_type,
        )


@pytest.fixture(autouse=True)
def reset_google_client():
    yield
    gwe.reset_google_workspace_export_client()


async def test_exports_docx_as_google_docs_with_mock_client(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.docx"
    source.write_bytes(b"docx")
    monkeypatch.setattr(gwe, "download_to_tempfile", lambda _key: source)
    client = FakeGoogleClient()
    gwe.set_google_workspace_export_client(client)

    result = await gwe.export_project_object_to_google_workspace(
        {
            "action_id": "action-1",
            "request_id": "00000000-0000-4000-8000-000000000001",
            "workspace_id": "00000000-0000-4000-8000-000000000002",
            "project_id": "00000000-0000-4000-8000-000000000003",
            "user_id": "user-1",
            "provider": "google_docs",
            "object": {
                "id": "00000000-0000-4000-8000-000000000004",
                "title": "Brief",
                "filename": "brief.docx",
                "kind": "docx",
                "mime_type": DOCX_MIME,
                "bytes": 4,
                "object_key": "agent-files/brief.docx",
            },
        }
    )

    assert result.externalObjectId == "google-file-1"
    assert result.exportedMimeType == "application/vnd.google-apps.document"
    assert client.calls == [
        {
            "file_path": source,
            "filename": "brief.docx",
            "source_mime_type": DOCX_MIME,
            "target_mime_type": "application/vnd.google-apps.document",
            "user_id": "user-1",
            "workspace_id": "00000000-0000-4000-8000-000000000002",
            "exists": True,
        }
    ]
    assert not source.exists()


async def test_rejects_missing_object_key() -> None:
    with pytest.raises(ApplicationError) as exc:
        await gwe.export_project_object_to_google_workspace(
            {
                "action_id": "action-1",
                "request_id": "00000000-0000-4000-8000-000000000001",
                "workspace_id": "00000000-0000-4000-8000-000000000002",
                "project_id": "00000000-0000-4000-8000-000000000003",
                "user_id": "user-1",
                "provider": "google_drive",
                "object": {
                    "id": "00000000-0000-4000-8000-000000000004",
                    "title": "Brief",
                    "filename": "brief.pdf",
                    "kind": "pdf",
                    "mime_type": "application/pdf",
                    "bytes": 4,
                    "object_key": None,
                },
            }
        )

    assert exc.value.type == "google_export_missing_object_key"


async def test_live_client_uploads_with_drive_conversion_request(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.pptx"
    source.write_bytes(b"pptx")
    calls: dict[str, object] = {}

    async def fake_fetch_token(user_id: str, workspace_id: str) -> str:
        calls["token_scope"] = (user_id, workspace_id)
        return "access-token"

    class FakeCreate:
        def __init__(self, kwargs: dict) -> None:
            self.kwargs = kwargs

        def execute(self) -> dict:
            calls["create_kwargs"] = self.kwargs
            return {
                "id": "google-slide-1",
                "webViewLink": "https://docs.google.com/presentation/d/google-slide-1/edit",
                "mimeType": "application/vnd.google-apps.presentation",
            }

    class FakeFiles:
        def create(self, **kwargs: object) -> FakeCreate:
            return FakeCreate(dict(kwargs))

    class FakeService:
        def files(self) -> FakeFiles:
            return FakeFiles()

    monkeypatch.setattr(gwe, "fetch_google_drive_access_token", fake_fetch_token)
    monkeypatch.setattr(gwe, "build", lambda *args, **kwargs: FakeService())

    result = await gwe.LiveGoogleWorkspaceExportClient().upload(
        file_path=source,
        filename="deck.pptx",
        source_mime_type=(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ),
        target_mime_type="application/vnd.google-apps.presentation",
        user_id="user-1",
        workspace_id="workspace-1",
    )

    assert calls["token_scope"] == ("user-1", "workspace-1")
    create_kwargs = calls["create_kwargs"]
    assert isinstance(create_kwargs, dict)
    assert create_kwargs["body"] == {
        "name": "deck.pptx",
        "mimeType": "application/vnd.google-apps.presentation",
    }
    assert create_kwargs["supportsAllDrives"] is True
    assert result.externalObjectId == "google-slide-1"
    assert result.exportedMimeType == "application/vnd.google-apps.presentation"
    assert result.externalUrl.endswith("/google-slide-1/edit")


async def test_finalize_google_workspace_export_posts_terminal_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict]] = []

    async def fake_post(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {"ok": True}

    monkeypatch.setattr(gwe, "post_internal", fake_post)

    result = await gwe.finalize_google_workspace_export(
        {
            "action_id": "action-1",
            "request_id": "00000000-0000-4000-8000-000000000001",
            "workspace_id": "00000000-0000-4000-8000-000000000002",
            "project_id": "00000000-0000-4000-8000-000000000003",
            "user_id": "user-1",
            "provider": "google_docs",
            "object": {
                "id": "00000000-0000-4000-8000-000000000004",
                "title": "Report",
                "filename": "report.docx",
                "kind": "docx",
                "mime_type": DOCX_MIME,
                "bytes": 4096,
                "object_key": "agent-files/report.docx",
            },
        },
        gwe.GoogleWorkspaceExportResult(
            ok=True,
            requestId="00000000-0000-4000-8000-000000000001",
            workflowId="google-workspace-export/00000000-0000-4000-8000-000000000001",
            objectId="00000000-0000-4000-8000-000000000004",
            provider="google_docs",
            externalObjectId="google-doc-1",
            externalUrl="https://docs.google.com/document/d/google-doc-1/edit",
            exportedMimeType="application/vnd.google-apps.document",
            exportStatus="completed",
        ),
    )

    assert result == {"ok": True}
    assert calls == [
        (
            "/api/internal/google-workspace/export-results",
            {
                "ok": True,
                "requestId": "00000000-0000-4000-8000-000000000001",
                "workflowId": "google-workspace-export/00000000-0000-4000-8000-000000000001",
                "objectId": "00000000-0000-4000-8000-000000000004",
                "provider": "google_docs",
                "externalObjectId": "google-doc-1",
                "externalUrl": "https://docs.google.com/document/d/google-doc-1/edit",
                "exportedMimeType": "application/vnd.google-apps.document",
                "exportStatus": "completed",
                "actionId": "action-1",
                "workspaceId": "00000000-0000-4000-8000-000000000002",
                "projectId": "00000000-0000-4000-8000-000000000003",
                "userId": "user-1",
            },
        )
    ]
