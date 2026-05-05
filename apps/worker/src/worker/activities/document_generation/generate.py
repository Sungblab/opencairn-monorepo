# ruff: noqa: E501
"""Generate document bytes and upload them to object storage."""

from __future__ import annotations

import html
import re
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from typing import Any

from temporalio import activity

from worker.activities.document_generation.types import (
    MIME_TYPES,
    DocumentGenerationDestination,
    DocumentGenerationRequest,
    DocumentGenerationWorkflowParams,
    GeneratedDocumentArtifact,
)
from worker.lib.s3_client import upload_bytes


def _value(data: dict[str, Any], snake: str, camel: str | None = None, default: Any = None) -> Any:
    if snake in data:
        return data[snake]
    if camel and camel in data:
        return data[camel]
    return default


def normalize_destination(
    raw: DocumentGenerationDestination | dict[str, Any],
) -> DocumentGenerationDestination:
    if isinstance(raw, DocumentGenerationDestination):
        return raw
    return DocumentGenerationDestination(
        filename=str(raw["filename"]),
        title=raw.get("title"),
        folder_id=_value(raw, "folder_id", "folderId"),
        publish_as=_value(raw, "publish_as", "publishAs", "agent_file"),
        start_ingest=bool(_value(raw, "start_ingest", "startIngest", False)),
    )


def normalize_generation(
    raw: DocumentGenerationRequest | dict[str, Any],
) -> DocumentGenerationRequest:
    if isinstance(raw, DocumentGenerationRequest):
        return raw
    return DocumentGenerationRequest(
        format=raw["format"],
        prompt=raw["prompt"],
        locale=raw.get("locale", "ko"),
        template=raw.get("template", "report"),
        sources=list(raw.get("sources", [])),
        destination=normalize_destination(raw["destination"]),
        artifact_mode=_value(raw, "artifact_mode", "artifactMode", "object_storage"),
    )


def normalize_params(
    raw: DocumentGenerationWorkflowParams | dict[str, Any],
) -> DocumentGenerationWorkflowParams:
    if isinstance(raw, DocumentGenerationWorkflowParams):
        generation = normalize_generation(raw.generation)
        return DocumentGenerationWorkflowParams(
            action_id=raw.action_id,
            request_id=raw.request_id,
            workspace_id=raw.workspace_id,
            project_id=raw.project_id,
            user_id=raw.user_id,
            generation=generation,
        )
    return DocumentGenerationWorkflowParams(
        action_id=_value(raw, "action_id", "actionId"),
        request_id=_value(raw, "request_id", "requestId"),
        workspace_id=_value(raw, "workspace_id", "workspaceId"),
        project_id=_value(raw, "project_id", "projectId"),
        user_id=_value(raw, "user_id", "userId"),
        generation=normalize_generation(raw["generation"]),
    )


def _safe_path_segment(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip(".-")
    return normalized[:120] or "document"


def _artifact_key(
    params: DocumentGenerationWorkflowParams, generation: DocumentGenerationRequest
) -> str:
    destination = normalize_destination(generation.destination)
    filename = _safe_path_segment(destination.filename)
    request_id = _safe_path_segment(params.request_id)
    project_id = _safe_path_segment(params.project_id)
    return f"agent-files/{project_id}/document-generation/{request_id}/{filename}"


def _document_text(
    params: DocumentGenerationWorkflowParams, generation: DocumentGenerationRequest
) -> str:
    destination = normalize_destination(generation.destination)
    title = destination.title or destination.filename
    source_lines = []
    for source in generation.sources:
        label = source.get("type", "source")
        source_id = (
            source.get("noteId")
            or source.get("objectId")
            or source.get("threadId")
            or source.get("runId")
            or "unknown"
        )
        source_lines.append(f"- {label}: {source_id}")
    sources = "\n".join(source_lines) if source_lines else "- No explicit sources provided"
    return (
        f"{title}\n\n"
        f"Prompt\n{generation.prompt}\n\n"
        f"Format: {generation.format}\n"
        f"Template: {generation.template}\n"
        f"Locale: {generation.locale}\n"
        f"Request: {params.request_id}\n\n"
        f"Sources\n{sources}\n"
    )


def _zip_bytes(files: dict[str, str | bytes]) -> bytes:
    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, body in files.items():
            payload = body if isinstance(body, bytes) else body.encode("utf-8")
            zf.writestr(name, payload)
    return out.getvalue()


def _render_pdf(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\r", "")
    lines = escaped.split("\n")[:40]
    content_lines = ["BT", "/F1 12 Tf", "72 760 Td"]
    for index, line in enumerate(lines):
        if index > 0:
            content_lines.append("0 -16 Td")
        content_lines.append(f"({line[:90]}) Tj")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode("latin-1", errors="replace")
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
        b"5 0 obj << /Length "
        + str(len(stream)).encode("ascii")
        + b" >> stream\n"
        + stream
        + b"\nendstream endobj\n",
    ]
    body = BytesIO()
    body.write(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(body.tell())
        body.write(obj)
    xref_offset = body.tell()
    body.write(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    body.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        body.write(f"{offset:010d} 00000 n \n".encode("ascii"))
    body.write(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return body.getvalue()


def _render_docx(text: str) -> bytes:
    paragraphs = "".join(
        f"<w:p><w:r><w:t>{html.escape(line)}</w:t></w:r></w:p>" for line in text.splitlines()
    )
    return _zip_bytes(
        {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                "</Types>"
            ),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="word/document.xml"/></Relationships>'
            ),
            "word/document.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"<w:body>{paragraphs}<w:sectPr/></w:body></w:document>"
            ),
        }
    )


def _render_pptx(text: str) -> bytes:
    title = html.escape(text.splitlines()[0] if text.splitlines() else "Document")
    body = html.escape("\n".join(text.splitlines()[1:20]))
    slide = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        "<p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>"
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
        "<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>"
        f"{title}</a:t></a:r></a:p><a:p><a:r><a:t>{body}</a:t></a:r></a:p>"
        "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
    )
    return _zip_bytes(
        {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/ppt/presentation.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
                '<Override PartName="/ppt/slides/slide1.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
                "</Types>"
            ),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="ppt/presentation.xml"/></Relationships>'
            ),
            "ppt/presentation.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
            ),
            "ppt/_rels/presentation.xml.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" '
                'Target="slides/slide1.xml"/></Relationships>'
            ),
            "ppt/slides/slide1.xml": slide,
        }
    )


def _render_xlsx(text: str) -> bytes:
    rows = [
        ("Generated At", datetime.now(UTC).isoformat()),
        ("Prompt", text.split("Prompt\n", 1)[-1].split("\n\n", 1)[0]),
        ("Summary", text[:200]),
    ]
    sheet_rows = "".join(
        "<row>"
        f'<c t="inlineStr"><is><t>{html.escape(k)}</t></is></c>'
        f'<c t="inlineStr"><is><t>{html.escape(v)}</t></is></c>'
        "</row>"
        for k, v in rows
    )
    return _zip_bytes(
        {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/xl/workbook.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                '<Override PartName="/xl/worksheets/sheet1.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                "</Types>"
            ),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="xl/workbook.xml"/></Relationships>'
            ),
            "xl/workbook.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Generated" sheetId="1" r:id="rId1"/></sheets></workbook>'
            ),
            "xl/_rels/workbook.xml.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                'Target="worksheets/sheet1.xml"/></Relationships>'
            ),
            "xl/worksheets/sheet1.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f"<sheetData>{sheet_rows}</sheetData></worksheet>"
            ),
        }
    )


def render_document_bytes(params: DocumentGenerationWorkflowParams) -> bytes:
    generation = normalize_generation(params.generation)
    text = _document_text(params, generation)
    renderers = {
        "pdf": _render_pdf,
        "docx": _render_docx,
        "pptx": _render_pptx,
        "xlsx": _render_xlsx,
    }
    return renderers[generation.format](text)


def heartbeat_safe(message: str) -> None:
    try:
        activity.heartbeat(message)
    except RuntimeError as exc:
        if str(exc) != "Not in activity context":
            raise


@activity.defn(name="generate_document_artifact")
async def generate_document_artifact(
    params: DocumentGenerationWorkflowParams | dict[str, Any],
) -> GeneratedDocumentArtifact:
    normalized = normalize_params(params)
    generation = normalize_generation(normalized.generation)
    if generation.artifact_mode != "object_storage":
        raise ValueError("document_generation_requires_object_storage")

    heartbeat_safe(f"generating {generation.format}")
    body = render_document_bytes(normalized)
    object_key = _artifact_key(normalized, generation)
    mime_type = MIME_TYPES[generation.format]
    upload_bytes(object_key, body, mime_type)
    return GeneratedDocumentArtifact(
        objectKey=object_key,
        mimeType=mime_type,
        bytes=len(body),
    )
