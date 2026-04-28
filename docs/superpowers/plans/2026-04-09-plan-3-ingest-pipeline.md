# Plan 3: Ingest Pipeline 단계별 Implementation Plan

> **✅ 완료 (2026-04-20)** — Tasks 1-10 구현 완료, plan-3/ingest 브랜치에서 master 머지. 60/60 worker pytest + 29/29 llm pytest pass. ~~Office/HWP 변환(markitdown/unoserver/H2Orestart)~~ scan PDF OCR, streaming upload은 follow-up task로 분리.

> **✅ Office/HWP follow-up 완료 (2026-04-28, branch `feat/plan-3-office-hwp-followup`)** — `apps/worker/src/worker/activities/office_activity.py` (`parse_office`: markitdown for OOXML docx/pptx/xlsx/xls + unoserver→pymupdf 레거시 doc/ppt) + `hwp_activity.py` (`parse_hwp`: unoserver+H2Orestart→opendataloader-pdf), `ingest_workflow.py` MIME 분기, `temporal_main.py` 활동 등록, `Dockerfile`에 `libreoffice-{core,writer,impress,calc} + libreoffice-java-common + python3-uno + unoserver==3.5` + H2Orestart 0.7 oxt + `scripts/start-worker.sh` entrypoint(unoserver daemon → exec worker). 18 신규 pytest pass (4 office + 4 hwp + 10 dispatch parametrize). 잔여 follow-up: scan PDF OCR (audit Tier 1 #5), streaming upload. 이미지 사이즈 +500MB. ARM64 buildx 검증 + dev 서버 실 업로드 검증은 docker-compose worker profile 빌드 후 별도 작업.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ Multi-LLM 업데이트 (2026-04-13):** `get_provider()` 팩토리로 LLM 호출. 직접 gemini_client 생성 금지. 상세: `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md`

> **⚠️ 파싱 스택 업데이트 (2026-04-14):** Docling/chandra/pyhwp/LibreOffice headless(raw) → opendataloader-pdf/markitdown/unoserver/H2Orestart로 교체. 스캔 PDF는 provider.ocr()로 추상화 (Gemini Files API / tesseract). 오디오 STT는 provider.transcribe() (Gemini / faster-whisper). 상세는 본 문서 참조.

**Goal:** Build a multi-source ingest pipeline that accepts PDFs, Office docs (DOCX/PPTX/XLSX), HWP/HWPX, audio/video, images, YouTube URLs, and web URLs — converts all documents to PDF for unified viewing, extracts text/transcripts, and creates source notes in the database — all orchestrated by Temporal.

**Architecture:** File uploads hit a Hono endpoint in `apps/api` which stores the raw file in MinIO/R2 and enqueues a Temporal workflow. `apps/worker` (Python) runs Temporal activities: PDF 텍스트 추출 (opendataloader-pdf), 스캔 감지 (pymupdf), 스캔 OCR (provider.ocr()), Office 문서 추출 (markitdown), 뷰어용 PDF 변환 (unoserver + H2Orestart), 오디오/영상 전사 (provider.transcribe()), 이미지 분석 (provider.generate(image=)), web scraping (trafilatura). 모든 문서는 PDF로 변환되어 R2에 보관 — 프론트엔드는 `@react-pdf-viewer/core`로 단일 뷰어 사용. On completion, the worker calls back into the API to create a source note and optionally trigger the Compiler Agent (LightRAG 인덱싱 포함).

**Tech Stack:** Hono 4, MinIO/R2 (S3-compatible; dev는 MinIO), Temporal Python SDK, opendataloader-pdf (PDF 텍스트, **Java 11 이상 요구; Worker Dockerfile은 LTS 일관성을 위해 OpenJDK 21 사용**), pymupdf (스캔 감지), markitdown[docx,pptx,xlsx,xls] (Office 문서), unoserver + H2Orestart (문서→PDF 변환, HWP/HWPX 지원), faster-whisper (로컬 STT fallback, WHISPER_MODEL env), trafilatura (웹 스크래핑), crawl4ai (JS 렌더링 페이지, 선택적), yt-dlp, LightRAG (RAG + KG), packages/llm get_provider() (Gemini/Ollama 추상화 — OpenAI는 2026-04-15 제거), Zod, PostgreSQL (Drizzle + pgvector), Redis, Docker Compose

> **호스팅:** Production 호스팅 환경은 미정 (오라클/Hetzner/AWS/Fly.io 등 후보). 모든 컴포넌트는 Linux x86_64 + aarch64 둘 다 호환되어야 함. ARM 호환성은 모든 의존성(opendataloader-pdf의 Java, unoserver의 LibreOffice, H2Orestart, faster-whisper)에서 검증 완료.

> **파일 제한 & 격리:**
> - **파일 크기 상한**: 기본 200MB (env `MAX_UPLOAD_BYTES`). 이미지는 20MB, 오디오/영상은 500MB. Hono 미들웨어에서 사전 차단.
> - **Dead-letter / quarantine 경로**: 파싱 실패 3회 재시도 후에도 실패한 파일은 R2의 `quarantine/<user_id>/<yyyy-mm>/` prefix로 이동하고 원본 버킷에서 삭제. `jobs.error`에 실패 사유 + quarantine key 기록. 관리자가 주기적으로 검사.

---

## File Structure

```
apps/
  api/
    src/
      routes/
        ingest.ts               -- POST /ingest/upload, POST /ingest/url
      lib/
        s3.ts                -- MinIO/R2 client + upload helpers
        temporal-client.ts      -- Temporal client singleton

  worker/
    pyproject.toml              -- Python project config (uv)
    Dockerfile                  -- Python 3.12 + Java 11 (Adoptium aarch64) + unoserver + H2Orestart + faster-whisper
    src/
      worker/
        __init__.py
        main.py                 -- Temporal worker entry point
        workflows/
          __init__.py
          ingest_workflow.py    -- IngestWorkflow definition
        activities/
          __init__.py
          pdf_activity.py       -- pymupdf 스캔감지 → opendataloader-pdf (텍스트) / provider.ocr() (스캔)
          office_activity.py    -- markitdown (텍스트 추출) + unoserver PDF 변환 (뷰어용)
          hwp_activity.py       -- unoserver + H2Orestart → PDF → opendataloader-pdf (텍스트)
          audio_activity.py     -- provider.transcribe() [Gemini: generate()+오디오 / 로컬: faster-whisper]
          image_activity.py     -- provider.generate(image=) [Gemini Vision / Ollama: llava·moondream]
          youtube_activity.py   -- Gemini YouTube URL 직접 / fallback: yt-dlp → provider.transcribe()
          web_activity.py       -- trafilatura (정적 HTML) / crawl4ai (JS 렌더링, 선택적)
          lightrag_activity.py  -- LightRAG 인덱싱 (엔티티/관계 추출 + 벡터 저장)
          note_activity.py      -- create source note via API callback
        lib/
          r2_client.py          -- download objects from MinIO/R2
          api_client.py         -- internal API callback helpers

docker-compose.yml              -- add: temporal, temporal-ui, MinIO/R2 services
.env.example                    -- add: MinIO/R2_*, TEMPORAL_*, GEMINI_API_KEY
```

---

### Task 1: File Upload API Endpoint (Hono → MinIO/R2)

**Files:**

- Create: `apps/api/src/lib/s3.ts`
- Create: `apps/api/src/lib/temporal-client.ts`
- Create: `apps/api/src/routes/ingest.ts`
- Modify: `apps/api/src/app.ts` (mount ingest routes)
- Modify: `docker-compose.yml` (add MinIO/R2 service)
- Modify: `.env.example` (add MinIO/R2 + Temporal vars)

- [ ] **Step 1: Add docker-compose MinIO/R2 service**

```yaml
# Add to docker-compose.yml services:
  minio:
    # Dev용 S3-호환 스토리지. Production은 Cloudflare R2로 교체.
    image: minio/minio:RELEASE.2024-11-07T00-52-20Z
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  minio_data:
```

- [ ] **Step 2: Add env vars to .env.example**

```bash
# MinIO/R2
S3_ENDPOINT=localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=opencairn-uploads
S3_USE_SSL=false

# Temporal
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=ingest

# LLM Provider (gemini | ollama)  — openai는 2026-04-15 제거
LLM_PROVIDER=gemini
LLM_API_KEY=your-gemini-api-key-here
LLM_MODEL=gemini-3-flash-preview
EMBED_MODEL=gemini-embedding-2-preview
VECTOR_DIM=3072

# 로컬 STT (faster-whisper) — LLM_PROVIDER=ollama 시 사용
# tiny | base | small | medium | large-v3 (사용자 선택)
WHISPER_MODEL=medium

# Upload limits
MAX_UPLOAD_BYTES=209715200         # 200 MB 기본
MAX_IMAGE_BYTES=20971520           # 20 MB
MAX_AUDIO_VIDEO_BYTES=524288000    # 500 MB
INGEST_QUARANTINE_PREFIX=quarantine/

# Internal API secret (worker → API callbacks)
INTERNAL_API_SECRET=change-me-in-production
```

- [ ] **Step 3: Install MinIO/R2 and Temporal client packages in apps/api**

```bash
cd apps/api
pnpm add minio @temporalio/client
```

- [ ] **Step 4: Create apps/api/src/lib/s3.ts**

```ts
// apps/api/src/lib/s3.ts
import { Client } from 'minio'

let _client: Client | null = null

export function getS3Client(): Client {
  if (_client) return _client
  _client = new Client({
    endPoint: process.env.S3_ENDPOINT?.split(':')[0] ?? 'localhost',
    port: Number(process.env.S3_ENDPOINT?.split(':')[1] ?? 9000),
    useSSL: process.env.S3_USE_SSL === 'true',
    accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  })
  return _client
}

const BUCKET = process.env.S3_BUCKET ?? 'opencairn-uploads'

/** Ensure bucket exists (call once at startup). */
export async function ensureBucket(): Promise<void> {
  const client = getS3Client()
  const exists = await client.bucketExists(BUCKET)
  if (!exists) await client.makeBucket(BUCKET, 'us-east-1')
}

/** Upload a Buffer or stream to MinIO/R2 and return the object key. */
export async function uploadObject(
  key: string,
  data: Buffer,
  contentType: string
): Promise<string> {
  const client = getS3Client()
  await client.putObject(BUCKET, key, data, data.length, {
    'Content-Type': contentType,
  })
  return key
}
```

- [ ] **Step 5: Create apps/api/src/lib/temporal-client.ts**

```ts
// apps/api/src/lib/temporal-client.ts
import { Connection, Client } from "@temporalio/client";

let _client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client;
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  });
  _client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });
  return _client;
}
```

- [ ] **Step 6: Create apps/api/src/routes/ingest.ts**

```ts
// apps/api/src/routes/ingest.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authMiddleware } from "../middleware/auth";
import { uploadObject } from "../lib/s3";
import { getTemporalClient } from "../lib/temporal-client";

export const ingest = new Hono();

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ingest";

// 크기 상한 정책 (env로 override 가능)
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);
const MAX_IMAGE = Number(process.env.MAX_IMAGE_BYTES ?? 20 * 1024 * 1024);
const MAX_AV = Number(process.env.MAX_AUDIO_VIDEO_BYTES ?? 500 * 1024 * 1024);

function maxBytesFor(mimeType: string): number {
  if (mimeType.startsWith("image/")) return MAX_IMAGE;
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return MAX_AV;
  return MAX_UPLOAD;
}

// POST /ingest/upload — multipart file upload
ingest.post("/upload", authMiddleware, async (c) => {
  const session = c.get("session");
  const body = await c.req.parseBody();
  const file = body["file"];
  const noteId = body["noteId"] as string | undefined;
  const projectId = body["projectId"] as string;

  if (!(file instanceof File)) {
    return c.json({ error: "file is required" }, 400);
  }
  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  const maxAllowed = maxBytesFor(file.type);
  if (file.size > maxAllowed) {
    return c.json({ error: `File exceeds ${maxAllowed} bytes for type ${file.type}` }, 413);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() ?? "bin";
  const objectKey = `uploads/${session.userId}/${randomUUID()}.${ext}`;

  await uploadObject(objectKey, buffer, file.type);

  const workflowId = `ingest-${randomUUID()}`;
  const client = await getTemporalClient();

  await client.workflow.start("IngestWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [
      {
        objectKey,
        fileName: file.name,
        mimeType: file.type,
        userId: session.userId,
        projectId,
        noteId: noteId ?? null,
      },
    ],
  });

  return c.json({ workflowId, objectKey }, 202);
});

// POST /ingest/url — ingest a web URL or YouTube URL
const urlSchema = z.object({
  url: z.string().url(),
  projectId: z.string().uuid(),
  noteId: z.string().uuid().optional(),
});

ingest.post(
  "/url",
  authMiddleware,
  zValidator("json", urlSchema),
  async (c) => {
    const session = c.get("session");
    const { url, projectId, noteId } = c.req.valid("json");

    const workflowId = `ingest-url-${randomUUID()}`;
    const client = await getTemporalClient();

    await client.workflow.start("IngestWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          url,
          objectKey: null,
          fileName: null,
          mimeType:
            url.includes("youtube.com") || url.includes("youtu.be")
              ? "x-opencairn/youtube"
              : "x-opencairn/web-url",
          userId: session.userId,
          projectId,
          noteId: noteId ?? null,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  },
);
```

- [ ] **Step 7: Mount ingest routes in apps/api/src/app.ts**

```ts
import { ingest } from "./routes/ingest";
app.route("/ingest", ingest);
```

- [ ] **Step 8: Call ensureBucket() at API startup in apps/api/src/index.ts**

```ts
import { ensureBucket } from "./lib/s3";
// Inside startup block, before app.listen():
await ensureBucket();
```

- [ ] **Commit:** `feat(api): add file upload and URL ingest endpoints with MinIO/R2 storage`

---

### Task 2: Temporal Workflow Setup (Docker Service + Python Worker Registration)

**Files:**

- Modify: `docker-compose.yml` (add Temporal + UI services)
- Create: `apps/worker/pyproject.toml`
- Create: `apps/worker/Dockerfile`
- Create: `apps/worker/src/worker/main.py`
- Create: `apps/worker/src/worker/workflows/ingest_workflow.py`

- [ ] **Step 1: Add Temporal services to docker-compose.yml**

```yaml
# Add to docker-compose.yml services:
temporal:
  image: temporalio/auto-setup:1.24
  ports:
    - "7233:7233"
  environment:
    - DB=postgres12
    - DB_PORT=5432
    - POSTGRES_USER=${POSTGRES_USER:-opencairn}
    - POSTGRES_PWD=${POSTGRES_PASSWORD:-postgres}
    - POSTGRES_SEEDS=postgres
  depends_on:
    postgres:
      condition: service_healthy

temporal-ui:
  image: temporalio/ui:2.26.2
  ports:
    - "8080:8080"
  environment:
    - TEMPORAL_ADDRESS=temporal:7233
  depends_on:
    - temporal
```

- [ ] **Step 2: Create apps/worker/pyproject.toml**

```toml
[project]
name = "opencairn-worker"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "temporalio>=1.7.0",
  "faster-whisper>=1.0.3",
  "yt-dlp>=2024.11.4",
  "trafilatura>=1.12.0",
  "google-generativeai>=0.8.3",
  "minio>=7.2.9",
  "httpx>=0.27.0",
  "python-dotenv>=1.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/worker"]
```

- [ ] **Step 3: Create apps/worker/Dockerfile**

```dockerfile
# apps/worker/Dockerfile
FROM python:3.12-slim

# Install system deps: Java 21 (for opendataloader-pdf), ffmpeg, yt-dlp deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-21-jre-headless \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

WORKDIR /app

COPY pyproject.toml .
RUN uv sync --no-dev

COPY src/ src/

# Download opendataloader-pdf jar
ARG OPENDATALOADER_VERSION=0.3.0
RUN curl -L \
  "https://github.com/opencairn/opendataloader-pdf/releases/download/v${OPENDATALOADER_VERSION}/opendataloader-pdf-${OPENDATALOADER_VERSION}-all.jar" \
  -o /app/opendataloader-pdf.jar

CMD ["uv", "run", "python", "-m", "worker.main"]
```

> Note: Replace the opendataloader-pdf jar URL with the actual release URL for your chosen version.

- [ ] **Step 4: Create apps/worker/src/worker/workflows/ingest_workflow.py**

```python
# apps/worker/src/worker/workflows/ingest_workflow.py
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.pdf_activity import parse_pdf
    from worker.activities.stt_activity import transcribe_audio
    from worker.activities.image_activity import analyze_image
    from worker.activities.youtube_activity import ingest_youtube
    from worker.activities.web_activity import scrape_web_url
    from worker.activities.gemini_enhance import enhance_with_gemini
    from worker.activities.note_activity import create_source_note


@dataclass
class IngestInput:
    object_key: Optional[str]
    file_name: Optional[str]
    mime_type: str
    user_id: str
    project_id: str
    note_id: Optional[str]
    url: Optional[str] = None


_RETRY = RetryPolicy(maximum_attempts=3, backoff_coefficient=2.0)
_LONG_TIMEOUT = timedelta(minutes=30)
_SHORT_TIMEOUT = timedelta(minutes=5)


@workflow.defn(name="IngestWorkflow")
class IngestWorkflow:
    @workflow.run
    async def run(self, inp: IngestInput) -> str:
        mime = inp.mime_type
        text: str = ""
        needs_gemini_enhance = False

        if mime == "application/pdf":
            result = await workflow.execute_activity(
                parse_pdf,
                inp,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_gemini_enhance = result.get("has_complex_layout", False)

        elif mime.startswith("audio/") or mime.startswith("video/"):
            result = await workflow.execute_activity(
                transcribe_audio,
                inp,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]

        elif mime.startswith("image/"):
            result = await workflow.execute_activity(
                analyze_image,
                inp,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["description"]

        elif mime == "x-opencairn/youtube":
            result = await workflow.execute_activity(
                ingest_youtube,
                inp,
                schedule_to_close_timeout=_LONG_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["transcript"]

        elif mime == "x-opencairn/web-url":
            result = await workflow.execute_activity(
                scrape_web_url,
                inp,
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = result["text"]
            needs_gemini_enhance = result.get("has_complex_layout", False)

        if needs_gemini_enhance:
            enhanced = await workflow.execute_activity(
                enhance_with_gemini,
                {**inp.__dict__, "raw_text": text},
                schedule_to_close_timeout=_SHORT_TIMEOUT,
                retry_policy=_RETRY,
            )
            text = enhanced.get("text", text)

        note_id = await workflow.execute_activity(
            create_source_note,
            {
                "user_id": inp.user_id,
                "project_id": inp.project_id,
                "parent_note_id": inp.note_id,
                "file_name": inp.file_name,
                "url": inp.url,
                "mime_type": mime,
                "object_key": inp.object_key,
                "text": text,
            },
            schedule_to_close_timeout=_SHORT_TIMEOUT,
            retry_policy=_RETRY,
        )

        return note_id
```

- [ ] **Step 5: Create apps/worker/src/worker/main.py**

```python
# apps/worker/src/worker/main.py
import asyncio
import os

from dotenv import load_dotenv
from temporalio.client import Client
from temporalio.worker import Worker

from worker.workflows.ingest_workflow import IngestWorkflow
from worker.activities.pdf_activity import parse_pdf
from worker.activities.stt_activity import transcribe_audio
from worker.activities.image_activity import analyze_image
from worker.activities.youtube_activity import ingest_youtube
from worker.activities.web_activity import scrape_web_url
from worker.activities.gemini_enhance import enhance_with_gemini
from worker.activities.note_activity import create_source_note

load_dotenv()


async def main() -> None:
    client = await Client.connect(
        os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )

    worker = Worker(
        client,
        task_queue=os.environ.get("TEMPORAL_TASK_QUEUE", "ingest"),
        workflows=[IngestWorkflow],
        activities=[
            parse_pdf,
            transcribe_audio,
            analyze_image,
            ingest_youtube,
            scrape_web_url,
            enhance_with_gemini,
            create_source_note,
        ],
    )

    print("[worker] Starting Temporal worker on task queue:", worker.task_queue)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Commit:** `feat(worker): scaffold Temporal worker with IngestWorkflow and Python project`

---

### Task 3: PDF Parsing Activity (opendataloader-pdf)

**Files:**

- Create: `apps/worker/src/worker/activities/pdf_activity.py`
- Create: `apps/worker/src/worker/lib/s3_client.py`

- [ ] **Step 1: Create apps/worker/src/worker/lib/s3_client.py**

```python
# apps/worker/src/worker/lib/s3_client.py
import os
import tempfile
from pathlib import Path
from minio import Minio

_client: Minio | None = None


def get_s3_client() -> Minio:
    global _client
    if _client is None:
        endpoint = os.environ.get("S3_ENDPOINT", "localhost:9000")
        _client = Minio(
            endpoint,
            access_key=os.environ.get("S3_ACCESS_KEY", "minioadmin"),
            secret_key=os.environ.get("S3_SECRET_KEY", "minioadmin"),
            secure=os.environ.get("S3_USE_SSL", "false").lower() == "true",
        )
    return _client


def download_to_tempfile(object_key: str) -> Path:
    """Download a MinIO/R2 object to a temp file and return its path."""
    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    suffix = Path(object_key).suffix or ".bin"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    client.fget_object(bucket, object_key, tmp.name)
    tmp.close()
    return Path(tmp.name)
```

- [ ] **Step 2: Create apps/worker/src/worker/activities/pdf_activity.py**

```python
# apps/worker/src/worker/activities/pdf_activity.py
import json
import os
import subprocess
import tempfile
from pathlib import Path
from dataclasses import dataclass

from temporalio import activity

from worker.lib.s3_client import download_to_tempfile

JAR_PATH = os.environ.get("OPENDATALOADER_JAR", "/app/opendataloader-pdf.jar")
# Pages-per-chunk threshold above which we flag complex layout for Gemini
COMPLEX_PAGE_THRESHOLD = int(os.environ.get("COMPLEX_PAGE_THRESHOLD", "3"))


@activity.defn(name="parse_pdf")
async def parse_pdf(inp: dict) -> dict:
    object_key: str = inp["object_key"]
    activity.logger.info("Parsing PDF: %s", object_key)

    pdf_path = download_to_tempfile(object_key)
    out_dir = Path(tempfile.mkdtemp())

    try:
        result = subprocess.run(
            [
                "java", "-jar", JAR_PATH,
                "--input", str(pdf_path),
                "--output", str(out_dir),
                "--format", "json",
                "--extract-images", "false",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            raise RuntimeError(f"opendataloader-pdf failed: {result.stderr}")

        out_file = out_dir / "output.json"
        if not out_file.exists():
            raise FileNotFoundError("opendataloader-pdf produced no output.json")

        with open(out_file) as f:
            data = json.load(f)

        pages = data.get("pages", [])
        text_parts: list[str] = []
        complex_page_count = 0

        for page in pages:
            page_text = page.get("text", "").strip()
            if page_text:
                text_parts.append(page_text)
            # Flag pages with heavy table/figure content
            if page.get("tables") or page.get("figures"):
                complex_page_count += 1

        full_text = "\n\n".join(text_parts)
        has_complex_layout = complex_page_count >= COMPLEX_PAGE_THRESHOLD

        activity.logger.info(
            "PDF parsed: %d pages, %d chars, complex=%s",
            len(pages), len(full_text), has_complex_layout
        )
        return {"text": full_text, "has_complex_layout": has_complex_layout}

    finally:
        pdf_path.unlink(missing_ok=True)
        for f in out_dir.iterdir():
            f.unlink(missing_ok=True)
        out_dir.rmdir()
```

- [ ] **Commit:** `feat(worker): add PDF parsing activity via opendataloader-pdf`

---

### Task 4: Audio/Video STT Activity (faster-whisper + ffmpeg)

**Files:**

- Create: `apps/worker/src/worker/activities/stt_activity.py`

- [ ] **Step 1: Create apps/worker/src/worker/activities/stt_activity.py**

```python
# apps/worker/src/worker/activities/stt_activity.py
import os
import subprocess
import tempfile
from pathlib import Path

from faster_whisper import WhisperModel
from temporalio import activity

from worker.lib.s3_client import download_to_tempfile

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# Module-level model cache to avoid reloading on every activity invocation
_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
    return _model


def _extract_audio(input_path: Path, output_path: Path) -> None:
    """Use ffmpeg to extract/convert audio to 16kHz mono WAV for Whisper."""
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-ar", "16000",
            "-ac", "1",
            "-f", "wav",
            str(output_path),
        ],
        capture_output=True,
        check=True,
        timeout=300,
    )


@activity.defn(name="transcribe_audio")
async def transcribe_audio(inp: dict) -> dict:
    object_key: str = inp["object_key"]
    activity.logger.info("Transcribing audio/video: %s", object_key)

    media_path = download_to_tempfile(object_key)
    wav_path = Path(tempfile.mktemp(suffix=".wav"))

    try:
        _extract_audio(media_path, wav_path)

        model = _get_model()
        segments, info = model.transcribe(str(wav_path), beam_size=5)

        transcript_parts: list[str] = []
        for segment in segments:
            # Report heartbeat so Temporal knows we're alive during long transcriptions
            activity.heartbeat(f"segment {segment.start:.1f}s-{segment.end:.1f}s")
            transcript_parts.append(segment.text.strip())

        transcript = " ".join(transcript_parts)
        activity.logger.info(
            "Transcription complete: %d chars, language=%s",
            len(transcript), info.language
        )
        return {"transcript": transcript, "language": info.language}

    finally:
        media_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)
```

- [ ] **Commit:** `feat(worker): add audio/video STT activity via faster-whisper and ffmpeg`

---

### Task 5: Image Analysis Activity (Gemini Vision)

**Files:**

- Create: `apps/worker/src/worker/lib/gemini_client.py`
- Create: `apps/worker/src/worker/activities/image_activity.py`

- [ ] **Step 1: Create apps/worker/src/worker/lib/gemini_client.py**

```python
# apps/worker/src/worker/lib/gemini_client.py
import os
import google.generativeai as genai

_configured = False


def get_gemini_model(model_name: str = "gemini-3.1-flash-lite-preview") -> genai.GenerativeModel:
    global _configured
    if not _configured:
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        _configured = True
    return genai.GenerativeModel(model_name)
```

- [ ] **Step 2: Create apps/worker/src/worker/activities/image_activity.py**

```python
# apps/worker/src/worker/activities/image_activity.py
from pathlib import Path
import google.generativeai as genai
from temporalio import activity

from worker.lib.s3_client import download_to_tempfile
from worker.lib.gemini_client import get_gemini_model

IMAGE_PROMPT = (
    "Describe this image in detail. If it contains a diagram, chart, table, or "
    "mathematical notation, extract and explain the content precisely. "
    "Return plain text suitable for inclusion in a study note."
)


@activity.defn(name="analyze_image")
async def analyze_image(inp: dict) -> dict:
    object_key: str = inp["object_key"]
    mime_type: str = inp["mime_type"]
    activity.logger.info("Analyzing image: %s", object_key)

    image_path = download_to_tempfile(object_key)

    try:
        model = get_gemini_model("gemini-3.1-flash-lite-preview")

        with open(image_path, "rb") as f:
            image_data = f.read()

        response = model.generate_content(
            [
                {"mime_type": mime_type, "data": image_data},
                IMAGE_PROMPT,
            ]
        )

        description = response.text.strip()
        activity.logger.info("Image analysis complete: %d chars", len(description))
        return {"description": description}

    finally:
        image_path.unlink(missing_ok=True)
```

- [ ] **Commit:** `feat(worker): add image analysis activity via Gemini Vision`

---

### Task 6: YouTube Ingest Activity (yt-dlp + STT)

**Files:**

- Create: `apps/worker/src/worker/activities/youtube_activity.py`

- [ ] **Step 1: Create apps/worker/src/worker/activities/youtube_activity.py**

```python
# apps/worker/src/worker/activities/youtube_activity.py
import os
import tempfile
from pathlib import Path

import yt_dlp
from faster_whisper import WhisperModel
from temporalio import activity

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
    return _model


@activity.defn(name="ingest_youtube")
async def ingest_youtube(inp: dict) -> dict:
    url: str = inp["url"]
    activity.logger.info("Ingesting YouTube URL: %s", url)

    tmp_dir = Path(tempfile.mkdtemp())
    audio_path = tmp_dir / "audio.%(ext)s"

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(audio_path),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "0",
            }
        ],
        "postprocessor_args": ["-ar", "16000", "-ac", "1"],
        "quiet": True,
        "no_warnings": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title: str = info.get("title", "YouTube Video")
        description: str = info.get("description", "")

    wav_file = tmp_dir / "audio.wav"
    if not wav_file.exists():
        # yt-dlp may use a different name; find any .wav
        wav_files = list(tmp_dir.glob("*.wav"))
        if not wav_files:
            raise FileNotFoundError("yt-dlp did not produce a WAV file")
        wav_file = wav_files[0]

    try:
        model = _get_model()
        segments, lang_info = model.transcribe(str(wav_file), beam_size=5)

        parts: list[str] = []
        for seg in segments:
            activity.heartbeat(f"segment {seg.start:.1f}s")
            parts.append(seg.text.strip())

        transcript = " ".join(parts)
        # Prepend video title and description for context
        full_text = f"# {title}\n\n{description}\n\n## Transcript\n\n{transcript}"

        activity.logger.info(
            "YouTube ingest complete: %s, %d chars", title, len(full_text)
        )
        return {"transcript": full_text, "title": title, "language": lang_info.language}

    finally:
        for f in tmp_dir.iterdir():
            f.unlink(missing_ok=True)
        tmp_dir.rmdir()
```

- [ ] **Commit:** `feat(worker): add YouTube ingest activity via yt-dlp and faster-whisper`

---

### Task 7: Web URL Parsing Activity (trafilatura)

**Files:**

- Create: `apps/worker/src/worker/activities/web_activity.py`

- [ ] **Step 1: Create apps/worker/src/worker/activities/web_activity.py**

```python
# apps/worker/src/worker/activities/web_activity.py
import re

import httpx
import trafilatura
from temporalio import activity

# Heuristics: pages with many figure/table markers may benefit from Gemini
COMPLEX_MARKER_PATTERN = re.compile(
    r"(figure\s+\d+|table\s+\d+|equation\s+\d+|\$\$|\\\[)",
    re.IGNORECASE,
)
COMPLEX_THRESHOLD = 3


@activity.defn(name="scrape_web_url")
async def scrape_web_url(inp: dict) -> dict:
    url: str = inp["url"]
    activity.logger.info("Scraping web URL: %s", url)

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=30.0,
        headers={"User-Agent": "OpenCairn/1.0 (knowledge base ingest bot)"},
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        html = response.text

    text = trafilatura.extract(
        html,
        include_tables=True,
        include_links=False,
        include_images=False,
        output_format="txt",
    )

    if not text:
        # Fallback: strip tags manually if trafilatura returns nothing
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()

    matches = COMPLEX_MARKER_PATTERN.findall(text or "")
    has_complex_layout = len(matches) >= COMPLEX_THRESHOLD

    activity.logger.info(
        "Web scrape complete: %d chars, complex=%s", len(text or ""), has_complex_layout
    )
    return {"text": text or "", "has_complex_layout": has_complex_layout}
```

- [ ] **Commit:** `feat(worker): add web URL scraping activity via trafilatura`

---

### Task 8: Gemini Multimodal Enhancement (Complex Pages with Diagrams)

**Files:**

- Create: `apps/worker/src/worker/activities/gemini_enhance.py`

- [ ] **Step 1: Create apps/worker/src/worker/activities/gemini_enhance.py**

```python
# apps/worker/src/worker/activities/gemini_enhance.py
from temporalio import activity

from worker.lib.gemini_client import get_gemini_model
from worker.lib.s3_client import download_to_tempfile

ENHANCE_PROMPT_TEMPLATE = """You are a knowledge extraction assistant.

Below is raw text extracted from a document that contains complex layouts
(tables, diagrams, equations, or figures that may have been poorly extracted).

Original extracted text:
---
{raw_text}
---

Your task:
1. Correct any garbled or incomplete text caused by layout extraction errors.
2. Reconstruct tables as Markdown tables.
3. Describe diagrams and figures in detail in plain text.
4. Render mathematical equations in LaTeX (inline: $...$, block: $$...$$).
5. Return clean, well-structured Markdown suitable for a study note.

Do not add commentary. Return only the improved content.
"""


@activity.defn(name="enhance_with_gemini")
async def enhance_with_gemini(inp: dict) -> dict:
    raw_text: str = inp.get("raw_text", "")
    object_key: str | None = inp.get("object_key")
    mime_type: str = inp.get("mime_type", "")

    activity.logger.info(
        "Enhancing with Gemini: object_key=%s, text_len=%d", object_key, len(raw_text)
    )

    model = get_gemini_model("gemini-3.1-flash-lite-preview")
    prompt = ENHANCE_PROMPT_TEMPLATE.format(raw_text=raw_text[:50_000])  # stay within context

    parts: list = [prompt]

    # If we have the original file (PDF or image), send it alongside the text
    # for richer multimodal understanding
    if object_key and mime_type in ("application/pdf", "image/png", "image/jpeg"):
        file_path = download_to_tempfile(object_key)
        try:
            with open(file_path, "rb") as f:
                file_bytes = f.read()
            parts = [{"mime_type": mime_type, "data": file_bytes}, prompt]
        finally:
            file_path.unlink(missing_ok=True)

    response = model.generate_content(parts)
    enhanced = response.text.strip()

    activity.logger.info("Gemini enhancement complete: %d chars", len(enhanced))
    return {"text": enhanced}
```

- [ ] **Commit:** `feat(worker): add Gemini multimodal enhancement activity for complex documents`

---

### Task 9: Source Note Creation + Compiler Agent Trigger

**Files:**

- Create: `apps/worker/src/worker/activities/note_activity.py`
- Create: `apps/worker/src/worker/lib/api_client.py`
- Modify: `apps/api/src/routes/notes.ts` (add internal source note endpoint)
- Modify: `apps/api/src/routes/ingest.ts` (add workflow status endpoint)

- [ ] **Step 1: Create apps/worker/src/worker/lib/api_client.py**

```python
# apps/worker/src/worker/lib/api_client.py
import os
import httpx

API_BASE = os.environ.get("INTERNAL_API_URL", "http://api:4000")
INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET", "change-me-in-production")


async def post_internal(path: str, body: dict) -> dict:
    """Make an authenticated internal API call from the worker."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30.0) as client:
        response = await client.post(
            path,
            json=body,
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )
        response.raise_for_status()
        return response.json()
```

- [ ] **Step 2: Create apps/worker/src/worker/activities/note_activity.py**

```python
# apps/worker/src/worker/activities/note_activity.py
from temporalio import activity

from worker.lib.api_client import post_internal


@activity.defn(name="create_source_note")
async def create_source_note(inp: dict) -> str:
    """
    Call back into the API to create a source note with the extracted text,
    then optionally trigger the Compiler Agent.
    Returns the new note ID.
    """
    activity.logger.info(
        "Creating source note for user=%s project=%s",
        inp["user_id"],
        inp["project_id"],
    )

    payload = {
        "userId": inp["user_id"],
        "projectId": inp["project_id"],
        "parentNoteId": inp.get("parent_note_id"),
        "title": _derive_title(inp),
        "content": inp.get("text", ""),
        "sourceType": _derive_source_type(inp["mime_type"]),
        "objectKey": inp.get("object_key"),
        "sourceUrl": inp.get("url"),
        "mimeType": inp["mime_type"],
        "triggerCompiler": True,  # ask API to enqueue compiler agent
    }

    result = await post_internal("/internal/source-notes", payload)
    note_id: str = result["noteId"]

    activity.logger.info("Source note created: %s", note_id)
    return note_id


def _derive_title(inp: dict) -> str:
    if inp.get("file_name"):
        return inp["file_name"]
    if inp.get("url"):
        return inp["url"]
    return "Untitled Source"


def _derive_source_type(mime_type: str) -> str:
    mapping = {
        "application/pdf": "pdf",
        "x-opencairn/youtube": "youtube",
        "x-opencairn/web-url": "web",
    }
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("image/"):
        return "image"
    return mapping.get(mime_type, "unknown")
```

- [ ] **Step 3: Add internal source-note endpoint to Hono API**

Add to `apps/api/src/routes/notes.ts` (or a new `apps/api/src/routes/internal.ts`):

```ts
// apps/api/src/routes/internal.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { notes as notesTable } from "@opencairn/db";

export const internal = new Hono();

// Internal middleware — validate X-Internal-Secret header
internal.use("*", async (c, next) => {
  const secret = c.req.header("X-Internal-Secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

const sourceNoteSchema = z.object({
  userId: z.string(),
  projectId: z.string().uuid(),
  parentNoteId: z.string().uuid().nullable().optional(),
  title: z.string().max(512),
  content: z.string(),
  sourceType: z.enum([
    "pdf",
    "audio",
    "video",
    "image",
    "youtube",
    "web",
    "unknown",
  ]),
  objectKey: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  mimeType: z.string(),
  triggerCompiler: z.boolean().default(false),
});

internal.post(
  "/source-notes",
  zValidator("json", sourceNoteSchema),
  async (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");

    const noteId = randomUUID();

    await db.insert(notesTable).values({
      id: noteId,
      userId: body.userId,
      projectId: body.projectId,
      parentId: body.parentNoteId ?? null,
      title: body.title,
      content: JSON.stringify([
        { type: "p", children: [{ text: body.content }] },
      ]),
      type: "source",
      sourceType: body.sourceType,
      objectKey: body.objectKey ?? null,
      sourceUrl: body.sourceUrl ?? null,
      mimeType: body.mimeType,
    });

    // TODO Plan 5: enqueue Compiler Agent workflow when triggerCompiler is true
    if (body.triggerCompiler) {
      // Placeholder — will be wired in Plan 5 (AI Agents)
      console.log("[internal] compiler trigger queued for note", noteId);
    }

    return c.json({ noteId }, 201);
  },
);
```

- [ ] **Step 4: Mount internal routes in apps/api/src/app.ts**

```ts
import { internal } from "./routes/internal";
app.route("/internal", internal);
```

- [ ] **Step 5: Add workflow status endpoint to ingest routes**

```ts
// Append to apps/api/src/routes/ingest.ts

// GET /ingest/status/:workflowId
ingest.get("/status/:workflowId", authMiddleware, async (c) => {
  const { workflowId } = c.req.param();
  const client = await getTemporalClient();

  const handle = client.workflow.getHandle(workflowId);
  const desc = await handle.describe();

  return c.json({
    workflowId,
    status: desc.status.name,
    startTime: desc.startTime,
    closeTime: desc.closeTime ?? null,
  });
});
```

- [ ] **Commit:** `feat(worker,api): add source note creation activity and internal API endpoint`

---

### Task 10: Quarantine (dead-letter) handling

**Files:**
- Create: `apps/worker/src/worker/activities/quarantine_activity.py`
- Modify: `apps/worker/src/worker/workflows/ingest_workflow.py`

- [ ] **Step 1: Quarantine helper**

```python
# apps/worker/src/worker/activities/quarantine_activity.py
import os
from datetime import datetime, timezone
from temporalio import activity
from worker.lib.r2_client import get_r2_client

QUARANTINE_PREFIX = os.environ.get("INGEST_QUARANTINE_PREFIX", "quarantine/")
BUCKET = os.environ.get("S3_BUCKET", "opencairn-uploads")


@activity.defn(name="quarantine_source")
async def quarantine_source(inp: dict) -> dict:
    """Move a failed source to the quarantine prefix and return new key."""
    client = get_r2_client()
    src_key: str = inp["object_key"]
    user_id: str = inp["user_id"]
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    base = src_key.rsplit("/", 1)[-1]
    new_key = f"{QUARANTINE_PREFIX}{user_id}/{ym}/{base}"

    # copy + delete (R2/S3 has no native move)
    client.copy_object(
        Bucket=BUCKET,
        Key=new_key,
        CopySource={"Bucket": BUCKET, "Key": src_key},
    )
    client.delete_object(Bucket=BUCKET, Key=src_key)
    activity.logger.warning("Quarantined %s → %s (reason: %s)", src_key, new_key, inp.get("reason"))
    return {"quarantine_key": new_key}
```

- [ ] **Step 2: IngestWorkflow에 실패 catch + quarantine 호출**

```python
# apps/worker/src/worker/workflows/ingest_workflow.py (수정)
from temporalio.exceptions import ActivityError

@workflow.defn(name="IngestWorkflow")
class IngestWorkflow:
    @workflow.run
    async def run(self, inp: IngestInput) -> str:
        try:
            # ... 기존 파싱/transcribe/note_create 로직 ...
            return note_id
        except ActivityError as exc:
            if inp.object_key:
                await workflow.execute_activity(
                    quarantine_source,
                    {
                        "object_key": inp.object_key,
                        "user_id": inp.user_id,
                        "reason": str(exc.cause or exc),
                    },
                    schedule_to_close_timeout=_SHORT_TIMEOUT,
                    retry_policy=RetryPolicy(maximum_attempts=2),
                )
            raise
```

- [ ] **Step 3: `jobs.error` 에 quarantine_key 기록**

API `/internal/source-notes/failure` 엔드포인트에 PATCH로 jobs 테이블 update. 또는 Temporal failure signal로 Hono에 알림.

- [ ] **Step 4: Admin 뷰 (선택적 v0.2)** — `/admin/quarantine` 라우트로 일별 quarantine 파일 리스트 + 수동 재시도.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(worker): quarantine activity for failed ingests with R2 dead-letter prefix"
```

---

### Verification

- [ ] `docker compose up minio temporal temporal-ui` starts all three services without errors
- [ ] Temporal UI at `http://localhost:8080` is accessible
- [ ] MinIO/R2 console at `http://localhost:9001` is accessible; `opencairn-uploads` bucket exists
- [ ] `POST /ingest/upload` with a PDF file returns `202` with a `workflowId`
- [ ] `POST /ingest/upload` with a file > 200MB returns `413` (Payload Too Large)
- [ ] `POST /ingest/upload` with an image > 20MB returns `413`
- [ ] The Temporal UI shows `IngestWorkflow` running → completing for the uploaded PDF
- [ ] `GET /ingest/status/:workflowId` returns `{ status: "COMPLETED" }`
- [ ] A source note appears in the database with `type = 'source'` and non-empty `content`
- [ ] `POST /ingest/url` with a YouTube URL triggers the `IngestWorkflow` and produces a transcript note
- [ ] `POST /ingest/url` with a web URL triggers scraping and produces a note
- [ ] Uploading an image triggers `analyze_image` and produces a description note
- [ ] Uploading a PDF with tables triggers `enhance_with_gemini` for complex layout
- [ ] **Corrupt PDF triggers 3 retries → quarantine 이동 → R2 `quarantine/<user>/<yyyy-mm>/` 경로 확인**
- [ ] Worker restarts cleanly (`docker compose restart worker`) without losing in-progress workflows (Temporal re-delivers)
- [ ] `X-Internal-Secret` mismatch on `/internal/*` returns `401`
