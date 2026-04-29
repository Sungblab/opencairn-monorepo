"""compile_activity — dispatch by format and upload final artifact.

Markdown / LaTeX zip: worker direct S3 upload.
DOCX / PDF (Playwright): POST /api/internal/synthesis-export/compile (apps/api).
LaTeX → PDF (Pro, flag-gated): worker POSTs to Tectonic MSA, uploads PDF.
"""
from __future__ import annotations

import os

from temporalio import activity

from worker.activities.synthesis_export.latex_assemble import (
    assemble_bib, assemble_tex, package_zip,
)
from worker.activities.synthesis_export.types import (
    CompiledArtifact, SynthesisRunParams,
)
from worker.agents.synthesis_export.schemas import SynthesisOutputSchema
from worker.lib.api_client import post_internal
from worker.lib.s3_client import upload_bytes


def _is_tectonic_enabled() -> bool:
    return os.environ.get("FEATURE_TECTONIC_COMPILE", "false").lower() == "true"


def _markdown_text(output: SynthesisOutputSchema) -> str:
    parts = [f"# {output.title}\n"]
    if output.abstract:
        parts.append(f"**Abstract.** {output.abstract}\n")
    for sec in output.sections:
        parts.append(f"## {sec.title}\n\n{sec.content}\n")
    if output.bibliography:
        parts.append("\n## Sources\n")
        for b in output.bibliography:
            url = f" — {b.url}" if b.url else ""
            parts.append(f"- {b.author}, *{b.title}*{url}")
    return "\n".join(parts)


async def _post_tectonic(tex_source: str, bib_source: str) -> bytes:
    """Stub: Task 21/23 replaces with httpx POST to apps/tectonic /compile."""
    return b"%PDF-stub-replaced-in-task-23"


async def _record_document(run_id: str, format_: str, s3_key: str, byte_count: int) -> None:
    await post_internal(
        "/api/internal/synthesis-export/documents",
        {"run_id": run_id, "format": format_, "s3_key": s3_key, "bytes": byte_count},
    )


@activity.defn(name="compile_activity")
async def compile_activity(
    params: SynthesisRunParams,
    output: SynthesisOutputSchema,
) -> CompiledArtifact:
    activity.heartbeat(f"compiling {params.format}")
    fmt = params.format

    if fmt == "md":
        body = _markdown_text(output).encode("utf-8")
        key = f"synthesis/runs/{params.run_id}/document.md"
        upload_bytes(key, body, "text/markdown; charset=utf-8")
        await _record_document(params.run_id, "md", key, len(body))
        return CompiledArtifact(s3_key=key, bytes=len(body), format="md")

    if fmt == "latex":
        tex = assemble_tex(output)
        bib = assemble_bib(output.bibliography) if output.bibliography else None

        if _is_tectonic_enabled():
            pdf_bytes = await _post_tectonic(tex, bib or "")
            key = f"synthesis/runs/{params.run_id}/document.pdf"
            upload_bytes(key, pdf_bytes, "application/pdf")
            await _record_document(params.run_id, "pdf", key, len(pdf_bytes))
            return CompiledArtifact(s3_key=key, bytes=len(pdf_bytes), format="pdf")

        zip_bytes = package_zip(tex, bib)
        key = f"synthesis/runs/{params.run_id}/document.zip"
        upload_bytes(key, zip_bytes, "application/zip")
        await _record_document(params.run_id, "zip", key, len(zip_bytes))
        return CompiledArtifact(s3_key=key, bytes=len(zip_bytes), format="zip")

    if fmt in ("docx", "pdf"):
        res = await post_internal(
            "/api/internal/synthesis-export/compile",
            {
                "run_id": params.run_id,
                "format": fmt,
                "output": output.model_dump(),
            },
        )
        s3_key = res["s3Key"]
        byte_count = res.get("bytes", 0)
        await _record_document(params.run_id, fmt, s3_key, byte_count)
        return CompiledArtifact(s3_key=s3_key, bytes=byte_count, format=fmt)

    raise ValueError(f"Unsupported format: {fmt}")
