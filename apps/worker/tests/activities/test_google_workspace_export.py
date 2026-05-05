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

    def upload(
        self,
        *,
        file_path: Path,
        filename: str,
        source_mime_type: str,
        target_mime_type: str | None,
    ) -> gwe.GoogleWorkspaceExportUploadResult:
        self.calls.append(
            {
                "file_path": file_path,
                "filename": filename,
                "source_mime_type": source_mime_type,
                "target_mime_type": target_mime_type,
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
