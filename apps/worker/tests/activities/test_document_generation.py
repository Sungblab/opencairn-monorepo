from __future__ import annotations

import zipfile
from io import BytesIO
from unittest.mock import patch

import pytest

from worker.activities.document_generation.generate import generate_document_artifact
from worker.activities.document_generation.register import register_document_generation_result
from worker.activities.document_generation.types import GeneratedDocumentArtifact


def _request(format_: str = "pdf") -> dict:
    return {
        "actionId": "00000000-0000-4000-8000-000000000011",
        "requestId": "00000000-0000-4000-8000-000000000020",
        "workspaceId": "00000000-0000-4000-8000-000000000001",
        "projectId": "00000000-0000-4000-8000-000000000003",
        "userId": "00000000-0000-4000-8000-000000000004",
        "generation": {
            "format": format_,
            "prompt": "Generate a polished project report.",
            "locale": "ko",
            "template": "report",
            "sources": [
                {
                    "type": "note",
                    "noteId": "00000000-0000-4000-8000-000000000021",
                }
            ],
            "destination": {
                "filename": f"project-report.{format_}",
                "title": "Project report",
                "publishAs": "agent_file",
                "startIngest": False,
            },
            "artifactMode": "object_storage",
        },
    }


@pytest.mark.asyncio
async def test_generate_document_artifact_uploads_pdf_to_object_storage() -> None:
    uploaded: dict[str, object] = {}

    def fake_upload(key: str, data: bytes, content_type: str) -> str:
        uploaded.update({"key": key, "data": data, "content_type": content_type})
        return key

    with patch("worker.activities.document_generation.generate.upload_bytes", fake_upload):
        result = await generate_document_artifact(_request("pdf"))

    assert result.objectKey.endswith("/project-report.pdf")
    assert result.objectKey.startswith(
        "agent-files/00000000-0000-4000-8000-000000000003/document-generation/"
    )
    assert result.mimeType == "application/pdf"
    assert result.bytes == len(uploaded["data"])
    assert uploaded["content_type"] == "application/pdf"
    assert bytes(uploaded["data"]).startswith(b"%PDF-1.4")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("format_", "member"),
    [
        ("docx", "word/document.xml"),
        ("pptx", "ppt/slides/slide1.xml"),
        ("xlsx", "xl/worksheets/sheet1.xml"),
    ],
)
async def test_generate_document_artifact_creates_office_zip_package(
    format_: str,
    member: str,
) -> None:
    uploaded: dict[str, object] = {}

    def fake_upload(key: str, data: bytes, content_type: str) -> str:
        uploaded.update({"key": key, "data": data, "content_type": content_type})
        return key

    with patch("worker.activities.document_generation.generate.upload_bytes", fake_upload):
        result = await generate_document_artifact(_request(format_))

    assert result.objectKey.endswith(f"/project-report.{format_}")
    with zipfile.ZipFile(BytesIO(bytes(uploaded["data"]))) as zf:
        assert member in zf.namelist()


@pytest.mark.asyncio
async def test_register_document_generation_result_posts_internal_agent_file_payload() -> None:
    calls: list[tuple[str, dict]] = []

    async def fake_post(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {
            "object": {
                "id": "00000000-0000-4000-8000-000000000010",
                "objectType": "agent_file",
                "title": "Project report",
                "filename": "project-report.pdf",
                "kind": "pdf",
                "mimeType": "application/pdf",
                "projectId": "00000000-0000-4000-8000-000000000003",
            }
        }

    artifact = GeneratedDocumentArtifact(
        objectKey="agent-files/project/document-generation/request/project-report.pdf",
        mimeType="application/pdf",
        bytes=128,
    )
    with patch("worker.activities.document_generation.register.post_internal", fake_post):
        result = await register_document_generation_result(
            _request("pdf"),
            artifact,
            "document-generation/00000000-0000-4000-8000-000000000020",
        )

    assert result.id == "00000000-0000-4000-8000-000000000010"
    assert calls[0][0] == "/api/internal/document-generation/agent-files"
    body = calls[0][1]
    assert body["actionId"] == "00000000-0000-4000-8000-000000000011"
    assert body["requestId"] == "00000000-0000-4000-8000-000000000020"
    assert body["workflowId"] == "document-generation/00000000-0000-4000-8000-000000000020"
    assert body["workspaceId"] == "00000000-0000-4000-8000-000000000001"
    assert body["projectId"] == "00000000-0000-4000-8000-000000000003"
    assert body["objectKey"] == artifact.objectKey
    assert body["source"] == "document_generation"
