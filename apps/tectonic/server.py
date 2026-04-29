"""Tectonic compile MSA — POST .tex → PDF bytes.

Security: --untrusted (no shell escape), 2MB input cap, non-root,
process-kill timeout enforcement, CTAN-only egress (compose firewall).
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


app = FastAPI(title="OpenCairn Tectonic MSA", version="0.1.0")

MAX_BYTES = int(os.environ.get("TECTONIC_MAX_INPUT_BYTES", 2 * 1024 * 1024))
DEFAULT_TIMEOUT_MS = int(os.environ.get("DEFAULT_TIMEOUT_MS", 60_000))
TECTONIC_BIN = os.environ.get("TECTONIC_BIN", "/usr/local/bin/tectonic")
CACHE_DIR = os.environ.get("TECTONIC_CACHE_DIR", "/app/cache")


class CompileRequest(BaseModel):
    tex_source: str = Field(..., max_length=MAX_BYTES)
    bib_source: Optional[str] = None
    engine: str = Field("xelatex", pattern="^(xelatex|pdflatex|lualatex)$")
    timeout_ms: int = Field(DEFAULT_TIMEOUT_MS, ge=1000, le=300_000)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/compile")
async def compile_tex(req: CompileRequest) -> Response:
    if len(req.tex_source.encode("utf-8")) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="tex_source exceeds 2MB cap")

    workdir = Path(tempfile.mkdtemp(prefix="tectonic-"))
    try:
        (workdir / "main.tex").write_text(req.tex_source, encoding="utf-8")
        if req.bib_source:
            (workdir / "refs.bib").write_text(req.bib_source, encoding="utf-8")

        cmd = [
            TECTONIC_BIN,
            "--untrusted",
            "--keep-logs",
            "--outdir", str(workdir),
            "--print",
            "main.tex",
        ]
        env = os.environ.copy()
        env["TECTONIC_CACHE_DIR"] = CACHE_DIR

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=str(workdir), env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=req.timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            try: proc.kill()
            except Exception: pass
            raise HTTPException(status_code=504, detail="compile timeout")

        if proc.returncode != 0:
            log_file = workdir / "main.log"
            log = log_file.read_text(encoding="utf-8", errors="ignore") if log_file.exists() else stderr.decode("utf-8", errors="ignore")
            raise HTTPException(status_code=400, detail={"error": "compile_failed", "log": log[-4000:]})

        pdf_path = workdir / "main.pdf"
        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail="no PDF produced")
        pdf_bytes = pdf_path.read_bytes()
        return Response(content=pdf_bytes, media_type="application/pdf")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
