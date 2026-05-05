from __future__ import annotations

import asyncio
from io import BytesIO
from unittest.mock import patch

import pymupdf
import pytest
from docx import Document
from openpyxl import load_workbook
from pptx import Presentation

from worker.activities.document_generation.generate import generate_document_artifact
from worker.activities.document_generation.register import register_document_generation_result
from worker.activities.document_generation.sources import hydrate_document_generation_sources
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
    assert bytes(uploaded["data"]).startswith(b"%PDF-")


@pytest.mark.asyncio
async def test_hydrate_document_generation_sources_fetches_note_bodies() -> None:
    calls: list[tuple[str, dict]] = []

    async def fake_post(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {
            "id": body["source_id"],
            "title": "시장 조사 노트",
            "body": "핵심 근거: 한국어 문서 생성 품질을 검증합니다.",
            "kind": "note",
        }

    with patch("worker.activities.document_generation.sources.post_internal", fake_post):
        result = await hydrate_document_generation_sources(_request("pdf"))

    assert calls == [
        (
            "/api/internal/synthesis-export/fetch-source",
            {
                "source_id": "00000000-0000-4000-8000-000000000021",
                "kind": "note",
            },
        )
    ]
    assert result.items[0].title == "시장 조사 노트"
    assert "한국어 문서 생성 품질" in result.items[0].body


@pytest.mark.asyncio
async def test_hydrate_document_generation_sources_fetches_notes_with_bounded_concurrency() -> None:
    request = _request("pdf")
    request["generation"]["sources"] = [
        {
            "type": "note",
            "noteId": f"00000000-0000-4000-8000-0000000000{index:02d}",
        }
        for index in range(21, 27)
    ]
    in_flight = 0
    max_in_flight = 0

    async def fake_post(_path: str, body: dict) -> dict:
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        await asyncio.sleep(0.01)
        in_flight -= 1
        return {
            "id": body["source_id"],
            "title": f"노트 {body['source_id'][-2:]}",
            "body": "동시 hydration 검증 본문",
            "kind": "note",
        }

    with patch("worker.activities.document_generation.sources.post_internal", fake_post):
        result = await hydrate_document_generation_sources(request)

    assert len(result.items) == 6
    assert max_in_flight > 1


@pytest.mark.asyncio
async def test_generate_document_artifact_preserves_korean_and_long_pdf_content() -> None:
    uploaded: dict[str, object] = {}
    request = _request("pdf")
    request["generation"]["prompt"] = "\n".join(
        f"한글 문단 {index}: 긴 문서 생성 결과를 절단하지 않고 PDF에 보존합니다."
        for index in range(80)
    )

    def fake_upload(key: str, data: bytes, content_type: str) -> str:
        uploaded.update({"key": key, "data": data, "content_type": content_type})
        return key

    with patch("worker.activities.document_generation.generate.upload_bytes", fake_upload):
        await generate_document_artifact(request)

    doc = pymupdf.open(stream=bytes(uploaded["data"]), filetype="pdf")
    extracted = "\n".join(page.get_text() for page in doc)
    assert len(doc) > 1
    assert "한글 문단 0" in extracted
    assert "한글 문단 79" in extracted


@pytest.mark.asyncio
async def test_generate_document_artifact_creates_source_aware_docx() -> None:
    uploaded: dict[str, object] = {}
    request = _request("docx")

    def fake_upload(key: str, data: bytes, content_type: str) -> str:
        uploaded.update({"key": key, "data": data, "content_type": content_type})
        return key

    with patch("worker.activities.document_generation.generate.upload_bytes", fake_upload):
        result = await generate_document_artifact(
            request,
            {
                "items": [
                    {
                        "id": "00000000-0000-4000-8000-000000000021",
                        "title": "시장 조사 노트",
                        "body": "핵심 근거: 한국어 DOCX 본문입니다.",
                        "kind": "note",
                        "token_count": 16,
                        "included": True,
                    }
                ]
            },
        )

    assert result.objectKey.endswith("/project-report.docx")
    document = Document(BytesIO(bytes(uploaded["data"])))
    document_text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "시장 조사 노트" in document_text
    assert "한국어 DOCX 본문입니다" in document_text


@pytest.mark.asyncio
async def test_generate_document_artifact_creates_readable_pptx_deck() -> None:
    uploaded: dict[str, object] = {}

    def fake_upload(key: str, data: bytes, content_type: str) -> str:
        uploaded.update({"key": key, "data": data, "content_type": content_type})
        return key

    with patch("worker.activities.document_generation.generate.upload_bytes", fake_upload):
        await generate_document_artifact(
            _request("pptx"),
            {
                "items": [
                    {
                        "id": "00000000-0000-4000-8000-000000000021",
                        "title": "시장 조사 노트",
                        "body": "첫 번째 근거\n두 번째 근거",
                        "kind": "note",
                        "token_count": 8,
                        "included": True,
                    }
                ]
            },
        )

    presentation = Presentation(BytesIO(bytes(uploaded["data"])))
    slide_text = "\n".join(
        shape.text
        for slide in presentation.slides
        for shape in slide.shapes
        if hasattr(shape, "text")
    )
    assert len(presentation.slides) >= 3
    assert "Project report" in slide_text
    assert "시장 조사 노트" in slide_text


@pytest.mark.asyncio
async def test_generate_document_artifact_pptx_preserves_long_sources() -> None:
    uploaded: dict[str, object] = {}
    sources = [
        {
            "id": f"00000000-0000-4000-8000-0000000001{index:02d}",
            "title": f"소스 {index}",
            "body": "\n".join(f"소스 {index} 라인 {line}" for line in range(10)),
            "kind": "note",
            "token_count": 20,
            "included": True,
        }
        for index in range(10)
    ]

    def fake_upload(key: str, data: bytes, content_type: str) -> str:
        uploaded.update({"key": key, "data": data, "content_type": content_type})
        return key

    with patch("worker.activities.document_generation.generate.upload_bytes", fake_upload):
        await generate_document_artifact(_request("pptx"), {"items": sources})

    presentation = Presentation(BytesIO(bytes(uploaded["data"])))
    slide_text = "\n".join(
        shape.text
        for slide in presentation.slides
        for shape in slide.shapes
        if hasattr(shape, "text")
    )
    assert "소스 0 라인 9" in slide_text
    assert "소스 9 라인 9" in slide_text


@pytest.mark.asyncio
async def test_generate_document_artifact_creates_structured_xlsx_workbook() -> None:
    uploaded: dict[str, object] = {}

    def fake_upload(key: str, data: bytes, content_type: str) -> str:
        uploaded.update({"key": key, "data": data, "content_type": content_type})
        return key

    with patch("worker.activities.document_generation.generate.upload_bytes", fake_upload):
        await generate_document_artifact(
            _request("xlsx"),
            {
                "items": [
                    {
                        "id": "00000000-0000-4000-8000-000000000021",
                        "title": "시장 조사 노트",
                        "body": "핵심 근거: 스프레드시트 검증",
                        "kind": "note",
                        "token_count": 10,
                        "included": True,
                    }
                ]
            },
        )

    workbook = load_workbook(BytesIO(bytes(uploaded["data"])))
    assert workbook.sheetnames == ["Summary", "Sources"]
    summary = workbook["Summary"]
    sources = workbook["Sources"]
    assert summary["A1"].value == "Field"
    assert summary["B1"].value == "Value"
    assert sources["A1"].value == "Source ID"
    assert sources["B2"].value == "note"
    assert sources["C2"].value == "시장 조사 노트"


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
