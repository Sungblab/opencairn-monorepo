# Live Ingest Visualization — "파일 던지면 살아 움직이는 로딩"

**Status:** Draft (2026-04-27)
**Owner:** Sungbin
**Working title (UI):** Live Ingest / 라이브 인제스트
**Related:**

- [data-flow.md](../../architecture/data-flow.md) — 기존 ingest → wiki → Q&A 플로우
- [api-contract.md](../../architecture/api-contract.md) — Zod + requireAuth + workspace scope 규율
- [collaboration-model.md](../../architecture/collaboration-model.md) — workspace 3계층 권한
- [llm-antipatterns.md](../../contributing/llm-antipatterns.md) — Plate v49 / SSE 함정
- 자매 spec (parallel sessions, 같은 product line):
  - **B — Content-aware Enrichment** (`spec/b-enrichment` 워크트리) — 본 spec이 정의한 `IngestEvent.kind="enrichment"` wrapper에 type 값을 채워 넣음
  - **E — Literature Search → Auto-Ingest** (`spec/e-litsearch` 워크트리) — 본 spec의 ingest 진입점에 N개 파일을 dispatch하는 검색 어그리게이터
  - **F — Multi-format Synthesis Export** (`spec/f-synthesis` 워크트리) — 무관 (output 끝)

---

## 1. Problem

OpenCairn 사용자가 PDF/문서/논문/오디오 등을 업로드하면 현재는:

1. `POST /api/ingest/upload` → 202 + `workflowId` 반환
2. 클라이언트가 `GET /api/ingest/status/:workflowId` 폴링
3. 응답으로 받는 정보는 **Temporal workflow status name 한 단어** (`RUNNING`/`COMPLETED`/`FAILED`)
4. 완료 시 `noteId`로 라우팅

이 과정에서 사용자가 보는 것은 사실상 **"분석 중..." 스피너 + 1~5분 대기**. PDF가 30페이지면 30페이지 분량의 작업이 안에서 돌고 있는데 클라이언트는 그걸 모름. 두 가지 손실:

1. **체감 가치 소멸** — 우리가 뽑아낸 figure, outline, structured text가 완성되기 전까지 0으로 보임. 첫 사용자가 "이게 뭐 한 거지?"라고 느낌.
2. **Cold-start 실패** — 신규 사용자가 워크스페이스에 들어와도 "뭘 해야 할지 모름"이라는 OpenCairn 최대 약점이 그대로. 업로드라는 첫 액션의 즉각 보상이 약함.

**본 spec은 ingest pipeline의 진행 상황을 실시간 이벤트로 흘려서, 업로드 → 라이브 시각화 → 워크스페이스 진입까지 한 흐름의 fancy 로딩 경험을 정의한다.** 단, 이건 새로운 워크플로우가 아니라 **기존 ingest의 가시성 레이어**다. 기존 파이프라인 동작은 변하지 않으며, 추가될 뿐이다.

---

## 2. Goals & Non-Goals

### Goals (MVP)

- 모든 ingest 진입점(`/api/ingest/upload`, `/api/ingest/url`)이 시작한 워크플로우의 **per-step 진행 이벤트**를 클라이언트에 실시간 push
- **PDF 우선** 풍부한 이벤트 (page_started / page_parsed / figure_extracted / outline_node)
- 나머지 mime은 **최소 공통셋** (started / stage_changed / completed / failed)
- **Hybrid UI** — 업로드 직후 ~7초 spotlight overlay → 자동 collapse → 전용 탭 + 우하단 floating dock 양쪽에 살아있음
- **다중 파일** dock에 stack (한 번에 N개 업로드 가능)
- **재연결 replay** — 페이지 새로고침/탭 전환/네트워크 끊김 후 마지막 이벤트부터 이어받음
- **셀프호스트 친화** — 이미 docker-compose에 있는 Redis 활용, 신규 인프라 0
- ko/en i18n parity (ko-first, en은 런칭 직전)

### Non-Goals (MVP 밖)

- **사용자 인터랙션** — ingest 도중 "이 figure 무시" / "이 페이지부터 다시" / "번역 끄기" 같은 라이브 조작. Temporal signal 채널 + activity 분할 필요. (별도 spec, "Interactive Ingest")
- **추론 카드** — "이 figure는 차트로 분류" / "abstract 검출됨" 같은 의사결정 카드. 현재 ingest는 결정론적 파싱이라 진짜 추론이 없음. 가짜 LLM 호출로 채우는 건 정직성/비용/시간 모두 손해. **B spec이 진짜 enrichment를 추가할 때 자연스럽게 보임.**
- **B의 enrichment 종류 정의** — 번역/섹션 라벨/figure 분류 등은 B spec이 정의. 본 spec은 wrapper만 둠.
- **E의 검색 UI** — 검색 → import dispatch는 E spec. 본 spec은 dispatch 이후 시각화만.
- **인포그래픽/차트 인라인 렌더** — figure 갤러리에 정적 이미지로만 표시. 차트 재생성은 Plan 10B 영역.
- **수평 확장된 API 인스턴스 간 fanout** — 단일 API 인스턴스 가정 + Redis pub/sub만. multi-instance 인스턴스 friendly한 구조지만 구현 시 검증 후순위.
- **모바일 전용 UX** — 데스크톱 first. 모바일은 spotlight 생략 + dock만으로 fallback.

---

## 3. Dependencies

- **Plan 1** — Better Auth + workspace 모델 (이벤트 채널은 사용자 단위 구독 격리 필요)
- **Plan 3** — `IngestWorkflow` + 8개 activity (parse_pdf / transcribe_audio / analyze_image / ingest_youtube / scrape_web_url / enhance_with_gemini / create_source_note / quarantine_source)
- **Plan 13** — multi-LLM provider (enhance activity의 멀티모달 호출 영향 범위)
- **App Shell Phase 3-B** — Tab Mode Router. 본 spec은 신규 `ingest` mode를 등록.
- **App Shell Phase 5** — 글로벌 store / palette / notifications 패턴 재사용
- **Redis** — 이미 `docker-compose.yml`에 `redis:7-alpine` + `redisdata` volume 존재. **본 spec이 첫 클라이언트 도입자**.

### 동반되는 부수 개선 (가시성 ↑)

본 spec이 Redis 클라이언트를 도입하면서, 이미 Redis를 기다리는 두 모듈도 같은 클라이언트로 마이그레이션할 수 있다. 본 spec이 직접 처리하지 않지만, **별도 follow-up plan으로 정리**:

- `apps/api/src/lib/rate-limit.ts` — in-memory → Redis (multi-instance 대비)
- `apps/api/src/lib/visualize-lock.ts` — in-memory → Redis SET-NX (Plan 5 §5.6 TODO)

---

## 4. Architecture

```
┌────────────────────┐                                         ┌──────────────────────┐
│ apps/web           │ ◀──── SSE (text/event-stream) ──────── │ apps/api             │
│ ┌──────────────┐   │     GET /api/ingest/stream/:wfid       │ ┌──────────────────┐ │
│ │ <Spotlight>  │   │     Last-Event-ID: <seq>               │ │ ingestStream     │ │
│ │ (overlay)    │   │                                        │ │ (Redis SUBSCRIBE)│ │
│ └──────────────┘   │                                        │ └────────┬─────────┘ │
│ ┌──────────────┐   │                                        └──────────┼───────────┘
│ │ Tab Mode     │   │                                                   │
│ │ "ingest"     │   │                                          PSUBSCRIBE ingest:events:*
│ └──────────────┘   │                                                   │
│ ┌──────────────┐   │                                                   ▼
│ │ <IngestDock> │   │                                       ┌────────────────────┐
│ │ (floating)   │   │                                       │ Redis (pub/sub +   │
│ └──────────────┘   │                                       │ ring buffer LIST)  │
│ store: ingest      │                                       └─────▲──────┬───────┘
└────────────────────┘                                             │      │
                                                                   │      │ LRANGE replay
                                                                   │      │ EXPIRE 3600
                                              PUBLISH ingest:events:{wfid}│
                                              LPUSH   ingest:replay:{wfid}│
                                                                   │      │
                                                            ┌──────┴──────┴───────┐
                                                            │ apps/worker         │
                                                            │ (Temporal activities)│
                                                            │ ┌─────────────────┐ │
                                                            │ │ parse_pdf       │ │
                                                            │ │ (page loop)     │ │
                                                            │ │ enhance_*       │ │
                                                            │ │ etc.            │ │
                                                            │ └─────────────────┘ │
                                                            │ shared:              │
                                                            │   IngestEventEmitter │
                                                            └──────────────────────┘
```

### 경계 원칙

- **`apps/api`는 Temporal에 직접 진행 이벤트를 묻지 않는다** — Temporal `describe()`/`getHistory()`는 디버깅용. 라이브 진행은 Redis 채널 단일 출처.
- **`apps/worker`는 절대 클라이언트로 직접 push하지 않는다** — 항상 Redis로 publish. SSE fanout은 API의 책임.
- **이벤트 스키마는 `packages/shared`에 단일 정의** — TypeScript 정의가 정본. Python 측은 동일 dict shape를 손으로 미러링하되 ts 타입을 import 못 하므로 주석 + 단위테스트로 drift 방지.
- **이벤트는 부산물이지 트리거가 아니다** — 클라이언트가 SSE 받아도 워크스페이스 상태는 바뀌지 않음 (그건 `create_source_note`의 책임). 이벤트는 순수 가시성 레이어.

### 인증/권한

- SSE 엔드포인트 `GET /api/ingest/stream/:workflowId` — `requireAuth` + `ingest_jobs.userId === user.id` 강제 (기존 `/status`와 동일 패턴, `apps/api/src/routes/ingest.ts:254-267` 재사용)
- Redis 채널 자체는 별도 ACL 없음 (서버 내부) — 노출 경계가 SSE 핸들러 한 곳뿐이라 충분
- workspace_id는 이벤트 페이로드에 포함하지 않음 (이미 SSE 입장 시 인증된 사용자의 row로 검증됨)

---

## 5. Event Schema

### 5.1 정본 정의 (TypeScript)

위치: `packages/shared/src/ingest-events.ts` (신규)

```ts
import { z } from "zod";

/** 단조 증가 sequence — Redis INCR로 발급. 재연결 시 Last-Event-ID로 사용. */
export type IngestEventSeq = number;

/** 이벤트 종류 — closed set. 새로운 종류는 본 spec/B spec 개정 후 추가. */
export const IngestEventKind = z.enum([
  // 라이프사이클 (모든 mime 공통)
  "started",
  "stage_changed",
  "completed",
  "failed",

  // 단위 진행 (mime마다 unit 의미가 다름)
  "unit_started",
  "unit_parsed",

  // 추출 산출물 (라이브 시각화 핵심)
  "figure_extracted",
  "outline_node",

  // B spec 전용 wrapper — A는 type별 위젯 또는 fallback 카드만
  "enrichment",
]);
export type IngestEventKind = z.infer<typeof IngestEventKind>;

const baseEnvelope = z.object({
  workflowId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  kind: IngestEventKind,
});

export const IngestStartedPayload = z.object({
  mime: z.string(),
  fileName: z.string().nullable(),
  url: z.string().nullable(),
  /** PDF: 페이지 수, audio: 초/분, video: 초/분, web: null. UI 진행률 분모. */
  totalUnits: z.number().int().positive().nullable(),
});

export const IngestStageChangedPayload = z.object({
  /** 거시 단계. activity 단위. UI 상단 단일 라벨. */
  stage: z.enum(["downloading", "parsing", "enhancing", "persisting"]),
  /** 0-100. 모르면 null. */
  pct: z.number().min(0).max(100).nullable(),
});

export const IngestUnitStartedPayload = z.object({
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  /** unit 단위 라벨. PDF: "Page 3/30", audio: "00:30 - 01:00", video: "Chapter 2" */
  label: z.string(),
});

export const IngestUnitParsedPayload = z.object({
  index: z.number().int().nonnegative(),
  /** PDF page / audio segment / video segment / web section */
  unitKind: z.enum(["page", "segment", "section"]),
  /** 본문 길이만 (텍스트 본문 자체는 절대 보내지 않음). */
  charCount: z.number().int().nonnegative(),
  /** unit 자체 처리 시간 (ms). */
  durationMs: z.number().int().nonnegative(),
});

export const IngestFigureExtractedPayload = z.object({
  /** 어떤 unit에서 나왔는지. PDF면 페이지 인덱스. */
  sourceUnit: z.number().int().nonnegative(),
  /** MinIO object key. UI는 별도 GET (presigned 또는 /api/files/:key) */
  objectKey: z.string(),
  /** 그림 종류. heuristic — PDF: extracted image vs vector graphic. */
  figureKind: z.enum(["image", "table", "chart", "equation"]),
  /** 추출된 캡션 (있으면). 본문 텍스트가 아니라 figure 메타데이터 영역. */
  caption: z.string().nullable(),
  /** UI에 미니 썸네일 배치할 때 종횡비 알아야 함. */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const IngestOutlineNodePayload = z.object({
  /** 노드 ID — workflowId scope 내에서만 unique. */
  id: z.string(),
  parentId: z.string().nullable(),
  /** 1=h1, 2=h2, ... heading level. */
  level: z.number().int().min(1).max(6),
  /** heading 텍스트 자체는 OK (본문 아님, 구조 식별자 성격). */
  title: z.string(),
});

export const IngestCompletedPayload = z.object({
  /** create_source_note가 반환한 source note의 ID. UI는 여기로 라우팅. */
  noteId: z.string().uuid(),
  /** 총 처리 시간 (ms) — 사용자에게 "X초 만에 끝났습니다" 표기. */
  totalDurationMs: z.number().int().nonnegative(),
});

export const IngestFailedPayload = z.object({
  /** 사람이 읽을 수 있는 메시지. i18n 키가 아니라 plain text (백엔드 origin). */
  reason: z.string(),
  /** 격리 저장된 원본 파일 키 (가능하면). */
  quarantineKey: z.string().nullable(),
  /** 재시도 가능 여부 — UI에 "다시 시도" 버튼 표시 결정. */
  retryable: z.boolean(),
});

export const IngestEnrichmentPayload = z.object({
  /** B spec이 type 값을 정의 (예: "translation", "section_label", "figure_classification"). */
  type: z.string(),
  /** type별 자유 데이터 — A는 알려진 type만 전용 위젯. */
  data: z.unknown(),
});

/** Discriminated union. 클라이언트는 kind 분기로 타입 좁힘. */
export const IngestEvent = z.discriminatedUnion("kind", [
  baseEnvelope.extend({ kind: z.literal("started"), payload: IngestStartedPayload }),
  baseEnvelope.extend({ kind: z.literal("stage_changed"), payload: IngestStageChangedPayload }),
  baseEnvelope.extend({ kind: z.literal("unit_started"), payload: IngestUnitStartedPayload }),
  baseEnvelope.extend({ kind: z.literal("unit_parsed"), payload: IngestUnitParsedPayload }),
  baseEnvelope.extend({ kind: z.literal("figure_extracted"), payload: IngestFigureExtractedPayload }),
  baseEnvelope.extend({ kind: z.literal("outline_node"), payload: IngestOutlineNodePayload }),
  baseEnvelope.extend({ kind: z.literal("completed"), payload: IngestCompletedPayload }),
  baseEnvelope.extend({ kind: z.literal("failed"), payload: IngestFailedPayload }),
  baseEnvelope.extend({ kind: z.literal("enrichment"), payload: IngestEnrichmentPayload }),
]);
export type IngestEvent = z.infer<typeof IngestEvent>;
```

### 5.2 설계 원칙

1. **본문 텍스트는 절대 이벤트로 흐르지 않음** — privacy + payload 크기. 본문은 완료 후 source note에서만.
2. **figure는 MinIO 참조** — base64 인라인 금지. `objectKey` + 종횡비. 클라이언트는 별도 GET.
3. **모든 mime이 같은 스키마** — `unit`이 추상화 단위. PDF=page, audio/video=segment, web=section, youtube=segment.
4. **B spec의 enrichment는 wrapper로만** — type discriminator는 B spec이 정의. A spec 미수정.
5. **`seq`는 채널 단위 monotonic** — 워크플로우 시작 시 `INCR ingest:seq:{wfid}` 시드. 모든 publisher가 동일 키 INCR로 발급.
6. **`workflowId`는 페이로드에 중복 포함** — SSE 재연결 시 클라이언트가 어떤 wfid의 이벤트인지 검증 가능 (방어 심도).

### 5.3 Mime별 unit 매핑 (MVP)

| Mime | unit 의미 | 풍부한 이벤트? |
|---|---|---|
| `application/pdf` | page | ✅ unit_started, unit_parsed, figure_extracted, outline_node |
| `audio/*`, `video/*` | 60초 segment | 🟡 unit_started, unit_parsed (figure/outline 없음) |
| `image/*` | 단일 image (= 1 unit) | 🟡 started → completed만 (사실상 stage_changed 한 번) |
| `x-opencairn/youtube` | 60초 segment | 🟡 unit_started, unit_parsed |
| `x-opencairn/web-url` | section (heading 단위) | 🟡 unit_started, unit_parsed, outline_node |

비-PDF는 처음에 최소셋만. **본 spec 통과 후 후속 spec에서 mime별 풍부화** (예: video chapter detection).

---

## 6. Activity Refactor

### 6.1 `parse_pdf` 페이지 루프 + figure 추출

위치: `apps/worker/src/worker/activities/pdf_activity.py`

**현재 동작:**
- opendataloader-pdf JAR을 `--extract-images=false`로 실행
- 결과 JSON을 한 번에 받아 page_text 모두 join
- heading/section/figure 정보 모두 버림
- 진행 이벤트 0

**개정 동작:**
1. JAR 호출 시 `--extract-images=true`로 변경 → out_dir에 페이지별 이미지 출력
2. JAR 호출 자체는 단일 subprocess (이걸 페이지 단위 비동기로 쪼개는 건 JAR 수정 필요라 범위 밖). **JAR 결과 JSON을 받은 뒤 페이지별 순차 처리하면서 이벤트 발행**
3. 페이지 루프 안에서:
   - `unit_started { index, total, label: f"Page {i+1}/{total}" }` publish
   - 페이지 텍스트 + 길이 측정
   - 페이지의 sections/headings → `outline_node` 발행 (parentId는 직전 더 높은 level의 마지막 노드)
   - 페이지의 figures → MinIO 업로드 (`uploads/{userId}/figures/{wfid}/p{i}-f{j}.png`) → `figure_extracted` 발행
   - `unit_parsed { index, unitKind: "page", charCount, durationMs }` publish
4. 최종 `text` 반환은 기존과 동일 (workflow의 enhance/persist 로직 변경 없음)

**구현 메모:**
- JAR 호출 결과의 페이지별 JSON 구조를 실측 후 `IngestPageData` 타입 정의 필요 (현재 코드는 `pages: list[dict]`로 untyped)
- figure가 vector graphic인 경우 raster 변환 필요할 수 있음 (PyMuPDF로 보충 가능)
- `figure_kind` 분류는 결정론적 휴리스틱: opendataloader가 "table" 표시한 건 table, 그 외 image. chart/equation 분류는 B spec 영역 (enrichment로 후처리)
- caption은 figure 직후 italic/centered 짧은 텍스트 라인 휴리스틱 (opendataloader가 이미 제공하면 그대로 사용)

**Figure 생명주기 / 소유권:**
- 추출된 figure는 `uploads/{userId}/figures/{wfid}/p{i}-f{j}.png` 키로 MinIO에 저장
- `create_source_note` 호출 시 **payload에 figureKeys 배열 추가** → API가 source note의 metadata에 저장 (또는 별도 테이블; 구현 plan에서 결정)
- 결과: source note 삭제 시 figure도 함께 cleanup 가능 (기존 canvas-outputs orphan purge cron과 동일 패턴 — `apps/worker/src/worker/workflows/code_workflow.py` 주변 참고)
- workflow가 quarantine으로 끝나면 figure는 orphan → 동일 cron이 청소 (별도 plan)

### 6.2 다른 activity의 최소 이벤트 발행

| Activity | publish 추가 |
|---|---|
| `transcribe_audio` | started, stage_changed("parsing"), unit_started/unit_parsed (60s segment), completed |
| `analyze_image` | started, stage_changed("parsing"), completed (단일 unit) |
| `ingest_youtube` | started, stage_changed("downloading"), stage_changed("parsing"), unit_*, completed |
| `scrape_web_url` | started, stage_changed("downloading"), stage_changed("parsing"), unit_* (heading 기준), outline_node, completed |
| `enhance_with_gemini` | stage_changed("enhancing") (시작), 완료 시 별도 이벤트 없음 (parse 결과를 덮어쓰는 거라 소비자는 변화 없음) |
| `create_source_note` | stage_changed("persisting") → 호출 직전, 완료 시 `completed { noteId, totalDurationMs }` |
| `report_ingest_failure` | 호출 직전 `failed { reason, quarantineKey, retryable }` |

### 6.3 공통 emitter 모듈

위치: `apps/worker/src/worker/lib/ingest_events.py` (신규)

```python
"""Ingest event emitter — Redis publisher + atomic seq + ring buffer.

Activities call publish() during processing; the API SSE handler is a separate
process that SUBSCRIBEs (and replays the LIST). The worker never holds open
SSE connections itself.
"""
from __future__ import annotations
import json
import os
import time
from typing import Any
import redis.asyncio as redis

_REDIS_URL = os.environ["REDIS_URL"]   # required, fail-fast if missing
_REPLAY_TTL = int(os.environ.get("INGEST_REPLAY_TTL_SECONDS", "3600"))
_REPLAY_MAX_LEN = int(os.environ.get("INGEST_REPLAY_MAX_LEN", "1000"))

_client: redis.Redis | None = None

def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(_REDIS_URL, decode_responses=True)
    return _client

async def publish(workflow_id: str, kind: str, payload: dict[str, Any]) -> None:
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

def _iso_now() -> str:
    # ISO 8601 UTC, e.g. 2026-04-27T10:23:45.123Z
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"
```

**Best-effort 정책:** publish 실패 시 activity는 에러를 swallow하고 로그만 남긴다 (Temporal heartbeat은 별개로 유지). 이벤트 가시성은 부산물이지 트리거가 아니므로 Redis 다운이 ingest 자체를 막아서는 안 된다.

```python
async def publish_safe(workflow_id: str, kind: str, payload: dict) -> None:
    try:
        await publish(workflow_id, kind, payload)
    except Exception as e:
        activity.logger.warning(f"ingest event publish failed: {kind} {e}")
```

### 6.4 API SSE 핸들러

위치: `apps/api/src/routes/ingest.ts` 확장

```ts
// 추가: GET /api/ingest/stream/:workflowId
// SSE — text/event-stream. Last-Event-ID 헤더로 replay 지원.

import { streamSSE } from "hono/streaming";
import { getRedis } from "../lib/redis";  // 신규 모듈

ingestRoutes.get("/stream/:workflowId", async (c) => {
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

    // 1) Replay backlog from Redis LIST (newest-first via LPUSH, so reverse).
    const backlog = await r.lrange(`ingest:replay:${workflowId}`, 0, -1);
    for (const raw of backlog.reverse()) {
      const ev = JSON.parse(raw);
      if (ev.seq > lastSeq) {
        await stream.writeSSE({ id: String(ev.seq), data: raw });
      }
    }

    // 2) Subscribe live channel.
    await subscriber.subscribe(`ingest:events:${workflowId}`);
    subscriber.on("message", async (_chan, raw) => {
      const ev = JSON.parse(raw);
      await stream.writeSSE({ id: String(ev.seq), data: raw });
      // 3) Auto-close on terminal event.
      if (ev.kind === "completed" || ev.kind === "failed") {
        await subscriber.unsubscribe();
        await subscriber.quit();
        stream.close();
      }
    });

    // 4) Keepalive — SSE는 60s 무송신 시 일부 프록시가 끊음.
    const keepalive = setInterval(() => {
      stream.writeSSE({ event: "keepalive", data: "" }).catch(() => {});
    }, 30_000);
    stream.onAbort(() => {
      clearInterval(keepalive);
      subscriber.unsubscribe().catch(() => {});
      subscriber.quit().catch(() => {});
    });
  });
});
```

**구현 메모:**
- `Last-Event-ID`는 SSE 표준 헤더 — `EventSource`가 자동 재연결 시 자동으로 채움
- replay backlog → live subscribe 사이에 **race window** 존재 (replay 도중 새 이벤트가 채널에 들어옴 → 클라이언트가 같은 seq 두 번 받을 수 있음). 해결: 클라이언트가 `seq <= lastSeenSeq` 이벤트 무시 (idempotent)
- terminal event(`completed`/`failed`) 도달 후 30초 grace 두고 stream 닫음 — 클라이언트가 확실히 받았는지 확인 (선택)

### 6.5 신규 Redis 클라이언트 모듈

위치: `apps/api/src/lib/redis.ts` (신규)

```ts
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required");
    client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }
  return client;
}
```

이 모듈이 추가되는 즉시 rate-limit/visualize-lock도 마이그레이션 가능 (별도 follow-up).

---

## 7. UI States

### 7.1 컴포넌트 구조

위치: `apps/web/src/components/ingest/` (신규)

```
ingest/
├── ingest-spotlight.tsx       — 7s overlay, Framer Motion
├── ingest-tab-view.tsx        — Tab Mode Router에 등록되는 dedicated view
├── ingest-dock.tsx            — bottom-right floating cards stack
├── ingest-progress-view.tsx   — 공통 컨테이너 (spotlight/tab/dock 모두 이걸 다른 사이즈로 렌더)
├── ingest-event-feed.tsx      — 이벤트 타임라인 (dense 모드)
├── ingest-figure-gallery.tsx  — 우측 figure 썸네일 stack
├── ingest-outline-tree.tsx    — 좌측 자라나는 outline 트리
├── ingest-page-pulse.tsx      — 중앙 PDF 미리보기 + "스캔" 라이트 모션
└── use-ingest-stream.ts       — SSE hook, EventSource + zod 검증
```

**핵심 패턴:** `<IngestProgressView>`가 셋 모두에서 재사용. `mode: "spotlight" | "tab" | "dock"` prop으로 레이아웃만 바꿈.

### 7.2 단계별 사용자 경험

#### 단계 1: 업로드 직후 (0~7초) — Spotlight overlay

- 화면 dim + 중앙 큰 카드: 좌측 outline 트리 (빈 상태) / 중앙 PDF 첫 페이지 미리보기 + 스캔 라이트 / 우측 figure 갤러리 (빈 상태)
- 첫 이벤트 도착 시 모션 강조: figure 등장 시 우측에 **scale: 0.5 → 1 + opacity 0 → 1**, outline 노드 등장 시 **slide-in from left**
- 7초 카운트다운 (사용자가 "skip to tab" 누르면 즉시 collapse)
- 7초가 짧다고 느끼면: **첫 페이지 처리가 끝날 때까지** 또는 **첫 figure 등장까지** 둘 중 빠른 쪽으로 자동 collapse (이게 "재미있게 ✅"의 와우 모먼트)

**로직:**
```ts
const collapse =
  timer >= 7000 ||
  events.some(e => e.kind === "unit_parsed" && e.payload.index === 0) ||
  events.some(e => e.kind === "figure_extracted");
```

#### 단계 2: collapse 후 (7s ~ 완료) — Tab + Dock 양쪽

- **Tab Mode `ingest`**: URL `/app/w/{ws}/p/{pid}/ingest/{wfid}` 또는 가상 탭 (notes 탭과 같은 레벨, `Tab.titleKey` = "ingest.tab.title", 탭 라벨에 진행 % 뱃지)
  - 탭 내부는 spotlight 카드와 동일 레이아웃이지만 **dense 모드 토글** 추가 (이벤트 피드 + 메타 통계)
  - 사용자가 다른 탭으로 이동해도 store에 진행 상태 유지
- **Dock**: 모든 진행중 ingest가 우하단 floating stack
  - 카드 사이즈: ~280×80px, 파일명 + 미니 progress bar + 미니 figure thumbnail (있으면)
  - 클릭 시 해당 ingest 탭으로 이동
  - 종료 시 5초 후 fade-out + dock에서 제거

#### 단계 3: 완료 — `completed` 이벤트 도달

- Dock 카드: 초록 체크 + "X초 완료" + "노트로 이동" 버튼 → `noteId`로 라우팅
- Tab: 같은 카드의 큰 버전 + 자동 5초 후 source note tab으로 redirect (사용자가 dismiss하면 redirect 취소)
- Spotlight 사용자가 아직 보고 있다면 (7초 내 완료된 매우 빠른 케이스) 즉시 source note로 가는 "열기" CTA로 변환

#### 단계 4: 실패 — `failed` 이벤트 도달

- Dock 카드: 빨강 + 짧은 reason + (retryable이면) "다시 시도" + "닫기"
- Tab: 같은 카드 + quarantine 키 표시 (디버그용, 일반 사용자에겐 가려짐)
- 자동 dismiss 안 함 — 사용자가 명시적으로 닫아야 함

### 7.3 글로벌 상태 (Zustand store)

위치: `apps/web/src/stores/ingest-store.ts` (신규)

```ts
type IngestRunState = {
  workflowId: string;
  fileName: string | null;
  mime: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  lastSeq: number;
  units: { current: number; total: number | null };
  stage: "downloading" | "parsing" | "enhancing" | "persisting" | null;
  figures: { objectKey: string; thumbnailUrl: string; ... }[];
  outline: OutlineNode[];   // 트리 형태
  error: { reason: string; retryable: boolean } | null;
  noteId: string | null;
  // dense 토글 상태는 UI 컴포넌트 local state, 여기 X
};

type IngestStore = {
  runs: Record<string, IngestRunState>;  // wfid 키
  spotlightWfid: string | null;          // 현재 spotlight 표시중인 wfid (없으면 null)
  // actions
  startRun(wfid, mime, fileName): void;
  applyEvent(wfid, ev: IngestEvent): void;
  dismissDockCard(wfid): void;
  promoteToTab(wfid): void;
};
```

**store가 살아있는 한 새로고침/탭전환 후에도 dock 복원** — `start_run` 시 localStorage에 wfid 저장, mount 시 SSE 재연결 with `Last-Event-ID`.

---

## 8. Reconnect & Replay

### 8.1 클라이언트

- `EventSource` 사용 — 표준 자동 재연결 + `Last-Event-ID` 자동 송신
- 초기 페이지 로드 시: localStorage에서 활성 wfid 목록 복원 → 각각 SSE 연결 with 마지막 본 seq
- 동일 sequence 중복 도착 시 `seq <= lastSeenSeq` 무시 (race window 처리)

### 8.2 서버

- Redis LIST `ingest:replay:{wfid}` — 최신 1000개 이벤트 + TTL 1시간
- TTL 만료 후 재연결 시 backlog는 비어있고 live subscribe만. 이미 종료된 워크플로우는 `GET /api/ingest/status/:wfid`로 fallback (terminal status 응답)
- 정책상 **1시간 후엔 라이브 시각화 사라짐** — completed 워크플로우의 결과 (source note)는 영구 보존, 시각화 자체는 ephemeral

### 8.3 한계 (수용)

- API 인스턴스 재시작 시 활성 SSE 모두 끊김 → 클라이언트 자동 재연결로 해결 (이벤트는 Redis에 살아있음)
- Redis 다운 시 SSE는 backlog 0 + live 0 → 클라이언트는 "연결 중..." 무한, 사용자는 페이지 새로고침으로 fallback (`GET /status` 폴링은 여전히 동작)

---

## 9. Failure & Cancel UX

### 9.1 실패 분류

| Failure | retryable | UX |
|---|---|---|
| Activity timeout (parse_pdf 5분 초과) | ✅ | "다시 시도" 버튼 → 새 workflowId로 재실행 (기존 quarantine 키 재사용) |
| LLM provider error (enhance) | ✅ | 마찬가지 |
| Quarantine 발동 (3회 attempt 모두 실패) | ❌ | "지원되지 않는 파일일 수 있습니다" + quarantine 키 (관리자만) |
| Permission revoked mid-flow | ❌ | "권한이 없습니다" + 노트로 이동 차단 |
| 파일 손상 (PDF parse 실패) | ❌ | "파일을 읽을 수 없습니다" |

### 9.2 취소 (MVP에서는 X)

본 spec은 사용자 취소를 다루지 않음 — Temporal cancellation 자체는 가능하지만:
- 이미 MinIO 업로드 끝났으면 비용 회수 X
- Activity 도중 취소되면 부분 figure만 MinIO에 남는 정리 작업 필요
- "닫기" 버튼은 **dock에서 카드 dismiss**일 뿐 워크플로우 취소 아님 (사용자에게 명확히 표기)

후속 spec ("Interactive Ingest")에서 취소 + 부분 결과 정리 다룸.

---

## 10. Performance & Limits

### 10.1 단위 수치 가이드

| 항목 | 값 | 이유 |
|---|---|---|
| Redis LIST 최대 길이 (per wfid) | 1000 | 100페이지 PDF + figures + outline 다 합쳐 ~500개 예상, 2배 여유 |
| Redis TTL (per wfid) | 1h | 라이브 시각화 ephemeral 정책 |
| Event payload 최대 크기 | 4KB | figure는 objectKey만, outline title은 200자 제한 |
| SSE keepalive 간격 | 30s | 일반적인 reverse proxy idle timeout 60s 회피 |
| Dock 동시 카드 상한 | 12 | UI overflow 방지, 13번째부터는 "+N more" 압축 |
| Spotlight 강제 collapse | 7s 또는 첫 figure/page 완료 | 와우 모먼트 + 비-블로킹 |

### 10.2 Rate limit (사용자별)

기존 `apps/api/src/lib/rate-limit.ts` 활용 (in-memory 상태 그대로). 본 spec에서 추가:
- `POST /api/ingest/upload`: 사용자당 분당 30회 (현재값 검증 후 결정)
- `GET /api/ingest/stream/:wfid`: 동시 SSE 연결 사용자당 20개 (dock 12 + 여유분)

### 10.3 비용 영향

본 spec은 **순수 가시성 레이어** — 추가 LLM 호출 0, 추가 외부 API 호출 0, 추가 storage 증가는 figure 추출분 (이전엔 `--extract-images=false`였으므로 신규 비용). 페이지당 평균 0~2 figure × 100KB = 페이지당 ~200KB 추가 storage. 100페이지 PDF = ~20MB extra.

---

## 11. Cross-spec Boundaries

본 spec은 자매 spec들과의 계약 경계를 명시한다.

### 11.1 vs B (Content-aware Enrichment)

- **B는 본 spec의 `IngestEvent`를 확장하지 않는다** — `kind: "enrichment"` wrapper만 사용
- B는 자기 spec에서 `payload.type` 값들 (예: `"translation"`, `"section_label"`, `"figure_classification"`) + 각 type별 `payload.data` 스키마를 정의
- A spec은 알려진 type만 전용 위젯 (필요 시), 모르는 type은 dense 모드의 raw 카드로 fallback
- B spec이 추가하는 activity (예: 번역 chunked call)는 자체적으로 `publish_safe()`만 호출하면 됨

**합의 필요 항목 (메인 세션 ↔ B 세션):**
- enrichment type 네임스페이스 규칙 (예: `b.translation`, `b.section_label`)
- enrichment 이벤트 발행 시점 (parse 후? enhance와 병행? 별도 stage?)
- enhance_with_gemini가 B에 의해 어떻게 분할되는지

### 11.2 vs E (Literature Search → Auto-Ingest)

- E는 검색 결과 → PDF 다운로드 → **기존 `POST /api/ingest/upload`로 dispatch** (E가 새 진입점을 만들지 않음)
- 한 번에 N개 import 시 N개 workflowId가 생성됨 → 모두 본 spec의 spotlight/dock 흐름에 들어감
- spotlight는 첫 1개만 (또는 N=1일 때만) 띄우고, N≥2일 때는 dock으로 직행
- 사용자 한 액션으로 시작된 N개를 dock에서 그룹화할지: **MVP X** (각각 독립 카드). 그룹화는 후속.

**합의 필요 항목 (메인 세션 ↔ E 세션):**
- E가 dispatch 시 `Spotlight skip` 힌트를 보낼 수 있는지 (예: `?spotlight=false` 쿼리)
- 또는 Web 측에서 N≥2 자동 감지 (지난 200ms 내 다른 startRun이 발생했는지)

### 11.3 vs F (Multi-format Synthesis Export)

무관. F는 출력 끝, 본 spec은 입력 끝.

---

## 12. Test Plan

### 12.1 Unit (worker)

- `ingest_events.publish` — Redis fakeredis로 PUBLISH + LPUSH + LTRIM + EXPIRE 시퀀스 검증
- `ingest_events.publish_safe` — Redis 다운 시 swallow + log 검증
- `parse_pdf` 페이지 루프 — fixture PDF로 page count, figure count, outline node count 검증
- 이벤트 발행 순서 — started < unit_started < unit_parsed < figure_extracted (within page) < completed

### 12.2 Unit (api)

- `getRedis()` — 환경변수 누락 시 throw
- SSE 핸들러 — fakeredis로 backlog replay + live subscribe 통합 테스트
- Permission — 다른 사용자의 wfid 요청 시 403
- `Last-Event-ID` replay — 마지막 seq 이후만 송신

### 12.3 Unit (web)

- `useIngestStream` hook — `mock-eventsource` 라이브러리로 reconnect 동작
- 이벤트 적용 reducer — 동일 seq 중복 시 무시
- localStorage 복원 — 새로고침 후 활성 wfid 자동 재연결

### 12.4 E2E (Playwright)

- 실제 PDF 업로드 → spotlight 등장 → 7초 후 collapse → tab+dock → 완료 → source note 진입
- 다중 파일 (3개) → spotlight 1개 (or 0개) → dock 3개
- 실패 케이스 (손상된 PDF) → 빨강 카드 + reason
- 새로고침 mid-flow → dock 복원

### 12.5 비-fixture 검증

- opendataloader-pdf JAR 결과 JSON 스키마 실측 → `IngestPageData` 타입 정의 (이게 spec 수정 트리거가 될 수 있음 — 페이지별 sections 필드 없으면 outline_node 발행 못 함)

---

## 13. Open Questions

본 spec 통과 후에도 남는 결정. spec 본문에는 default를 박아뒀고, 구현 plan 작성 시 또는 review에서 collapse한다.

1. **Spotlight 자동 collapse 트리거** — 현재: 7s OR 첫 figure OR 첫 페이지 완료. 사용자별 설정 필요한가? (예: "spotlight 끄기" 토글)
2. **Dock 카드 그룹화** — E spec에서 한 번에 10개 import 시 dock이 carousel/grouped로 압축되어야 하나? MVP는 12개까지 stack + 13번째부터 "+N more".
3. **Figure 캐싱** — `figure_extracted` payload에 objectKey만 있고 클라이언트가 별도 GET. 기존 `/api/notes/:id/file` 패턴 따를지, 신규 `/api/ingest/figures/:wfid/:key`를 만들지.
4. **i18n에서 `label` 처리** — `unit_started.label = "Page 3/30"`은 백엔드에서 만든 plain string. ko/en 분기 필요시 백엔드가 i18n 처리할지 (백엔드 i18n 인프라 없음) vs 프론트에서 패턴 매칭으로 재구성할지. **권장: 백엔드는 영문 label, 프론트가 i18n 키로 매핑**.
5. **취소 UX** — MVP X 결정했지만 사용자 피드백에 따라 우선순위 재조정 가능.
6. **모바일** — spotlight 모바일에서 어떻게? 현재 결정: 모바일에서 spotlight 생략, dock만.
7. **활성 ingest 갯수 상한 enforcement** — 사용자가 동시 30개 dispatch하면 backend가 거부하나, queue에 넣나? `ingest_jobs` 테이블에 status 컬럼 추가하면 가능.
8. **opendataloader-pdf의 outline 정확도** — 실측 결과에 따라 outline_node 발행이 의미 없을 수 있음. PyMuPDF의 `doc.get_toc()` fallback 필요할 수 있음.

---

## 14. Migration / Rollout

### 14.1 Phase 1 — Backend foundation (no UI change)

1. `packages/shared/src/ingest-events.ts` — 스키마 정의 + zod
2. `apps/api/src/lib/redis.ts` — ioredis 클라이언트
3. `apps/worker/src/worker/lib/ingest_events.py` — emitter
4. `parse_pdf` page loop refactor + `--extract-images=true`
5. 다른 activity의 최소 이벤트 발행 추가
6. `GET /api/ingest/stream/:wfid` SSE 엔드포인트

이 시점까지 web UI는 그대로 — SSE를 아무도 구독하지 않아도 동작 무해.

### 14.2 Phase 2 — UI

1. `useIngestStream` hook + Zustand store
2. `<IngestProgressView>` + spotlight + dock + tab mode 등록
3. 기존 업로드 완료 토스트는 그대로 유지 (호환성), spotlight가 뜬 경우 토스트 suppress

### 14.3 Phase 3 — Cleanup follow-ups (별도 plan)

- `rate-limit.ts` → Redis 마이그레이션
- `visualize-lock.ts` → Redis SET-NX 마이그레이션
- B/E spec 합의 사항 반영 (enrichment 네임스페이스, dispatch hint 등)

### 14.4 Feature flag

`FEATURE_LIVE_INGEST` env (기본 ON 가능 — 가시성 레이어라 회귀 위험 낮음). UI 측만 토글, backend publish는 항상 동작.

---

## 15. Success Metrics

- **첫 figure 등장까지 평균 시간** — spotlight 효과 측정. 목표: 30페이지 PDF 기준 < 5초.
- **spotlight skip 비율** — 너무 길거나 짜증나는지. 목표: 30% 미만.
- **dock에서 source note로 이동 비율** — 가시성이 행동으로 이어지는지. 목표: 60% 이상.
- **재연결 성공률** — 새로고침/네트워크 끊김 후 SSE 복원. 목표: 95% 이상.
- **이벤트 publish 실패율** — Redis 안정성. 목표: 0.1% 미만.

---

## Appendix A. 영향받는 파일 (구현 plan 작성 시 시작점)

### 신규
- `packages/shared/src/ingest-events.ts`
- `apps/api/src/lib/redis.ts`
- `apps/api/src/routes/ingest.ts` (확장 — `/stream/:wfid` 추가)
- `apps/worker/src/worker/lib/ingest_events.py`
- `apps/web/src/components/ingest/*` (10여 개 컴포넌트)
- `apps/web/src/hooks/use-ingest-stream.ts`
- `apps/web/src/stores/ingest-store.ts`
- `apps/web/messages/ko/ingest.json` + `en/ingest.json`

### 수정
- `apps/worker/src/worker/activities/pdf_activity.py` — page loop + figure ON
- `apps/worker/src/worker/activities/enhance_activity.py` — stage_changed 발행
- `apps/worker/src/worker/activities/note_activity.py` — completed 발행
- `apps/worker/src/worker/activities/quarantine_activity.py` — failed 발행
- `apps/worker/src/worker/activities/{stt,image,web,youtube}_activity.py` — 최소 이벤트
- `apps/worker/Dockerfile` — opendataloader JAR이 figure 추출 + ImageMagick/cairo 의존성 추가될 수 있음 (실측 후 결정)
- Tab Mode Router — `ingest` mode 등록
- `docker-compose.yml` — Redis 환경변수 wiring (REDIS_URL 추가)
- `.env.example` — REDIS_URL, INGEST_REPLAY_TTL_SECONDS, INGEST_REPLAY_MAX_LEN 추가

### 영향 없음
- 기존 `IngestWorkflow.run()` 시그니처 — 입력/출력 동일
- 기존 `/api/ingest/upload`, `/api/ingest/url`, `/api/ingest/status/:wfid` 응답 형식
- 기존 `notes` 테이블 / Plate 에디터 / source note 모델
