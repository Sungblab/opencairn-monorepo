# ruff: noqa: E501
"""Generate document bytes and upload them to object storage."""

from __future__ import annotations

import re
import textwrap
from datetime import UTC, datetime
from io import BytesIO
from typing import Any

from temporalio import activity

from worker.activities.document_generation.types import (
    MIME_TYPES,
    DocumentGenerationDestination,
    DocumentGenerationRequest,
    DocumentGenerationSourceBundle,
    DocumentGenerationWorkflowParams,
    GeneratedDocumentArtifact,
    normalize_source_bundle,
)
from worker.lib.s3_client import upload_bytes

PDF_PAGE_WIDTH = 595
PDF_PAGE_HEIGHT = 842
PDF_MARGIN_LEFT = 54
PDF_MARGIN_TOP = 56
PDF_MARGIN_BOTTOM = 56
PDF_FONT_SIZE = 11
PDF_LINE_HEIGHT = 16
PDF_WRAP_CHARS = 78
PDF_CJK_FONT = "korea"
MAX_SOURCE_CHARS = 4000
PPTX_WRAP_CHARS = 82
PPTX_LINES_PER_SLIDE = 8


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


def _source_reference_lines(generation: DocumentGenerationRequest) -> list[str]:
    lines = []
    for source in generation.sources:
        label = source.get("type", "source")
        source_id = (
            source.get("noteId")
            or source.get("objectId")
            or source.get("threadId")
            or source.get("runId")
            or "unknown"
        )
        lines.append(f"- {label}: {source_id}")
    return lines


def _truncate_cell_text(value: str, limit: int = MAX_SOURCE_CHARS) -> str:
    normalized = value.strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}\n..."


def _document_model(
    params: DocumentGenerationWorkflowParams,
    generation: DocumentGenerationRequest,
    sources: DocumentGenerationSourceBundle,
) -> dict[str, Any]:
    destination = normalize_destination(generation.destination)
    title = destination.title or destination.filename
    included_sources = [source for source in sources.items if source.included]
    reference_lines = _source_reference_lines(generation)
    sections = [
        {
            "title": "Prompt",
            "body": generation.prompt,
            "bullets": [],
        },
        {
            "title": "Generation Context",
            "body": "",
            "bullets": [
                f"Format: {generation.format}",
                f"Template: {generation.template}",
                f"Locale: {generation.locale}",
                f"Request: {params.request_id}",
            ],
        },
    ]
    if included_sources:
        sections.append(
            {
                "title": "Sources",
                "body": "",
                "bullets": [
                    f"{source.kind}: {source.title} ({source.id})" for source in included_sources
                ],
            }
        )
        sections.extend(
            {
                "title": source.title,
                "body": source.body.strip(),
                "bullets": [],
            }
            for source in included_sources
        )
    else:
        sections.append(
            {
                "title": "Sources",
                "body": "",
                "bullets": reference_lines or ["No explicit sources provided"],
            }
        )
    return {
        "title": title,
        "prompt": generation.prompt,
        "format": generation.format,
        "template": generation.template,
        "locale": generation.locale,
        "request_id": params.request_id,
        "sections": sections,
        "sources": included_sources,
    }


def _document_text(model: dict[str, Any]) -> str:
    parts = [str(model["title"])]
    for section in model["sections"]:
        parts.append(str(section["title"]))
        if section.get("body"):
            parts.append(str(section["body"]))
        if section.get("bullets"):
            parts.extend(f"- {bullet}" for bullet in section["bullets"])
    return (
        "\n\n".join(parts)
        .replace("\r\n", "\n")
        .replace("\r", "\n")
    )


def _pdf_lines(text: str) -> list[str]:
    lines: list[str] = []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    for paragraph in normalized.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        lines.extend(
            textwrap.wrap(
                paragraph,
                width=PDF_WRAP_CHARS,
                break_long_words=True,
                replace_whitespace=False,
                drop_whitespace=False,
            )
        )
    return lines or [""]


def _render_pdf(text: str) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = None
    y = PDF_MARGIN_TOP + PDF_FONT_SIZE
    page_bottom = PDF_PAGE_HEIGHT - PDF_MARGIN_BOTTOM

    for line in _pdf_lines(text):
        if page is None or y > page_bottom:
            page = doc.new_page(width=PDF_PAGE_WIDTH, height=PDF_PAGE_HEIGHT)
            y = PDF_MARGIN_TOP + PDF_FONT_SIZE
        if line:
            page.insert_text(
                (PDF_MARGIN_LEFT, y),
                line,
                fontsize=PDF_FONT_SIZE,
                fontname=PDF_CJK_FONT,
            )
        y += PDF_LINE_HEIGHT

    return doc.tobytes(garbage=4, deflate=True)


def _render_docx(model: dict[str, Any]) -> bytes:
    from docx import Document

    document = Document()
    document.add_heading(str(model["title"]), level=0)
    for section in model["sections"]:
        document.add_heading(str(section["title"]), level=1)
        if section.get("body"):
            for paragraph in str(section["body"]).splitlines() or [""]:
                document.add_paragraph(paragraph)
        for bullet in section.get("bullets", []):
            document.add_paragraph(str(bullet), style="List Bullet")

    out = BytesIO()
    document.save(out)
    return out.getvalue()


def _chunked(values: list[str], size: int) -> list[list[str]]:
    if not values:
        return [[]]
    return [values[index : index + size] for index in range(0, len(values), size)]


def _pptx_wrapped_lines(values: list[str]) -> list[str]:
    lines: list[str] = []
    for value in values:
        text = value.strip()
        if not text:
            lines.append("")
            continue
        for raw_line in text.splitlines():
            wrapped = textwrap.wrap(
                raw_line,
                width=PPTX_WRAP_CHARS,
                break_long_words=True,
                replace_whitespace=False,
                drop_whitespace=False,
            )
            lines.extend(wrapped or [""])
    return lines


def _render_pptx(model: dict[str, Any]) -> bytes:
    from pptx import Presentation
    from pptx.util import Inches, Pt

    presentation = Presentation()
    title_slide = presentation.slides.add_slide(presentation.slide_layouts[0])
    title_slide.shapes.title.text = str(model["title"])
    title_slide.placeholders[1].text = f"{model['template']} / {model['locale']}"

    for section in model["sections"]:
        content = []
        if section.get("body"):
            content.append(str(section["body"]))
        content.extend(str(bullet) for bullet in section.get("bullets", []))
        for page_index, lines in enumerate(
            _chunked(_pptx_wrapped_lines(content), PPTX_LINES_PER_SLIDE)
        ):
            slide = presentation.slides.add_slide(presentation.slide_layouts[1])
            title_suffix = f" ({page_index + 1})" if page_index else ""
            slide.shapes.title.text = f"{section['title']}{title_suffix}"
            body = slide.placeholders[1].text_frame
            body.clear()
            for index, line in enumerate(lines):
                paragraph = body.paragraphs[0] if index == 0 else body.add_paragraph()
                paragraph.text = line
                paragraph.font.size = Pt(16)

    for source in model["sources"]:
        source_lines = _pptx_wrapped_lines([source.body])
        for page_index, lines in enumerate(_chunked(source_lines, PPTX_LINES_PER_SLIDE)):
            slide = presentation.slides.add_slide(presentation.slide_layouts[5])
            title_suffix = f" ({page_index + 1})" if page_index else ""
            slide.shapes.title.text = f"{source.title}{title_suffix}"
            box = slide.shapes.add_textbox(Inches(0.7), Inches(1.4), Inches(8.6), Inches(4.6))
            frame = box.text_frame
            frame.clear()
            for index, line in enumerate(lines):
                paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
                paragraph.text = line
                paragraph.font.size = Pt(15)

    out = BytesIO()
    presentation.save(out)
    return out.getvalue()


def _render_xlsx(model: dict[str, Any]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    workbook = Workbook()
    summary = workbook.active
    summary.title = "Summary"
    summary.append(["Field", "Value"])
    summary.append(["Title", model["title"]])
    summary.append(["Prompt", model["prompt"]])
    summary.append(["Template", model["template"]])
    summary.append(["Locale", model["locale"]])
    summary.append(["Generated At", datetime.now(UTC).isoformat()])

    sources = workbook.create_sheet("Sources")
    sources.append(["Source ID", "Kind", "Title", "Excerpt"])
    for source in model["sources"]:
        sources.append([source.id, source.kind, source.title, _truncate_cell_text(source.body, 1000)])

    for sheet in (summary, sources):
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for column in sheet.columns:
            letter = column[0].column_letter
            sheet.column_dimensions[letter].width = min(
                max(len(str(cell.value or "")) for cell in column) + 2,
                72,
            )

    out = BytesIO()
    workbook.save(out)
    return out.getvalue()


def render_document_bytes(
    params: DocumentGenerationWorkflowParams,
    source_bundle: DocumentGenerationSourceBundle | dict[str, Any] | None = None,
) -> bytes:
    generation = normalize_generation(params.generation)
    sources = normalize_source_bundle(source_bundle)
    model = _document_model(params, generation, sources)
    if generation.format == "pptx":
        return _render_pptx(model)
    if generation.format == "xlsx":
        return _render_xlsx(model)
    text = _document_text(model)
    if generation.format == "pdf":
        return _render_pdf(text)
    if generation.format == "docx":
        return _render_docx(model)
    raise ValueError(f"Unsupported document generation format: {generation.format}")


def heartbeat_safe(message: str) -> None:
    try:
        activity.heartbeat(message)
    except RuntimeError as exc:
        if str(exc) != "Not in activity context":
            raise


@activity.defn(name="generate_document_artifact")
async def generate_document_artifact(
    params: DocumentGenerationWorkflowParams | dict[str, Any],
    source_bundle: DocumentGenerationSourceBundle | dict[str, Any] | None = None,
) -> GeneratedDocumentArtifact:
    normalized = normalize_params(params)
    generation = normalize_generation(normalized.generation)
    if generation.artifact_mode != "object_storage":
        raise ValueError("document_generation_requires_object_storage")

    heartbeat_safe(f"generating {generation.format}")
    body = render_document_bytes(normalized, source_bundle)
    object_key = _artifact_key(normalized, generation)
    mime_type = MIME_TYPES[generation.format]
    upload_bytes(object_key, body, mime_type)
    return GeneratedDocumentArtifact(
        objectKey=object_key,
        mimeType=mime_type,
        bytes=len(body),
    )
