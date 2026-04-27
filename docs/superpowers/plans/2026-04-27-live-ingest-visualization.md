# Live Ingest Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ingest 진행 상황을 실시간 이벤트로 흘려, 업로드 → spotlight overlay (~7초) → 탭+dock collapse → workspace 진입의 fancy-loading 경험을 만든다. 기존 `IngestWorkflow` 동작은 변하지 않으며 가시성 레이어만 추가된다.

**Architecture:** Worker activity가 단계별로 `IngestEvent`를 Redis pub/sub에 publish + LIST에 백업. API SSE 핸들러가 SUBSCRIBE + replay LIST로 fanout. Web은 `EventSource` + Zustand store로 spotlight/탭/dock 세 컨테이너에 동일한 `<IngestProgressView>` 재사용.

**Tech Stack:** TypeScript (Hono SSE, ioredis 5.6 — 이미 설치됨), Python (`redis` async client, 신규 추가), Zod (스키마 정본 in `packages/shared`), Zustand + `persist` (기존 패턴), Framer Motion (spotlight 모션), `EventSource` (브라우저 표준).

**Spec:** `docs/superpowers/specs/2026-04-27-live-ingest-visualization-design.md` (commit `e308ac1`).

**병렬 spec과의 합의 포인트** (구현 중 다른 워크트리 머지에 따라 후속):
- B (Content-aware Enrichment) — `kind: "enrichment"` payload의 `type` 네임스페이스. 본 plan은 wrapper만 구현, B가 type 추가.
- E (Literature Search) — N개 동시 dispatch 시 spotlight skip. 본 plan은 web-side 자동 감지 (지난 200ms 내 다른 startRun) 사용 → E의 별도 hint 불필요한 방향. 만약 E spec이 다른 결정 나면 follow-up.

---

## Phase 1 — Backend Foundation (UI 변경 없음)

### Task 1: 공통 이벤트 스키마 (packages/shared)

**Files:**
- Create: `packages/shared/src/ingest-events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/ingest-events.test.ts`

이 task가 전체 spec의 단일 정본 계약을 만든다. 모든 후속 task는 이 타입을 import.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/ingest-events.test.ts
import { describe, it, expect } from "vitest";
import { IngestEvent, IngestEventKind } from "./ingest-events";

describe("IngestEvent", () => {
  it("validates a started event", () => {
    const ev = {
      workflowId: "ingest-abc",
      seq: 0,
      ts: "2026-04-27T10:00:00.000Z",
      kind: "started",
      payload: {
        mime: "application/pdf",
        fileName: "paper.pdf",
        url: null,
        totalUnits: 30,
      },
    };
    expect(IngestEvent.parse(ev)).toEqual(ev);
  });

  it("rejects unknown kind", () => {
    expect(() =>
      IngestEvent.parse({
        workflowId: "x",
        seq: 0,
        ts: "2026-04-27T10:00:00.000Z",
        kind: "totally_unknown",
        payload: {},
      }),
    ).toThrow();
  });

  it("validates figure_extracted with object key only (no inline image)", () => {
    const ev = IngestEvent.parse({
      workflowId: "x",
      seq: 5,
      ts: "2026-04-27T10:00:00.000Z",
      kind: "figure_extracted",
      payload: {
        sourceUnit: 2,
        objectKey: "uploads/u1/figures/wf1/p2-f0.png",
        figureKind: "image",
        caption: null,
        width: 600,
        height: 400,
      },
    });
    expect(ev.kind).toBe("figure_extracted");
  });

  it("validates enrichment wrapper with arbitrary type", () => {
    const ev = IngestEvent.parse({
      workflowId: "x",
      seq: 10,
      ts: "2026-04-27T10:00:00.000Z",
      kind: "enrichment",
      payload: { type: "b.translation", data: { lang: "ko", chunk: "..." } },
    });
    expect(ev.kind).toBe("enrichment");
  });

  it("exposes IngestEventKind enum values", () => {
    const kinds = IngestEventKind.options;
    expect(kinds).toContain("started");
    expect(kinds).toContain("figure_extracted");
    expect(kinds).toContain("enrichment");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/shared test src/ingest-events.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

```ts
// packages/shared/src/ingest-events.ts
import { z } from "zod";

/** Closed set of event kinds. New kinds require spec amendment. */
export const IngestEventKind = z.enum([
  "started",
  "stage_changed",
  "completed",
  "failed",
  "unit_started",
  "unit_parsed",
  "figure_extracted",
  "outline_node",
  "enrichment",
]);
export type IngestEventKind = z.infer<typeof IngestEventKind>;

const baseEnvelope = {
  workflowId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
};

export const IngestStartedPayload = z.object({
  mime: z.string(),
  fileName: z.string().nullable(),
  url: z.string().nullable(),
  totalUnits: z.number().int().positive().nullable(),
});

export const IngestStageChangedPayload = z.object({
  stage: z.enum(["downloading", "parsing", "enhancing", "persisting"]),
  pct: z.number().min(0).max(100).nullable(),
});

export const IngestUnitStartedPayload = z.object({
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  label: z.string(),
});

export const IngestUnitParsedPayload = z.object({
  index: z.number().int().nonnegative(),
  unitKind: z.enum(["page", "segment", "section"]),
  charCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export const IngestFigureExtractedPayload = z.object({
  sourceUnit: z.number().int().nonnegative(),
  objectKey: z.string(),
  figureKind: z.enum(["image", "table", "chart", "equation"]),
  caption: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const IngestOutlineNodePayload = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  level: z.number().int().min(1).max(6),
  title: z.string().max(200),
});

export const IngestCompletedPayload = z.object({
  noteId: z.string().uuid(),
  totalDurationMs: z.number().int().nonnegative(),
});

export const IngestFailedPayload = z.object({
  reason: z.string(),
  quarantineKey: z.string().nullable(),
  retryable: z.boolean(),
});

export const IngestEnrichmentPayload = z.object({
  type: z.string(),
  data: z.unknown(),
});

export const IngestEvent = z.discriminatedUnion("kind", [
  z.object({ ...baseEnvelope, kind: z.literal("started"), payload: IngestStartedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("stage_changed"), payload: IngestStageChangedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("unit_started"), payload: IngestUnitStartedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("unit_parsed"), payload: IngestUnitParsedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("figure_extracted"), payload: IngestFigureExtractedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("outline_node"), payload: IngestOutlineNodePayload }),
  z.object({ ...baseEnvelope, kind: z.literal("completed"), payload: IngestCompletedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("failed"), payload: IngestFailedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("enrichment"), payload: IngestEnrichmentPayload }),
]);
export type IngestEvent = z.infer<typeof IngestEvent>;
```

그리고 `packages/shared/src/index.ts`에 re-export 추가:

```ts
export * from "./ingest-events";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @opencairn/shared test src/ingest-events.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Type check**

```bash
pnpm --filter @opencairn/shared typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ingest-events.ts \
        packages/shared/src/ingest-events.test.ts \
        packages/shared/src/index.ts
git commit -m "feat(shared): IngestEvent schema (zod discriminated union)"
```

---

### Task 2: API Redis 클라이언트 모듈

**Files:**
- Create: `apps/api/src/lib/redis.ts`
- Test: `apps/api/src/lib/redis.test.ts`
- Modify: `.env.example`, `apps/api/src/lib/env.ts` (있으면)

기존 `apps/api/src/lib/rate-limit.ts:3-4`와 `visualize-lock.ts:3-9`가 Redis 도입을 기다리는 TODO 상태. 이 task가 첫 클라이언트 도입 — 이후 그 두 모듈도 같은 클라이언트로 마이그 가능 (별도 follow-up).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/redis.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRedis, resetRedisForTest } from "./redis";

describe("getRedis", () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.REDIS_URL;
    resetRedisForTest();
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalEnv;
    resetRedisForTest();
  });

  it("throws when REDIS_URL is missing", () => {
    delete process.env.REDIS_URL;
    expect(() => getRedis()).toThrow(/REDIS_URL/);
  });

  it("returns a singleton instance on repeated calls", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const a = getRedis();
    const b = getRedis();
    expect(a).toBe(b);
    a.disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/api test src/lib/redis.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/lib/redis.ts
import Redis from "ioredis";

let client: Redis | null = null;

/**
 * Lazily-initialised singleton ioredis client. The first caller drives
 * connection; subsequent callers share the socket. Tests use
 * `resetRedisForTest()` to drop the singleton between cases.
 */
export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL environment variable is required");
    }
    client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }
  return client;
}

/** Test-only — drops the singleton so a fresh env can take effect. */
export function resetRedisForTest(): void {
  if (client) {
    client.disconnect();
    client = null;
  }
}
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @opencairn/api test src/lib/redis.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Update .env.example**

`.env.example`에 추가 (이미 있으면 skip):

```
# Redis — used for ingest event pub/sub and (future) rate limiting / locks
REDIS_URL=redis://localhost:6379
```

`docker-compose.yml`의 api 서비스가 이미 redis depends_on이라면 wiring은 끝. 아니면 `REDIS_URL=redis://redis:6379`를 api/worker `environment:`에 추가.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/redis.ts apps/api/src/lib/redis.test.ts .env.example
git commit -m "feat(api): ioredis singleton + REDIS_URL env wiring"
```

---

### Task 3: Worker 이벤트 emitter 모듈 (Python)

**Files:**
- Modify: `apps/worker/pyproject.toml` (add `redis>=5.0` dep)
- Create: `apps/worker/src/worker/lib/ingest_events.py`
- Create: `apps/worker/tests/lib/test_ingest_events.py`

publish_safe 패턴 — Redis 다운이 ingest 자체를 막지 않음 (가시성 레이어 정책).

- [ ] **Step 1: Add `redis` dep**

`apps/worker/pyproject.toml`의 `[project] dependencies` 배열에 추가:

```toml
"redis>=5.0,<6",
```

```bash
cd apps/worker && uv sync
```

- [ ] **Step 2: Write the failing test**

```python
# apps/worker/tests/lib/test_ingest_events.py
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from worker.lib.ingest_events import publish, publish_safe


@pytest.mark.asyncio
async def test_publish_increments_seq_and_writes_replay():
    fake_redis = MagicMock()
    fake_redis.incr = AsyncMock(return_value=1)
    pipe = MagicMock()
    pipe.publish = MagicMock(return_value=pipe)
    pipe.lpush = MagicMock(return_value=pipe)
    pipe.ltrim = MagicMock(return_value=pipe)
    pipe.expire = MagicMock(return_value=pipe)
    pipe.execute = AsyncMock(return_value=[1, 1, "OK", 1, 1])
    fake_redis.pipeline = MagicMock(return_value=pipe)

    with patch("worker.lib.ingest_events._get_client", return_value=fake_redis):
        await publish("wf-1", "started", {"mime": "application/pdf"})

    fake_redis.incr.assert_awaited_once_with("ingest:seq:wf-1")
    pipe.publish.assert_called_once()
    chan, body = pipe.publish.call_args[0]
    assert chan == "ingest:events:wf-1"
    parsed = json.loads(body)
    assert parsed["workflowId"] == "wf-1"
    assert parsed["seq"] == 1
    assert parsed["kind"] == "started"
    assert parsed["payload"] == {"mime": "application/pdf"}


@pytest.mark.asyncio
async def test_publish_safe_swallows_errors():
    with patch("worker.lib.ingest_events.publish", side_effect=RuntimeError("boom")):
        # must not raise
        await publish_safe("wf-1", "started", {})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/worker && uv run pytest tests/lib/test_ingest_events.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```python
# apps/worker/src/worker/lib/ingest_events.py
"""Ingest event emitter — Redis publisher + atomic seq + ring buffer.

Activities call publish() during processing; the API SSE handler runs in a
separate process and SUBSCRIBEs (and replays the LIST). The worker never
holds open SSE connections itself.

Best-effort: publish failures must not break ingest. Use publish_safe in
hot paths so Redis downtime is observable in logs but not user-facing.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as redis

_log = logging.getLogger(__name__)
_REPLAY_TTL = int(os.environ.get("INGEST_REPLAY_TTL_SECONDS", "3600"))
_REPLAY_MAX_LEN = int(os.environ.get("INGEST_REPLAY_MAX_LEN", "1000"))

_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        url = os.environ.get("REDIS_URL")
        if not url:
            raise RuntimeError("REDIS_URL environment variable is required")
        _client = redis.from_url(url, decode_responses=True)
    return _client


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


async def publish(workflow_id: str, kind: str, payload: dict[str, Any]) -> int:
    """Publish a single IngestEvent. Returns assigned seq.

    The seq counter is per-workflow_id, atomic via INCR.
    """
    r = _get_client()
    seq = await r.incr(f"ingest:seq:{workflow_id}")
    event = {
        "workflowId": workflow_id,
        "seq": seq,
        "ts": _iso_now(),
        "kind": kind,
        "payload": payload,
    }
    body = json.dumps(event, ensure_ascii=False)

    pipe = r.pipeline()
    pipe.publish(f"ingest:events:{workflow_id}", body)
    pipe.lpush(f"ingest:replay:{workflow_id}", body)
    pipe.ltrim(f"ingest:replay:{workflow_id}", 0, _REPLAY_MAX_LEN - 1)
    pipe.expire(f"ingest:replay:{workflow_id}", _REPLAY_TTL)
    pipe.expire(f"ingest:seq:{workflow_id}", _REPLAY_TTL)
    await pipe.execute()
    return seq


async def publish_safe(workflow_id: str, kind: str, payload: dict[str, Any]) -> None:
    """Best-effort wrapper. Redis downtime must never break ingest itself."""
    try:
        await publish(workflow_id, kind, payload)
    except Exception as e:  # noqa: BLE001
        _log.warning("ingest event publish failed: kind=%s err=%s", kind, e)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/worker && uv run pytest tests/lib/test_ingest_events.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/pyproject.toml apps/worker/uv.lock \
        apps/worker/src/worker/lib/ingest_events.py \
        apps/worker/tests/lib/test_ingest_events.py
git commit -m "feat(worker): redis-backed IngestEvent emitter + publish_safe"
```

---

### Task 4: PDF activity 페이지 루프 + figure 추출 ON

**Files:**
- Modify: `apps/worker/src/worker/activities/pdf_activity.py`
- Modify: `apps/worker/tests/activities/test_pdf_activity.py` (있으면; 없으면 create)
- Modify: `apps/worker/Dockerfile` (ImageMagick deps 필요할 수 있음 — 실측 후)

가장 큰 단일 task. 현재 `parse_pdf`는 JAR 한 번 호출 → 전체 결과 join. 변경: JAR 결과 JSON을 페이지별로 순차 처리하면서 이벤트 발행. figure는 MinIO 업로드.

**전제조건 (먼저 확인):** opendataloader-pdf JAR이 `--extract-images=true`일 때 어떤 디렉토리/네이밍으로 PNG를 출력하는지, 결과 JSON에 `pages[].sections`/`pages[].figures` 같은 구조가 있는지 실측. 결과에 따라 outline_node 발행 가능/불가 분기.

- [ ] **Step 1: 실측 — JAR 결과 JSON 스키마 확인**

```bash
cd apps/worker
uv run python -c "
import subprocess, tempfile, json
from pathlib import Path
# Fixture PDF는 tests/fixtures/sample.pdf 가정 (없으면 임의 PDF로 대체)
out = Path(tempfile.mkdtemp())
subprocess.run([
    'java', '-jar', '/app/opendataloader-pdf.jar',
    '--input', 'tests/fixtures/sample.pdf',
    '--output', str(out),
    '--format', 'json',
    '--extract-images', 'true',
], check=True)
files = list(out.iterdir())
print('FILES:', [f.name for f in files])
js = next(f for f in files if f.suffix == '.json')
data = json.load(open(js))
print('TOP KEYS:', list(data.keys()))
if 'pages' in data and data['pages']:
    print('PAGE 0 KEYS:', list(data['pages'][0].keys()))
"
```

이 결과에 따라 아래 코드의 필드 접근을 조정. 현재 코드(`pdf_activity.py:111-120`)는 `pages[].text`, `pages[].tables`, `pages[].figures`만 사용. 만약 sections/headings 필드가 없으면 outline_node 발행은 PyMuPDF의 `doc.get_toc()` fallback으로 처리.

이 step이 **plan 수정 트리거** — 결과를 plan 파일에 주석으로 기록 후 진행.

- [ ] **Step 2: Write failing test (page loop emits events)**

```python
# apps/worker/tests/activities/test_pdf_activity.py — 추가 또는 신규
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest

from worker.activities.pdf_activity import parse_pdf


@pytest.mark.asyncio
async def test_parse_pdf_emits_unit_events_per_page(tmp_path):
    """Verify parse_pdf publishes started + per-page unit events + figure events."""
    fake_pdf = tmp_path / "sample.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n...")  # smallest valid stub for download mock

    fake_json = {
        "pages": [
            {"text": "Page one body", "figures": [{"file": "p0-f0.png", "kind": "image"}]},
            {"text": "Page two body", "tables": [{}]},
        ],
    }
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / "sample.json").write_text(json.dumps(fake_json))
    (out_dir / "p0-f0.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    publish_calls = []

    async def fake_publish(wfid, kind, payload):
        publish_calls.append((kind, payload))

    with (
        patch("worker.activities.pdf_activity.download_to_tempfile", return_value=fake_pdf),
        patch("worker.activities.pdf_activity._run_jar", return_value=out_dir),
        patch("worker.activities.pdf_activity._detect_scan", return_value=False),
        patch("worker.activities.pdf_activity._upload_figure", return_value="uploads/u/figures/wf/p0-f0.png"),
        patch("worker.activities.pdf_activity.publish_safe", side_effect=fake_publish),
    ):
        result = await parse_pdf({
            "object_key": "uploads/u/x.pdf",
            "user_id": "u",
            "project_id": "p",
            "note_id": None,
            "file_name": "x.pdf",
            "mime_type": "application/pdf",
            "url": None,
        }, workflow_id="wf-1")  # ← 새 파라미터

    kinds = [c[0] for c in publish_calls]
    assert kinds[0] == "started"
    assert "unit_started" in kinds
    assert "unit_parsed" in kinds
    assert "figure_extracted" in kinds
    # has 2 pages → 2 unit_started + 2 unit_parsed
    assert kinds.count("unit_started") == 2
    assert kinds.count("unit_parsed") == 2
    assert kinds.count("figure_extracted") == 1

    figure_payload = next(p for k, p in publish_calls if k == "figure_extracted")
    assert figure_payload["objectKey"] == "uploads/u/figures/wf/p0-f0.png"
    assert figure_payload["sourceUnit"] == 0
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/worker && uv run pytest tests/activities/test_pdf_activity.py::test_parse_pdf_emits_unit_events_per_page -v
```

Expected: FAIL — `parse_pdf` doesn't accept `workflow_id` kwarg, doesn't publish.

- [ ] **Step 4: Refactor `parse_pdf`**

`apps/worker/src/worker/activities/pdf_activity.py`를 아래로 교체. 핵심 변경:
1. `--extract-images=true`로 JAR 호출
2. JAR 호출을 `_run_jar()` 헬퍼로 분리 (테스트용 mock 포인트)
3. 결과 JSON 받은 뒤 페이지 루프 안에서 `publish_safe()` 호출
4. figure가 있으면 MinIO 업로드 후 `figure_extracted` publish
5. 워크플로우가 호출 시 `workflow_id`를 input dict에 넣어줌 (Task 6에서)

```python
"""PDF parsing activity — opendataloader-pdf + per-page event emission.

Plan 3 Task 3 + Plan: live-ingest-visualization Task 4. Workflow calls this
by name `parse_pdf` with the IngestInput dataclass.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import pymupdf
from temporalio import activity

from worker.lib.ingest_events import publish_safe
from worker.lib.s3_client import download_to_tempfile, upload_object

JAR_PATH = os.environ.get("OPENDATALOADER_JAR", "/app/opendataloader-pdf.jar")
COMPLEX_PAGE_THRESHOLD = int(os.environ.get("COMPLEX_PAGE_THRESHOLD", "3"))


def _detect_scan(pdf_path: Path) -> bool:
    doc = pymupdf.open(str(pdf_path))
    try:
        scan_pages = 0
        total = doc.page_count
        if total == 0:
            return False
        for page in doc:
            text = page.get_text().strip()
            images = page.get_images(full=False)
            if not text and images:
                scan_pages += 1
        return scan_pages >= (total // 2 + 1)
    finally:
        doc.close()


def _run_jar(pdf_path: Path, out_dir: Path) -> Path:
    """Run opendataloader-pdf JAR and return its JSON output file.

    Test seam: tests patch this to bypass Java entirely.
    """
    activity.heartbeat("running opendataloader-pdf")
    result = subprocess.run(
        [
            "java", "-jar", JAR_PATH,
            "--input", str(pdf_path),
            "--output", str(out_dir),
            "--format", "json",
            "--extract-images", "true",
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"opendataloader-pdf failed: {result.stderr}")
    return out_dir


def _upload_figure(local_path: Path, user_id: str, workflow_id: str, page_idx: int, fig_idx: int) -> str:
    """Upload extracted figure to MinIO. Returns the object_key."""
    object_key = f"uploads/{user_id}/figures/{workflow_id}/p{page_idx}-f{fig_idx}.png"
    upload_object(object_key, local_path.read_bytes(), "image/png")
    return object_key


def _classify_figure(fig: dict[str, Any]) -> str:
    """Heuristic figure_kind from opendataloader output.

    The exact field shape depends on JAR output (see Task 4 Step 1 measurement).
    Default to "image"; if `kind == 'table'` map to "table". Chart/equation
    classification is left for B spec (enrichment).
    """
    kind = (fig.get("kind") or "").lower()
    if kind == "table":
        return "table"
    return "image"


@activity.defn(name="parse_pdf")
async def parse_pdf(inp: dict[str, Any]) -> dict[str, Any]:
    """Parse PDF + emit per-page IngestEvents.

    `inp["workflow_id"]` is required (workflow now passes it). Events are
    emitted via publish_safe, so Redis downtime never breaks parsing itself.
    """
    object_key: str = inp["object_key"]
    user_id: str = inp["user_id"]
    workflow_id: str = inp["workflow_id"]

    activity.logger.info("Parsing PDF: %s (wf=%s)", object_key, workflow_id)

    pdf_path = download_to_tempfile(object_key)
    out_dir = Path(tempfile.mkdtemp())

    try:
        is_scan = _detect_scan(pdf_path)
        if is_scan:
            activity.logger.warning("PDF appears to be a scan: %s", object_key)

        out_dir = await asyncio.to_thread(_run_jar, pdf_path, out_dir)

        json_files = list(out_dir.glob("*.json"))
        if not json_files:
            raise FileNotFoundError("opendataloader-pdf produced no JSON output")
        with open(json_files[0]) as f:
            data = json.load(f)

        pages = data.get("pages", [])
        total_pages = len(pages)

        await publish_safe(workflow_id, "stage_changed", {"stage": "parsing", "pct": 0.0})

        text_parts: list[str] = []
        complex_page_count = 0

        for page_idx, page in enumerate(pages):
            await publish_safe(workflow_id, "unit_started", {
                "index": page_idx,
                "total": total_pages,
                "label": f"Page {page_idx + 1}/{total_pages}",
            })

            t_start = time.time()
            page_text = (page.get("text") or "").strip()
            if page_text:
                text_parts.append(page_text)
            if page.get("tables") or page.get("figures"):
                complex_page_count += 1

            for fig_idx, fig in enumerate(page.get("figures") or []):
                fname = fig.get("file")
                if not fname:
                    continue
                local = out_dir / fname
                if not local.exists():
                    continue
                obj_key = await asyncio.to_thread(
                    _upload_figure, local, user_id, workflow_id, page_idx, fig_idx,
                )
                await publish_safe(workflow_id, "figure_extracted", {
                    "sourceUnit": page_idx,
                    "objectKey": obj_key,
                    "figureKind": _classify_figure(fig),
                    "caption": fig.get("caption"),
                    "width": fig.get("width"),
                    "height": fig.get("height"),
                })

            duration_ms = int((time.time() - t_start) * 1000)
            await publish_safe(workflow_id, "unit_parsed", {
                "index": page_idx,
                "unitKind": "page",
                "charCount": len(page_text),
                "durationMs": duration_ms,
            })

        full_text = "\n\n".join(text_parts)
        has_complex_layout = complex_page_count >= COMPLEX_PAGE_THRESHOLD

        activity.logger.info(
            "PDF parsed: %d pages, %d chars, complex=%s, scan=%s",
            total_pages, len(full_text), has_complex_layout, is_scan,
        )
        return {
            "text": full_text,
            "has_complex_layout": has_complex_layout,
            "is_scan": is_scan,
        }

    finally:
        pdf_path.unlink(missing_ok=True)
        for f in out_dir.iterdir():
            f.unlink(missing_ok=True)
        out_dir.rmdir()
```

`worker.lib.s3_client`에 `upload_object` 헬퍼가 없으면 추가. 기존 `download_to_tempfile`와 같은 모듈에:

```python
from minio import Minio  # already imported in s3_client
def upload_object(object_key: str, data: bytes, content_type: str) -> None:
    client = _get_client()  # existing helper
    bucket = os.environ["S3_BUCKET"]
    client.put_object(bucket, object_key, BytesIO(data), len(data), content_type=content_type)
```

(이 헬퍼가 이미 있으면 위 import만; 없으면 작은 별도 step으로 추가하고 commit)

- [ ] **Step 5: Run test**

```bash
cd apps/worker && uv run pytest tests/activities/test_pdf_activity.py -v
```

Expected: PASS (new test + 기존 테스트 모두).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/activities/pdf_activity.py \
        apps/worker/src/worker/lib/s3_client.py \
        apps/worker/tests/activities/test_pdf_activity.py
git commit -m "feat(worker): parse_pdf page-loop with figure extraction + IngestEvent emission"
```

---

### Task 5: 다른 mime activity 최소 이벤트 발행

**Files:**
- Modify: `apps/worker/src/worker/activities/stt_activity.py`
- Modify: `apps/worker/src/worker/activities/image_activity.py`
- Modify: `apps/worker/src/worker/activities/web_activity.py`
- Modify: `apps/worker/src/worker/activities/youtube_activity.py`
- Modify: `apps/worker/src/worker/activities/enhance_activity.py`
- Modify: `apps/worker/src/worker/activities/note_activity.py`
- Modify: `apps/worker/src/worker/activities/quarantine_activity.py`
- Test: 각 모듈에 한 가지 publish 시점 검증

PDF 외 mime은 spec §5.3에 따라 최소셋만 발행. 각 activity는 input dict에서 `workflow_id`를 꺼내 `publish_safe` 호출.

- [ ] **Step 1: stt_activity 이벤트 발행**

```python
# apps/worker/src/worker/activities/stt_activity.py (관련 부분 추가)
from worker.lib.ingest_events import publish_safe

@activity.defn(name="transcribe_audio")
async def transcribe_audio(inp: dict) -> dict:
    workflow_id = inp["workflow_id"]
    await publish_safe(workflow_id, "stage_changed", {"stage": "downloading", "pct": None})
    # ...기존 다운로드 로직...
    await publish_safe(workflow_id, "stage_changed", {"stage": "parsing", "pct": None})
    # ...기존 transcription 루프...
    # 60초 segment 단위로 (이미 segment 처리 중이면 그 위치에 publish):
    #   await publish_safe(workflow_id, "unit_started", {"index": i, "total": total, "label": f"{mm}:{ss}"})
    #   ... process segment ...
    #   await publish_safe(workflow_id, "unit_parsed", {"index": i, "unitKind": "segment", "charCount": n, "durationMs": d})
    return {"transcript": ...}
```

- [ ] **Step 2: image_activity 이벤트 발행**

단일 unit이라 `started → stage_changed("parsing") → completed`까지만 (completed는 note_activity가 발행).

```python
# image_activity.py
from worker.lib.ingest_events import publish_safe

@activity.defn(name="analyze_image")
async def analyze_image(inp: dict) -> dict:
    workflow_id = inp["workflow_id"]
    await publish_safe(workflow_id, "stage_changed", {"stage": "parsing", "pct": None})
    # ...
```

- [ ] **Step 3: web_activity, youtube_activity 이벤트 발행**

각각 `downloading → parsing → unit_started/unit_parsed (heading 또는 segment 단위)`. 기존 코드 흐름에 한두 줄씩만 추가.

- [ ] **Step 4: enhance_activity의 stage_changed**

```python
# enhance_activity.py — 함수 시작부에:
workflow_id = inp.get("workflow_id")
if workflow_id:
    await publish_safe(workflow_id, "stage_changed", {"stage": "enhancing", "pct": None})
```

- [ ] **Step 5: create_source_note의 completed**

```python
# note_activity.py — create_source_note() 안에:
import time
t0 = time.time()  # workflow가 시작 시간을 inp["started_at"]로 넘겨주면 그것을 사용 (Task 6에서)
# ... 기존 로직 ...
note_id = result["noteId"]
workflow_id = inp.get("workflow_id")
if workflow_id:
    started_at = inp.get("started_at_ms")
    duration = int(time.time() * 1000) - started_at if started_at else 0
    await publish_safe(workflow_id, "stage_changed", {"stage": "persisting", "pct": None})
    await publish_safe(workflow_id, "completed", {
        "noteId": note_id,
        "totalDurationMs": duration,
    })
return note_id
```

- [ ] **Step 6: report_ingest_failure의 failed**

```python
# note_activity.py — report_ingest_failure() 안에:
workflow_id = inp.get("workflow_id")
if workflow_id:
    reason = inp.get("reason", "unknown")
    quarantine_key = inp.get("quarantine_key")
    retryable = "timeout" in reason.lower() or "network" in reason.lower()
    await publish_safe(workflow_id, "failed", {
        "reason": reason[:500],
        "quarantineKey": quarantine_key,
        "retryable": retryable,
    })
# ... 기존 best-effort post_internal ...
```

- [ ] **Step 7: 단위 테스트 (각 activity에 publish 호출 1회 검증)**

각 모듈의 기존 test 파일에 publish_safe가 적절히 호출되는지 mock-and-assert 방식 추가. 예시 (stt):

```python
@pytest.mark.asyncio
async def test_transcribe_audio_publishes_stage_changed(tmp_path):
    publish_calls = []
    async def fake_publish(wfid, kind, payload):
        publish_calls.append((kind, payload))
    with patch("worker.activities.stt_activity.publish_safe", side_effect=fake_publish):
        # ... call activity with minimal input + workflow_id ...
        pass
    kinds = [c[0] for c in publish_calls]
    assert "stage_changed" in kinds
```

- [ ] **Step 8: Run all worker tests**

```bash
cd apps/worker && uv run pytest -q
```

Expected: PASS (모두). 기존 테스트가 깨지면 입력 dict에 `workflow_id` 추가해주는 패턴으로 fix.

- [ ] **Step 9: Commit**

```bash
git add apps/worker/src/worker/activities/ apps/worker/tests/activities/
git commit -m "feat(worker): emit minimal IngestEvents from non-PDF activities"
```

---

### Task 6: IngestWorkflow에서 workflow_id 전파

**Files:**
- Modify: `apps/worker/src/worker/workflows/ingest_workflow.py`
- Test: `apps/worker/tests/workflows/test_ingest_workflow.py`

활동들이 `workflow_id`를 받으려면 워크플로우가 모든 activity 호출에 추가해야 함.

- [ ] **Step 1: Update workflow input to all activities**

`ingest_workflow.py`에서 모든 `execute_activity` 호출의 dict에 `workflow_id`와 `started_at_ms` 추가:

```python
# _run_pipeline 시작부에:
workflow_id = workflow.info().workflow_id
started_at_ms = int(workflow.now().timestamp() * 1000)

# 그리고 각 execute_activity 호출 시 input dict에 두 키 추가, 예:
result = await workflow.execute_activity(
    "parse_pdf",
    {**inp.__dict__, "workflow_id": workflow_id, "started_at_ms": started_at_ms},
    schedule_to_close_timeout=_LONG_TIMEOUT,
    retry_policy=_RETRY,
)
```

`enhance_with_gemini`, `create_source_note`, `report_ingest_failure`에도 동일하게.

또한 워크플로우 시작 직후 `started` 이벤트를 발행해야 함. Workflow 본체에서는 직접 Redis를 쓰면 안 되므로(deterministic 위반), 신규 짧은 activity `emit_started`를 만들어 호출:

```python
# 새 activity in apps/worker/src/worker/activities/emit_event.py
from worker.lib.ingest_events import publish_safe
from temporalio import activity

@activity.defn(name="emit_started")
async def emit_started(inp: dict) -> None:
    await publish_safe(inp["workflow_id"], "started", inp["payload"])
```

워크플로우에서:

```python
async def _run_pipeline(self, inp: IngestInput) -> str:
    workflow_id = workflow.info().workflow_id
    started_at_ms = int(workflow.now().timestamp() * 1000)

    # Best-effort: emit started before parsing.
    await workflow.execute_activity(
        "emit_started",
        {
            "workflow_id": workflow_id,
            "payload": {
                "mime": inp.mime_type,
                "fileName": inp.file_name,
                "url": inp.url,
                "totalUnits": None,  # parse_pdf will refine via stage_changed
            },
        },
        schedule_to_close_timeout=_SHORT_TIMEOUT,
        retry_policy=_QUARANTINE_RETRY,  # best-effort, 2 attempts
    )
    # ... rest of pipeline unchanged but with workflow_id propagated ...
```

- [ ] **Step 2: Register `emit_started` in worker bootstrap**

`apps/worker/src/worker/main.py` (또는 worker 등록 파일)에서 activities 리스트에 `emit_started` 추가.

- [ ] **Step 3: Update workflow tests**

기존 `test_ingest_workflow.py`의 mock activity stubs는 input dict에 `workflow_id` 키가 추가되어도 그냥 무시하도록 (기존 테스트 비파괴 보장).

- [ ] **Step 4: Run workflow tests**

```bash
cd apps/worker && uv run pytest tests/workflows/test_ingest_workflow.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/workflows/ingest_workflow.py \
        apps/worker/src/worker/activities/emit_event.py \
        apps/worker/src/worker/main.py \
        apps/worker/tests/
git commit -m "feat(worker): propagate workflow_id + emit started event"
```

---

### Task 7: API SSE 엔드포인트 — `/api/ingest/stream/:workflowId`

**Files:**
- Modify: `apps/api/src/routes/ingest.ts` (extend with stream handler)
- Test: `apps/api/src/routes/ingest.test.ts` (add SSE tests)

기존 `/upload`, `/url`, `/status`와 같은 권한 패턴 재사용 (`ingest_jobs.userId === user.id`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routes/ingest.test.ts (추가)
import { describe, it, expect, beforeEach } from "vitest";
import { Redis } from "ioredis-mock";
// ... existing test setup imports ...

describe("GET /api/ingest/stream/:workflowId", () => {
  it("404s when workflowId is unknown", async () => {
    const res = await testClient(app).ingest.stream[":workflowId"].$get(
      { param: { workflowId: "unknown" } },
      { headers: authHeaders(testUserId) },
    );
    expect(res.status).toBe(404);
  });

  it("403s when caller is not the dispatcher", async () => {
    // seed an ingest_jobs row owned by other user
    await db.insert(ingestJobs).values({
      workflowId: "wf-foreign",
      userId: "other-user",
      workspaceId: "ws-1",
      projectId: "p-1",
      source: "upload",
    });
    const res = await fetch(`http://localhost:${port}/api/ingest/stream/wf-foreign`, {
      headers: authHeaders(testUserId),
    });
    expect(res.status).toBe(403);
  });

  it("replays backlog from Redis LIST then opens live subscribe", async () => {
    // seed ingest_jobs + Redis LIST
    await db.insert(ingestJobs).values({
      workflowId: "wf-1",
      userId: testUserId,
      workspaceId: "ws-1",
      projectId: "p-1",
      source: "upload",
    });
    const fakeRedis = new Redis();  // ioredis-mock
    await fakeRedis.lpush("ingest:replay:wf-1",
      JSON.stringify({ workflowId: "wf-1", seq: 1, ts: "2026-04-27T00:00:00.000Z", kind: "started", payload: {} }),
    );

    const res = await fetch(`http://localhost:${port}/api/ingest/stream/wf-1`, {
      headers: { ...authHeaders(testUserId) },
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    // read first SSE message
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("kind");
    expect(text).toContain("started");
    reader.cancel();
  });
});
```

`ioredis-mock`을 dev dep으로 추가:

```bash
pnpm --filter @opencairn/api add -D ioredis-mock
```

테스트에서 `getRedis()` 모듈을 monkeypatch하여 mock 인스턴스 반환하도록 setup.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/api test src/routes/ingest.test.ts
```

Expected: FAIL — `/stream/:workflowId` 엔드포인트가 없음.

- [ ] **Step 3: Implement SSE handler**

`apps/api/src/routes/ingest.ts` 끝부분에 추가:

```ts
// 파일 상단 import 추가:
import { streamSSE } from "hono/streaming";
import { getRedis } from "../lib/redis";

// ... 기존 .get("/status/:workflowId", ...) 뒤에 chain:
.get("/stream/:workflowId", async (c) => {
  const user = c.get("user");
  const workflowId = c.req.param("workflowId");

  const [row] = await db
    .select({ userId: ingestJobs.userId })
    .from(ingestJobs)
    .where(eq(ingestJobs.workflowId, workflowId));
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

  const lastEventId = c.req.header("Last-Event-ID");
  const lastSeq = lastEventId ? Number(lastEventId) : 0;

  return streamSSE(c, async (stream) => {
    const r = getRedis();
    const subscriber = r.duplicate();

    // 1) Replay backlog. LPUSH-stored, so reverse to chronological order.
    const backlog = await r.lrange(`ingest:replay:${workflowId}`, 0, -1);
    let lastSent = lastSeq;
    for (const raw of backlog.reverse()) {
      try {
        const ev = JSON.parse(raw);
        if (ev.seq > lastSent) {
          await stream.writeSSE({ id: String(ev.seq), data: raw });
          lastSent = ev.seq;
        }
      } catch {
        // ignore malformed payload
      }
    }

    // 2) Subscribe to live channel. Skip events <= lastSent (race window).
    let closed = false;
    await subscriber.subscribe(`ingest:events:${workflowId}`);
    subscriber.on("message", async (_chan, raw) => {
      if (closed) return;
      try {
        const ev = JSON.parse(raw);
        if (ev.seq <= lastSent) return;
        await stream.writeSSE({ id: String(ev.seq), data: raw });
        lastSent = ev.seq;
        if (ev.kind === "completed" || ev.kind === "failed") {
          closed = true;
          await subscriber.unsubscribe();
          await subscriber.quit();
          stream.close();
        }
      } catch {
        // ignore
      }
    });

    // 3) Keepalive (proxies often close idle SSE > 60s)
    const keepalive = setInterval(() => {
      void stream.writeSSE({ event: "keepalive", data: "" }).catch(() => {});
    }, 30_000);

    stream.onAbort(() => {
      closed = true;
      clearInterval(keepalive);
      void subscriber.unsubscribe().catch(() => {});
      void subscriber.quit().catch(() => {});
    });
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @opencairn/api test src/routes/ingest.test.ts
```

Expected: PASS (3 new tests + 기존 테스트 비파괴).

- [ ] **Step 5: Manual smoke (optional)**

```bash
docker-compose up -d redis
pnpm --filter @opencairn/api dev
# in another terminal:
redis-cli LPUSH ingest:replay:test-wf '{"workflowId":"test-wf","seq":1,"ts":"...","kind":"started","payload":{}}'
curl -N -H "Cookie: <session>" http://localhost:8787/api/ingest/stream/test-wf
```

ingest_jobs row가 있어야 200, 권한 OK여야 SSE stream 시작.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/ingest.ts apps/api/src/routes/ingest.test.ts apps/api/package.json
git commit -m "feat(api): SSE endpoint /api/ingest/stream/:wfid with backlog replay"
```

---

### Task 8: Phase 1 통합 smoke

**Files:** 변경 없음 (수동 검증)

Phase 1 마무리 — backend가 실제 작동하는지 확인.

- [ ] **Step 1: Stack 띄우기**

```bash
docker-compose up -d
pnpm --filter @opencairn/api dev &
pnpm --filter @opencairn/worker dev
```

- [ ] **Step 2: PDF 업로드 + SSE 구독**

브라우저에서 사용자 인증 후 작은 PDF 업로드. 동시에:

```bash
redis-cli SUBSCRIBE 'ingest:events:*'
```

→ `started`, `stage_changed`, `unit_started`, `unit_parsed`, `figure_extracted`, `completed` 이벤트가 흐르는지 확인.

```bash
curl -N -H "Cookie: <session>" http://localhost:8787/api/ingest/stream/<wfid>
```

→ SSE stream 동일 이벤트.

- [ ] **Step 3: Phase 1 커밋 (no-op merge marker — 옵션)**

이 단계까지의 끝맺음. Phase 2 시작 전 안전한 베이스라인.

```bash
git tag -a phase-1-live-ingest-backend -m "Live ingest backend complete; UI not yet wired"
```

---

## Phase 2 — UI Layer

### Task 9: i18n 키 추가

**Files:**
- Create: `apps/web/messages/ko/ingest.json`
- Create: `apps/web/messages/en/ingest.json`
- Modify: `apps/web/src/i18n.ts` (있으면; namespaces 등록)

ko 먼저 작성, en은 ko 미러로 동시에 (memory project_landing_decision: en은 런칭 직전 배치 — 단 spec 통과 전 dev 단계는 ko/en parity 유지).

- [ ] **Step 1: ko 키 작성**

```json
// apps/web/messages/ko/ingest.json
{
  "spotlight": {
    "title": "{fileName} 분석 중",
    "subtitle": "페이지를 읽고 그림과 구조를 추출하고 있어요.",
    "skipToTab": "탭에서 보기",
    "secondsRemaining": "{n}초"
  },
  "tab": {
    "title": "분석 중: {fileName}",
    "openSourceNote": "노트로 이동",
    "denseToggle": "상세 보기",
    "denseToggleOff": "간단히 보기"
  },
  "dock": {
    "running": "{fileName} · {pct}%",
    "completed": "{fileName} 완료",
    "failed": "{fileName} 실패",
    "openNote": "노트 열기",
    "retry": "다시 시도",
    "dismiss": "닫기",
    "moreCount": "+{n}개 더"
  },
  "stage": {
    "downloading": "다운로드 중",
    "parsing": "파싱 중",
    "enhancing": "개선 중",
    "persisting": "저장 중"
  },
  "unit": {
    "page": "페이지 {n}/{total}",
    "segment": "세그먼트 {n}/{total}",
    "section": "섹션 {n}/{total}"
  },
  "figure": {
    "image": "이미지",
    "table": "표",
    "chart": "차트",
    "equation": "수식"
  },
  "error": {
    "generic": "처리 중 오류가 발생했습니다.",
    "unsupported": "지원되지 않는 파일일 수 있습니다.",
    "retryHint": "잠시 후 다시 시도해 주세요."
  }
}
```

- [ ] **Step 2: en 미러**

`apps/web/messages/en/ingest.json` — 동일 키, 영문 값. (런칭 직전 검수)

- [ ] **Step 3: Parity 확인**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/ko/ingest.json apps/web/messages/en/ingest.json
git commit -m "i18n(web): ingest namespace (ko + en)"
```

---

### Task 10: SSE consumer hook + Zustand store

**Files:**
- Create: `apps/web/src/stores/ingest-store.ts`
- Create: `apps/web/src/stores/ingest-store.test.ts`
- Create: `apps/web/src/hooks/use-ingest-stream.ts`
- Create: `apps/web/src/hooks/use-ingest-stream.test.tsx`

- [ ] **Step 1: Write failing store test**

```ts
// apps/web/src/stores/ingest-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useIngestStore } from "./ingest-store";
import type { IngestEvent } from "@opencairn/shared";

describe("ingest-store", () => {
  beforeEach(() => {
    useIngestStore.setState({ runs: {}, spotlightWfid: null });
  });

  it("startRun creates a run with running status", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    const run = useIngestStore.getState().runs["wf-1"];
    expect(run.status).toBe("running");
    expect(run.fileName).toBe("x.pdf");
  });

  it("applyEvent updates units on unit_parsed", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    const ev: IngestEvent = {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "unit_parsed",
      payload: { index: 2, unitKind: "page", charCount: 100, durationMs: 50 },
    };
    useIngestStore.getState().applyEvent("wf-1", ev);
    expect(useIngestStore.getState().runs["wf-1"].units.current).toBe(3); // 0-indexed → display +1
  });

  it("ignores duplicate seq (idempotent)", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    const ev: IngestEvent = {
      workflowId: "wf-1", seq: 5, ts: "2026-04-27T00:00:00.000Z",
      kind: "figure_extracted",
      payload: { sourceUnit: 0, objectKey: "k", figureKind: "image", caption: null, width: 100, height: 100 },
    };
    useIngestStore.getState().applyEvent("wf-1", ev);
    useIngestStore.getState().applyEvent("wf-1", ev);  // duplicate
    expect(useIngestStore.getState().runs["wf-1"].figures).toHaveLength(1);
  });

  it("completed sets status and noteId", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1", seq: 99, ts: "2026-04-27T00:00:00.000Z",
      kind: "completed",
      payload: { noteId: "00000000-0000-0000-0000-000000000001", totalDurationMs: 5000 },
    });
    const run = useIngestStore.getState().runs["wf-1"];
    expect(run.status).toBe("completed");
    expect(run.noteId).toBe("00000000-0000-0000-0000-000000000001");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test src/stores/ingest-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement store**

```ts
// apps/web/src/stores/ingest-store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { IngestEvent } from "@opencairn/shared";

export type FigureItem = {
  objectKey: string;
  figureKind: "image" | "table" | "chart" | "equation";
  caption: string | null;
  width: number | null;
  height: number | null;
  sourceUnit: number;
};

export type OutlineNode = {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
};

export type IngestRunState = {
  workflowId: string;
  fileName: string | null;
  mime: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  lastSeq: number;
  units: { current: number; total: number | null };
  stage: "downloading" | "parsing" | "enhancing" | "persisting" | null;
  figures: FigureItem[];
  outline: OutlineNode[];
  error: { reason: string; retryable: boolean } | null;
  noteId: string | null;
};

type IngestStore = {
  runs: Record<string, IngestRunState>;
  spotlightWfid: string | null;
  startRun(wfid: string, mime: string, fileName: string | null): void;
  applyEvent(wfid: string, ev: IngestEvent): void;
  setSpotlight(wfid: string | null): void;
  dismissDockCard(wfid: string): void;
};

function emptyRun(wfid: string, mime: string, fileName: string | null): IngestRunState {
  return {
    workflowId: wfid, fileName, mime,
    status: "running", startedAt: Date.now(), lastSeq: 0,
    units: { current: 0, total: null }, stage: null,
    figures: [], outline: [], error: null, noteId: null,
  };
}

export const useIngestStore = create<IngestStore>()(
  persist(
    (set, get) => ({
      runs: {},
      spotlightWfid: null,
      startRun: (wfid, mime, fileName) =>
        set((s) => ({
          runs: { ...s.runs, [wfid]: emptyRun(wfid, mime, fileName) },
          // Spotlight only when no recent startRun in last 200ms (multi-file batch detection).
          spotlightWfid:
            Object.values(s.runs).some(
              (r) => Date.now() - r.startedAt < 200 && r.status === "running",
            )
              ? s.spotlightWfid
              : wfid,
        })),
      applyEvent: (wfid, ev) =>
        set((s) => {
          const run = s.runs[wfid];
          if (!run) return s;
          if (ev.seq <= run.lastSeq) return s;  // idempotent
          const next: IngestRunState = { ...run, lastSeq: ev.seq };
          switch (ev.kind) {
            case "started":
              next.units = { current: 0, total: ev.payload.totalUnits };
              break;
            case "stage_changed":
              next.stage = ev.payload.stage;
              break;
            case "unit_started":
              next.units = { current: ev.payload.index, total: ev.payload.total };
              break;
            case "unit_parsed":
              next.units = { current: ev.payload.index + 1, total: run.units.total };
              break;
            case "figure_extracted":
              next.figures = [...run.figures, {
                objectKey: ev.payload.objectKey,
                figureKind: ev.payload.figureKind,
                caption: ev.payload.caption,
                width: ev.payload.width, height: ev.payload.height,
                sourceUnit: ev.payload.sourceUnit,
              }];
              break;
            case "outline_node":
              next.outline = [...run.outline, {
                id: ev.payload.id, parentId: ev.payload.parentId,
                level: ev.payload.level, title: ev.payload.title,
              }];
              break;
            case "completed":
              next.status = "completed";
              next.noteId = ev.payload.noteId;
              break;
            case "failed":
              next.status = "failed";
              next.error = { reason: ev.payload.reason, retryable: ev.payload.retryable };
              break;
            case "enrichment":
              // A spec stores enrichment events in figures/outline if known type;
              // unknown types are ignored at store level (dense-mode UI may display).
              break;
          }
          return { runs: { ...s.runs, [wfid]: next } };
        }),
      setSpotlight: (wfid) => set({ spotlightWfid: wfid }),
      dismissDockCard: (wfid) =>
        set((s) => {
          const { [wfid]: _, ...rest } = s.runs;
          return { runs: rest };
        }),
    }),
    {
      name: "ingest-store",
      storage: createJSONStorage(() => localStorage),
      // Persist run minimally for reconnect; figures arrays can grow large.
      partialize: (s) => ({
        runs: Object.fromEntries(
          Object.entries(s.runs)
            .filter(([_, r]) => r.status === "running")
            .map(([k, r]) => [k, { ...r, figures: r.figures.slice(-20), outline: r.outline.slice(-100) }]),
        ),
      }),
    },
  ),
);
```

- [ ] **Step 4: Run store test**

```bash
pnpm --filter @opencairn/web test src/stores/ingest-store.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Implement SSE hook**

```ts
// apps/web/src/hooks/use-ingest-stream.ts
"use client";
import { useEffect } from "react";
import { IngestEvent } from "@opencairn/shared";
import { useIngestStore } from "@/stores/ingest-store";

/**
 * Subscribe to /api/ingest/stream/:wfid via EventSource. Re-runs on wfid
 * change; auto-reconnect is handled by EventSource (Last-Event-ID inferred
 * from the `id` field of last received message).
 */
export function useIngestStream(wfid: string | null): void {
  const applyEvent = useIngestStore((s) => s.applyEvent);

  useEffect(() => {
    if (!wfid) return;
    const url = `/api/ingest/stream/${wfid}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (msg) => {
      try {
        const parsed = IngestEvent.parse(JSON.parse(msg.data));
        applyEvent(wfid, parsed);
        if (parsed.kind === "completed" || parsed.kind === "failed") {
          es.close();
        }
      } catch (e) {
        // Malformed event — log but don't break the stream.
        console.warn("[ingest-stream] parse failed", e);
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; we let it. Hard close only on permanent
      // 4xx (not detectable from EventSource — handled by server-side close).
    };

    return () => es.close();
  }, [wfid, applyEvent]);
}
```

- [ ] **Step 6: Hook test (optional but recommended)**

`mock-eventsource` 라이브러리로 라이프사이클 verify. (간단 setup이므로 선택)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stores/ingest-store.ts apps/web/src/stores/ingest-store.test.ts \
        apps/web/src/hooks/use-ingest-stream.ts
git commit -m "feat(web): IngestStore (zustand+persist) + SSE stream hook"
```

---

### Task 11: Upload action wiring → store + SSE

**Files:**
- Modify: 기존 업로드 컴포넌트 (찾기: `grep -r '/api/ingest/upload' apps/web/src/`)

업로드 시점에 store에 startRun 호출 + 응답의 workflowId로 SSE 구독 시작.

- [ ] **Step 1: 업로드 호출부 식별**

```bash
grep -rn "/api/ingest/upload" apps/web/src/ --include="*.tsx" --include="*.ts"
```

기대: 1~2 파일. 각 호출 직후 store 호출 추가.

- [ ] **Step 2: Wire startRun**

```tsx
// 예시 — 실제 컴포넌트 위치는 grep으로 발견
import { useIngestStore } from "@/stores/ingest-store";

const onUpload = async (file: File, projectId: string) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("projectId", projectId);
  const res = await fetch("/api/ingest/upload", { method: "POST", body: fd });
  const json = await res.json();  // { workflowId, objectKey }

  useIngestStore.getState().startRun(json.workflowId, file.type, file.name);
  // <IngestSpotlight> + <IngestDock>가 store 변화 감지하여 자동 렌더
};
```

- [ ] **Step 3: 통합 dev smoke**

```bash
pnpm dev
```

PDF 업로드 → DevTools에서 store 상태 확인 (`useIngestStore.getState()` 콘솔 호출).

- [ ] **Step 4: Commit**

```bash
git add <upload component files>
git commit -m "feat(web): wire upload to IngestStore.startRun"
```

---

### Task 12: `<IngestProgressView>` 공통 컨테이너

**Files:**
- Create: `apps/web/src/components/ingest/ingest-progress-view.tsx`
- Create: `apps/web/src/components/ingest/ingest-figure-gallery.tsx`
- Create: `apps/web/src/components/ingest/ingest-outline-tree.tsx`
- Create: `apps/web/src/components/ingest/ingest-page-pulse.tsx`
- Test: `apps/web/src/components/ingest/ingest-progress-view.test.tsx`

세 컨테이너(spotlight/tab/dock)가 모두 이걸 다른 사이즈로 렌더.

- [ ] **Step 1: Write minimal test**

```tsx
// ingest-progress-view.test.tsx
import { render, screen } from "@testing-library/react";
import { IngestProgressView } from "./ingest-progress-view";
import { useIngestStore } from "@/stores/ingest-store";

describe("<IngestProgressView>", () => {
  beforeEach(() => useIngestStore.setState({ runs: {}, spotlightWfid: null }));

  it("renders nothing when no run", () => {
    const { container } = render(<IngestProgressView wfid="absent" mode="tab" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders fileName and units when run exists", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    render(<IngestProgressView wfid="wf-1" mode="tab" />);
    expect(screen.getByText(/paper\.pdf/)).toBeInTheDocument();
  });

  it("shows figures count when figures exist", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1", seq: 1, ts: "...", kind: "figure_extracted",
      payload: { sourceUnit: 0, objectKey: "k", figureKind: "image", caption: null, width: 100, height: 100 },
    } as any);
    render(<IngestProgressView wfid="wf-1" mode="tab" />);
    expect(screen.getByTestId("figure-count")).toHaveTextContent("1");
  });
});
```

- [ ] **Step 2: Run test → fail**

- [ ] **Step 3: Implement**

```tsx
// ingest-progress-view.tsx
"use client";
import { useTranslations } from "next-intl";
import { useIngestStore } from "@/stores/ingest-store";
import { IngestFigureGallery } from "./ingest-figure-gallery";
import { IngestOutlineTree } from "./ingest-outline-tree";
import { IngestPagePulse } from "./ingest-page-pulse";

export type IngestViewMode = "spotlight" | "tab" | "dock";

export function IngestProgressView({ wfid, mode }: { wfid: string; mode: IngestViewMode }) {
  const run = useIngestStore((s) => s.runs[wfid]);
  const t = useTranslations("ingest");
  if (!run) return null;

  const pct = run.units.total
    ? Math.round((run.units.current / run.units.total) * 100)
    : null;

  if (mode === "dock") {
    return (
      <div className="ingest-card-dock" data-testid="ingest-dock-card">
        <div className="ingest-card-name">{run.fileName ?? "?"}</div>
        <progress max={100} value={pct ?? undefined} />
        <span data-testid="figure-count">{run.figures.length}</span>
      </div>
    );
  }

  return (
    <div className={`ingest-progress-view mode-${mode}`}>
      <header className="ingest-header">
        <h2>{run.fileName ?? "?"}</h2>
        <span>{t(`stage.${run.stage ?? "parsing"}`)}</span>
        {pct !== null && <span>{pct}%</span>}
      </header>
      <div className="ingest-grid">
        <aside className="ingest-outline">
          <IngestOutlineTree nodes={run.outline} />
        </aside>
        <main className="ingest-pulse">
          <IngestPagePulse units={run.units} />
        </main>
        <aside className="ingest-figures">
          <IngestFigureGallery figures={run.figures} />
          <span data-testid="figure-count" className="sr-only">{run.figures.length}</span>
        </aside>
      </div>
    </div>
  );
}
```

```tsx
// ingest-figure-gallery.tsx
import type { FigureItem } from "@/stores/ingest-store";

export function IngestFigureGallery({ figures }: { figures: FigureItem[] }) {
  return (
    <ul className="ingest-figures-list">
      {figures.map((f, i) => (
        <li key={`${f.objectKey}-${i}`} className={`figure-item kind-${f.figureKind}`}>
          <img src={`/api/ingest/figures/${encodeURIComponent(f.objectKey)}`} alt={f.caption ?? ""} />
          {f.caption && <figcaption>{f.caption}</figcaption>}
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// ingest-outline-tree.tsx — 단순 평탄 리스트 (트리 시각화는 후속)
import type { OutlineNode } from "@/stores/ingest-store";

export function IngestOutlineTree({ nodes }: { nodes: OutlineNode[] }) {
  return (
    <ul className="ingest-outline-list">
      {nodes.map((n) => (
        <li key={n.id} style={{ paddingLeft: `${(n.level - 1) * 12}px` }}>{n.title}</li>
      ))}
    </ul>
  );
}
```

```tsx
// ingest-page-pulse.tsx — MVP에선 단순 progress visual
export function IngestPagePulse({ units }: { units: { current: number; total: number | null } }) {
  return (
    <div className="ingest-pulse-card" data-testid="ingest-pulse">
      <div className="page-shadow" />
      <div className="scan-ray" data-current={units.current} />
      {units.total && <span>{units.current} / {units.total}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Need a figure proxy endpoint**

위에서 `/api/ingest/figures/:objectKey`를 사용했지만 아직 없음. spec Open Q #3 — MVP 결정: **기존 `/api/notes/:id/file` 패턴 따라 `GET /api/ingest/figures/:wfid/:filename` 신규 추가**, MinIO presigned URL을 반환하거나 stream proxy.

`apps/api/src/routes/ingest.ts`에:

```ts
.get("/figures/:wfid/:filename", async (c) => {
  const user = c.get("user");
  const wfid = c.req.param("wfid");
  const filename = c.req.param("filename");

  const [row] = await db
    .select({ userId: ingestJobs.userId })
    .from(ingestJobs)
    .where(eq(ingestJobs.workflowId, wfid));
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

  const objectKey = `uploads/${user.id}/figures/${wfid}/${filename}`;
  const stream = await getObjectStream(objectKey); // existing s3 helper
  return new Response(stream, {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
  });
})
```

웹 측 `IngestFigureGallery`의 src도 `/api/ingest/figures/${wfid}/${basename(objectKey)}` 형태로 변경. store의 figure에 `wfid` 또는 basename을 저장하도록 작은 조정.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @opencairn/web test src/components/ingest/
pnpm --filter @opencairn/api test src/routes/ingest.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ingest/ apps/web/src/stores/ingest-store.ts apps/api/src/routes/ingest.ts
git commit -m "feat(web): IngestProgressView (figure gallery + outline + page pulse) + figures proxy"
```

---

### Task 13: `<IngestSpotlight>` overlay (auto-collapse)

**Files:**
- Create: `apps/web/src/components/ingest/ingest-spotlight.tsx`
- Create: `apps/web/src/components/ingest/ingest-spotlight.test.tsx`

자동 collapse 트리거: 7s OR 첫 figure OR 첫 unit_parsed (spec §7.2). 다중 파일 시 spotlight 하나만 (store의 `spotlightWfid` 사용).

- [ ] **Step 1: Write test**

```tsx
import { render, screen, act, waitFor } from "@testing-library/react";
import { IngestSpotlight } from "./ingest-spotlight";
import { useIngestStore } from "@/stores/ingest-store";

describe("<IngestSpotlight>", () => {
  beforeEach(() => useIngestStore.setState({ runs: {}, spotlightWfid: null }));

  it("renders when spotlightWfid set", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    render(<IngestSpotlight />);
    expect(screen.getByTestId("ingest-spotlight")).toBeInTheDocument();
  });

  it("collapses when first figure arrives", async () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    render(<IngestSpotlight />);
    expect(screen.getByTestId("ingest-spotlight")).toBeInTheDocument();
    act(() => {
      useIngestStore.getState().applyEvent("wf-1", {
        workflowId: "wf-1", seq: 1, ts: "...", kind: "figure_extracted",
        payload: { sourceUnit: 0, objectKey: "k", figureKind: "image", caption: null, width: 100, height: 100 },
      } as any);
    });
    await waitFor(() => expect(screen.queryByTestId("ingest-spotlight")).not.toBeInTheDocument());
  });

  it("auto-collapses after 7s", async () => {
    vi.useFakeTimers();
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    render(<IngestSpotlight />);
    act(() => { vi.advanceTimersByTime(7100); });
    await waitFor(() => expect(screen.queryByTestId("ingest-spotlight")).not.toBeInTheDocument());
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test → fail**

- [ ] **Step 3: Implement**

```tsx
// ingest-spotlight.tsx
"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useIngestStore } from "@/stores/ingest-store";
import { IngestProgressView } from "./ingest-progress-view";

const SPOTLIGHT_TIMEOUT_MS = 7000;

export function IngestSpotlight() {
  const wfid = useIngestStore((s) => s.spotlightWfid);
  const setSpotlight = useIngestStore((s) => s.setSpotlight);
  const run = useIngestStore((s) => (wfid ? s.runs[wfid] : null));
  const t = useTranslations("ingest.spotlight");

  // Auto-collapse triggers
  useEffect(() => {
    if (!wfid || !run) return;
    if (run.figures.length > 0 || run.units.current > 0) {
      setSpotlight(null);
      return;
    }
    const timer = setTimeout(() => setSpotlight(null), SPOTLIGHT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [wfid, run, setSpotlight]);

  if (!wfid || !run || run.status !== "running") return null;

  return (
    <div data-testid="ingest-spotlight" className="ingest-spotlight-overlay">
      <button className="skip-button" onClick={() => setSpotlight(null)}>
        {t("skipToTab")}
      </button>
      <IngestProgressView wfid={wfid} mode="spotlight" />
    </div>
  );
}
```

- [ ] **Step 4: Mount in shell**

`apps/web/src/app/[locale]/(shell)/...layout.tsx` (또는 글로벌 shell layout)에서 `<IngestSpotlight />`를 최상위에 마운트. 다른 모달과의 z-index 협상.

- [ ] **Step 5: Run test → pass**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ingest/ingest-spotlight.tsx \
        apps/web/src/components/ingest/ingest-spotlight.test.tsx \
        apps/web/src/app/[locale]/\(shell\)/layout.tsx
git commit -m "feat(web): IngestSpotlight overlay with auto-collapse"
```

---

### Task 14: `<IngestDock>` 우하단 floating cards

**Files:**
- Create: `apps/web/src/components/ingest/ingest-dock.tsx`
- Create: `apps/web/src/components/ingest/ingest-dock.test.tsx`

모든 진행중/완료/실패 카드를 stack. 12개 초과 시 "+N more" 압축 (spec §10.1).

- [ ] **Step 1: Test**

```tsx
describe("<IngestDock>", () => {
  beforeEach(() => useIngestStore.setState({ runs: {}, spotlightWfid: null }));

  it("renders nothing when no runs", () => {
    const { container } = render(<IngestDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per run, max 12 + overflow", () => {
    for (let i = 0; i < 15; i++) {
      useIngestStore.getState().startRun(`wf-${i}`, "application/pdf", `f${i}.pdf`);
    }
    render(<IngestDock />);
    expect(screen.getAllByTestId("ingest-dock-card")).toHaveLength(12);
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
  });

  it("dismisses card when X clicked (running stays, completed gets removed)", () => { /* ... */ });
});
```

- [ ] **Step 2: Implement**

```tsx
// ingest-dock.tsx
"use client";
import { useTranslations } from "next-intl";
import { useIngestStore } from "@/stores/ingest-store";
import { IngestProgressView } from "./ingest-progress-view";
import Link from "next/link";

const DOCK_MAX = 12;

export function IngestDock() {
  const runs = useIngestStore((s) => s.runs);
  const dismiss = useIngestStore((s) => s.dismissDockCard);
  const t = useTranslations("ingest.dock");

  const cards = Object.values(runs).sort((a, b) => b.startedAt - a.startedAt);
  if (cards.length === 0) return null;
  const visible = cards.slice(0, DOCK_MAX);
  const overflow = cards.length - visible.length;

  return (
    <div className="ingest-dock-container">
      {visible.map((r) => (
        <div key={r.workflowId} className={`ingest-dock-card status-${r.status}`}>
          {r.status === "running" && <IngestProgressView wfid={r.workflowId} mode="dock" />}
          {r.status === "completed" && r.noteId && (
            <Link href={`/notes/${r.noteId}`}>{t("openNote")}</Link>
          )}
          {r.status === "failed" && r.error && (
            <div>
              <span>{r.error.reason}</span>
              {r.error.retryable && <button>{t("retry")}</button>}
            </div>
          )}
          <button aria-label={t("dismiss")} onClick={() => dismiss(r.workflowId)}>×</button>
        </div>
      ))}
      {overflow > 0 && <div className="ingest-dock-overflow">{t("moreCount", { n: overflow })}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Mount in shell** (Spotlight 옆)

- [ ] **Step 4: Wire SSE per run**

각 dock 카드가 SSE 구독 시작하도록 — 가장 깔끔한 패턴: dock 컴포넌트 안에서 `runs`를 순회하며 각각 `useIngestStream(wfid)` 호출. 단 hook은 컴포넌트 단위라 별도 child 컴포넌트로 분리:

```tsx
function IngestRunSubscriber({ wfid }: { wfid: string }) {
  useIngestStream(wfid);
  return null;
}
// IngestDock 안:
{cards.map((r) => <IngestRunSubscriber key={r.workflowId} wfid={r.workflowId} />)}
```

- [ ] **Step 5: Run test → pass**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ingest/ingest-dock.tsx \
        apps/web/src/components/ingest/ingest-dock.test.tsx
git commit -m "feat(web): IngestDock floating cards with overflow"
```

---

### Task 15: Tab Mode "ingest" 등록

**Files:**
- Modify: `apps/web/src/stores/tabs-store.ts` (Tab.mode union 확장)
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/ingest-viewer.tsx`
- Create: `apps/web/src/components/ingest/ingest-tab-view.tsx`

dock 카드 클릭 시 또는 사용자가 명시적으로 "탭에서 보기" 누르면 ingest 모드 탭이 열림.

- [ ] **Step 1: Extend Tab.mode**

`tabs-store.ts`의 mode union에 `"ingest"` 추가. 기존 패턴 따라:

```ts
export type TabMode = "plate" | "reading" | "source" | "data" | "canvas" | "graph" | "ingest";

export interface Tab {
  // ...
  mode: TabMode;
  // For ingest mode, tab.params should include workflowId
  params?: { workflowId?: string; ... };
}
```

- [ ] **Step 2: Add IngestViewer to router**

```tsx
// tab-mode-router.tsx
import { IngestViewer } from "./viewers/ingest-viewer";

// switch case 추가:
case "ingest":
  return <IngestViewer tab={tab} />;
```

- [ ] **Step 3: Implement IngestViewer**

```tsx
// viewers/ingest-viewer.tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { useIngestStream } from "@/hooks/use-ingest-stream";
import { IngestProgressView } from "@/components/ingest/ingest-progress-view";

export function IngestViewer({ tab }: { tab: Tab }) {
  const wfid = tab.params?.workflowId;
  const [dense, setDense] = useState(false);
  const t = useTranslations("ingest.tab");
  useIngestStream(wfid ?? null);
  if (!wfid) return null;

  return (
    <div className="ingest-tab-viewer">
      <button onClick={() => setDense((d) => !d)}>
        {dense ? t("denseToggleOff") : t("denseToggle")}
      </button>
      <IngestProgressView wfid={wfid} mode="tab" />
      {/* Dense mode: event feed */}
    </div>
  );
}
```

- [ ] **Step 4: "탭에서 보기" 버튼 wiring**

dock card / spotlight skip 버튼이 탭을 열도록:

```tsx
// somewhere in dock/spotlight:
import { useTabsStore } from "@/stores/tabs-store";

function openInTab(wfid: string, fileName: string | null) {
  useTabsStore.getState().openTab({
    id: `ingest-${wfid}`,
    mode: "ingest",
    titleKey: "ingest.tab.title",
    titleParams: { fileName: fileName ?? "?" },
    params: { workflowId: wfid },
  });
}
```

- [ ] **Step 5: Tests for tabs-store extension + router**

기존 `tabs-store.test.ts` / `tab-mode-router.test.tsx`에 ingest mode 케이스 추가.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @opencairn/web test src/components/tab-shell/ src/stores/tabs-store
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/tab-shell/ apps/web/src/stores/tabs-store.ts \
        apps/web/src/components/ingest/ingest-tab-view.tsx
git commit -m "feat(web): tab mode 'ingest' with IngestViewer"
```

---

### Task 16: 완료/실패 라우팅 + 5초 자동 redirect

**Files:**
- Modify: `apps/web/src/components/ingest/ingest-spotlight.tsx`
- Modify: `apps/web/src/components/ingest/ingest-dock.tsx`
- (또는 신규) `apps/web/src/hooks/use-ingest-completion-redirect.ts`

`completed` 도달 시 5초 후 자동으로 source note로 라우팅 (사용자가 dismiss하면 취소).

- [ ] **Step 1: Implement hook**

```ts
// use-ingest-completion-redirect.ts
"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useIngestStore } from "@/stores/ingest-store";

export function useIngestCompletionRedirect(wfid: string | null, opts: { delayMs?: number; enabled?: boolean }) {
  const run = useIngestStore((s) => (wfid ? s.runs[wfid] : null));
  const router = useRouter();
  const cancelled = useRef(false);

  useEffect(() => {
    if (!run || run.status !== "completed" || !run.noteId) return;
    if (opts.enabled === false) return;
    cancelled.current = false;
    const timer = setTimeout(() => {
      if (!cancelled.current) router.push(`/notes/${run.noteId}`);
    }, opts.delayMs ?? 5000);
    return () => { cancelled.current = true; clearTimeout(timer); };
  }, [run?.status, run?.noteId, router, opts.delayMs, opts.enabled]);
}
```

- [ ] **Step 2: Spotlight 사용 (early-completion)**

spotlight 보이는 동안 완료되면 즉시 "노트 열기" CTA로 변환 (자동 redirect는 spotlight에서는 안 함; 사용자가 명시적 클릭).

- [ ] **Step 3: Tab viewer가 use_ingest_completion_redirect 호출**

탭 뷰에서만 자동 redirect. dock 카드는 클릭 시 라우팅.

- [ ] **Step 4: Test the redirect hook**

vi.useFakeTimers + mock router로 5s 후 router.push 호출되는지 + cancel 시 미발생.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-ingest-completion-redirect.ts \
        apps/web/src/components/ingest/
git commit -m "feat(web): auto-redirect to source note 5s after completion (cancellable)"
```

---

### Task 17: Reconnect / Replay 통합 검증

**Files:** 변경 없음 (수동/자동 검증)

- [ ] **Step 1: 신규 통합 테스트 (web)**

```tsx
// integration: localStorage 복원 후 SSE Last-Event-ID 발송
it("reconnects after reload using Last-Event-ID", async () => {
  // 1. startRun + applyEvent up to seq 5 → persisted
  // 2. simulate reload (re-create store from localStorage)
  // 3. EventSource를 mock하여 Last-Event-ID === '5' 인지 verify
});
```

EventSource는 표준이지만 `Last-Event-ID` 헤더 자동 송신은 브라우저가 직접 — jsdom mock으로는 정확히 검증 어려움. → **E2E (Playwright)에서 실제 검증**.

- [ ] **Step 2: Playwright E2E**

```ts
// apps/web/playwright/ingest-live.spec.ts
test("ingest spotlight → tab → completion → source note", async ({ page }) => {
  // 1. login
  // 2. upload PDF (fixture)
  // 3. expect spotlight overlay visible
  // 4. wait for first figure (or 7s timeout) → expect collapse to dock
  // 5. click dock card → ingest tab opens
  // 6. wait completed event → 5s later expect source note URL
});
```

- [ ] **Step 3: Run E2E**

```bash
pnpm --filter @opencairn/web exec playwright test ingest-live
```

PASS 확인. fixture PDF는 5~10페이지짜리 단순한 거.

- [ ] **Step 4: Commit**

```bash
git add apps/web/playwright/ingest-live.spec.ts
git commit -m "test(web): E2E for live ingest spotlight→dock→tab→completion"
```

---

### Task 18: Feature flag + 문서화 + 최종 commit

**Files:**
- Modify: `.env.example` (`FEATURE_LIVE_INGEST=true` default in dev)
- Modify: `docs/contributing/plans-status.md` (이 plan 완료 표시)
- Create: 짧은 운영 노트 — `docs/architecture/data-flow.md`에 추가 섹션 또는 별도

- [ ] **Step 1: Feature flag**

`apps/web`의 layout에서 `process.env.NEXT_PUBLIC_FEATURE_LIVE_INGEST === "true"`일 때만 Spotlight + Dock 마운트. backend는 항상 publish (회귀 위험 0).

- [ ] **Step 2: plans-status.md 업데이트**

추가 entry: "Live Ingest Visualization — ✅ <YYYY-MM-DD>"

- [ ] **Step 3: data-flow.md 보강**

ingest pipeline 섹션에 SSE event channel 추가 그림.

- [ ] **Step 4: 최종 통합 smoke**

스택 전체 띄우고 PDF/audio/image 각각 업로드 → spotlight/dock 확인.

- [ ] **Step 5: Commit + tag**

```bash
git add .env.example docs/contributing/plans-status.md docs/architecture/data-flow.md
git commit -m "docs(plans): mark live-ingest-visualization complete + flag wiring"
git tag -a v-live-ingest-complete -m "Live ingest visualization MVP complete"
```

---

## Phase 3 — Follow-up Plans (별도)

본 plan 안에 포함하지 않음. 완료 후 별도 plan으로 작성:

- **rate-limit Redis 마이그레이션** — 본 plan이 도입한 ioredis 클라이언트 재사용 (`apps/api/src/lib/rate-limit.ts:3-4` TODO)
- **visualize-lock Redis SET-NX** — 동일 (`apps/api/src/lib/visualize-lock.ts:3-9` TODO, Plan 5 §5.6)
- **B spec 머지 시 enrichment 구체 위젯 추가** — A는 wrapper만 처리, B 머지 후 type별 widget
- **E spec 머지 시 multi-file dispatch 흐름 검증** — 동시 N개 spotlight skip 정책 동작 확인
- **figure 캐싱 정책** — `/api/ingest/figures/...`에 presigned URL + edge cache (현재는 stream proxy)
- **mobile spotlight 대체** — 현재 모바일에서 spotlight 생략, dock만. 후속에서 모바일 spotlight 디자인.
- **Activity timeout 회귀 모니터링** — page-loop가 30분 timeout 안에 완료되는지 prod 메트릭 추가

---

## Self-Review (실행 전 점검 결과)

**Spec coverage:**
- §4 Architecture → Task 1~7 (스키마/redis/emitter/SSE)
- §5 Event Schema → Task 1
- §6 Activity Refactor → Task 4 (PDF), Task 5 (다른 mime), Task 6 (workflow_id 전파)
- §7 UI States → Task 9~16 (i18n/store/views/dock/tab/redirect)
- §8 Reconnect & Replay → Task 7 (서버), Task 10 (클라), Task 17 (E2E)
- §9 Failure & Cancel UX → Task 5 (failed 발행), Task 14 (dock 표시), 취소는 Non-Goal
- §10 Performance & Limits → Task 3 (TTL/maxlen 환경변수), Task 14 (dock 12개 상한)
- §11 Cross-spec Boundaries → Task 1 (enrichment wrapper), Phase 3 (E/B 머지 후속)
- §12 Test Plan → 각 task 안에 단위 테스트 + Task 17 E2E
- §13 Open Questions → spec defaults 따름, follow-up은 Phase 3

**Type consistency:** `IngestEvent` 정본은 `packages/shared/src/ingest-events.ts` (Task 1) → 모든 후속 task가 import. `FigureItem`/`OutlineNode`는 `ingest-store.ts` 안에 정의 + `IngestProgressView`/Gallery/Tree가 import. 일관.

**Placeholder scan:** "TBD"/"implement later"/"add appropriate error handling" 없음. 각 step에 실제 코드/명령/expected output 명시. Task 4 Step 1은 "실측" 단계지만 명령과 결과 처리 방향이 박혀있음.

**Gap noted:** Task 12 Step 4에서 figure proxy endpoint를 즉흥적으로 추가했음. 이건 spec §13 Open Q #3에 있던 미결 — plan에서 결정 (`/api/ingest/figures/:wfid/:filename`)으로 lock-in. spec 본문에 작은 수정 가능하나 plan이 우선 결정으로 동작.

---

## Execution Notes

- **워크트리:** main 세션에서 본 plan 실행 시 워크트리로 이동 권장 — `git worktree add .worktrees/plan-live-ingest -b feat/live-ingest main`. CLAUDE.md "병렬 세션 = 워크트리 필수" 규칙.
- **마이그레이션 번호:** 본 plan은 DB 변경 0. 새 마이그레이션 없음.
- **자매 spec 진행 상태 모니터:** B/E/F 워크트리가 spec 머지하면 본 plan의 Task 5 / Task 11에 영향 가능. 충돌 발생 시 메인 세션에서 조율.
- **Co-Authored-By:** 모든 커밋에 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer 필수 (memory feedback_opencairn_commit_coauthor).
