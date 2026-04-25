# Plan 7 · Canvas Phase 1 — Web Runtime + Tab Mode Router 통합

**Date:** 2026-04-25
**Status:** Draft (브레인스토밍 합의 완료, 구현 plan 작성 대기)
**Replaces / refines:** `docs/superpowers/plans/2026-04-09-plan-7-canvas-sandbox.md` (Tasks A·B·E의 일부 — 다음 세션은 Phase 2 (Code Agent + API + 템플릿))
**Related:**
- [ADR-006 — Browser Sandbox (Pyodide + iframe) over Server gVisor](../../architecture/adr/006-pyodide-iframe-sandbox.md)
- [App Shell Redesign Design](2026-04-23-app-shell-redesign-design.md) §탭 시스템 / §모드 라우터
- [Browser Sandbox Testing](../../testing/sandbox-testing.md)

---

## 1. Goal & Scope

ADR-006 기준 Pyodide(WASM Python) + iframe sandbox(JS/HTML/React) 코드 실행 인프라를 web 측에 구현하고, App Shell Tab Mode Router 의 신규 `canvas` 모드로 통합한다. 서버는 코드를 한 줄도 실행하지 않는다.

### 1.1 In-scope

1. `PyodideRunner` — Python WASM 실행, stdin pre-injection, 10s timeout, stdout/stderr 수집
2. `CanvasFrame` — `<iframe sandbox="allow-scripts">` Blob URL + esm.sh import map, postMessage origin 검증
3. `CanvasViewer` — Tab Mode Router 신규 모드 어댑터, plain `<textarea>` 에디터 + Run 버튼 + 결과 패널
4. DB: `sourceTypeEnum` 에 `'canvas'` 추가, 신규 `canvasLanguageEnum` (`python`/`javascript`/`html`/`react`) + `notes.canvasLanguage` 컬럼 + CHECK 제약
5. API: `POST /api/notes` 확장 + 신규 `PATCH /api/notes/:id/canvas`
6. 사이드바 "+ 새 캔버스" 진입점 (project context menu)
7. `messages/{ko,en}/canvas.json` (parity)
8. CSP: esm.sh + cdn.jsdelivr.net/pyodide whitelist
9. Vitest 단위/컴포넌트 + API 테스트 + Playwright E2E (Pyodide 실행, sandbox 격리, allow-same-origin 회귀 가드)
10. Standalone `/canvas/demo` playground (Tab Mode Router 우회, 디버깅·E2E 용)

### 1.2 Out-of-scope (Phase 2+)

- Code Agent (`apps/worker/src/agents/code/`) — Agent Runtime v2 정렬 별도 세션
- `POST /api/code/run` / `/api/code/feedback` Hono 라우트
- `POST /api/canvas/from-template` (Plan 6 템플릿 연동)
- Monaco Editor (Phase 1 은 plain `<textarea>`)
- matplotlib output → MinIO 저장 (Phase 1 은 메모리 내 stdout/stderr 만)
- inline canvas Plate block (Plan 10B 영역)
- 셀프힐링 retry (Code Agent 의존)
- Tab Mode Router E2E (Phase 3-B 관례대로 deferred)

---

## 2. Architecture Overview

```
                        ┌─────────────────────────────────────┐
                        │  Tab Mode Router (Phase 3-B)        │
                        │   tab.mode = 'canvas'?              │
                        │   → <CanvasViewer noteId=tab.noteId>│
                        └──────────────┬──────────────────────┘
                                       │
                       ┌───────────────┴───────────────┐
                       │                               │
                  language=python                language ∈ {react, html, javascript}
                       │                               │
                       ▼                               ▼
              ┌─────────────────┐              ┌──────────────────┐
              │ PyodideRunner   │              │ CanvasFrame      │
              │ (WASM, in-tab)  │              │ <iframe sandbox> │
              │ stdin/out 수집  │              │ Blob URL + esm.sh│
              └────────┬────────┘              └────────┬─────────┘
                       │                                │
               (lazy load CDN                  (sandbox="allow-scripts" only,
                pyodide@0.27 fixed)             postMessage origin === "null")
                       │                                │
                       └─────────────┬──────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  notes 테이블        │
                          │  sourceType='canvas' │
                          │  canvasLanguage=...  │
                          │  contentText=<src>   │
                          └──────────────────────┘
```

### 2.1 컴포넌트 경계

1. **`apps/web/src/components/canvas/`** — pure presentational + 런타임. note/API 모름.
2. **`apps/web/src/components/tab-shell/canvas-viewer.tsx`** — note 인지 어댑터. Tab → API → 컴포넌트 props.
3. **`apps/web/src/app/[locale]/canvas/demo/page.tsx`** — 영속화 없는 playground.
4. **`packages/db/`** — schema 확장만. 비즈 로직 없음.
5. **`apps/api/src/routes/notes.ts`** — 라우트 확장 + 신규 `/canvas` 서브 라우트. Zod validation.

서버는 코드 한 줄도 실행 안 함 (ADR-006 핵심).

### 2.2 불변식

- `canvasLanguage IS NOT NULL` ↔ `sourceType = 'canvas'` (DB CHECK constraint)
- `iframe.sandbox` 속성은 `"allow-scripts"` only — `allow-same-origin` 추가 시 grep CI 가드 + Playwright assertion 으로 회귀 차단
- Pyodide CDN URL 은 floating 태그 금지, `PYODIDE_VERSION` 상수 고정
- Blob URL 은 컴포넌트 언마운트 시 `URL.revokeObjectURL` 강제
- `MAX_SOURCE_BYTES = 64 * 1024` (UI + Zod + DB 삼중 가드)
- `EXECUTION_TIMEOUT_MS = 10_000` (Pyodide `Promise.race` 로 abort)

---

## 3. DB Schema & Migration

### 3.1 `packages/db/src/schema/enums.ts`

```ts
export const sourceTypeEnum = pgEnum("source_type", [
  "manual", "pdf", "audio", "video", "image",
  "youtube", "web", "notion", "unknown",
  "canvas",  // ← 신규: 사용자가 작성한 실행 가능한 코드 (Plan 7 Phase 1)
]);

// 신규
export const canvasLanguageEnum = pgEnum("canvas_language", [
  "python",
  "javascript",
  "html",
  "react",
]);
```

### 3.2 `packages/db/src/schema/notes.ts`

```ts
import { noteTypeEnum, sourceTypeEnum, canvasLanguageEnum } from "./enums";

export const notes = pgTable("notes", {
  // ... 기존 컬럼 ...
  sourceType: sourceTypeEnum("source_type"),
  canvasLanguage: canvasLanguageEnum("canvas_language"),  // 신규
  // ...
});
```

### 3.3 Migration

PostgreSQL 의 `ALTER TYPE ... ADD VALUE` 는 트랜잭션 내에서 새 enum 값을 즉시 사용 못 한다. Drizzle 은 migration 파일 1개 = 1 트랜잭션이므로 **두 개 파일로 분리**해야 한다.

**파일 1: `0020_canvas_source_type_value.sql`** (enum 값만 추가)

```sql
ALTER TYPE "source_type" ADD VALUE 'canvas';
```

**파일 2: `0021_canvas_language_column.sql`** (신규 enum + 컬럼 + CHECK — 0020 commit 이후에만 'canvas' 값 사용 가능)

```sql
CREATE TYPE "canvas_language" AS ENUM ('python', 'javascript', 'html', 'react');

ALTER TABLE "notes" ADD COLUMN "canvas_language" "canvas_language";

ALTER TABLE "notes" ADD CONSTRAINT "notes_canvas_language_check"
  CHECK (
    (source_type = 'canvas' AND canvas_language IS NOT NULL)
    OR (source_type IS NULL OR source_type <> 'canvas')
  );
```

**메모:**
- Session A 가 0020/0021 먼저 차지하면 본 세션은 0022/0023 으로 rename. 충돌 패턴 단순 (파일명만).
- `pnpm db:generate` 자동 생성 후 CHECK constraint + 두 파일 분리는 수동 (Drizzle 자동 생성 안 함).
- 두 migration 모두 적용되어야 spec 5.7 의 사이드바 "+ 새 캔버스" 가 작동 (sourceType='canvas' INSERT 가 CHECK 에 걸리지 않으려면 canvasLanguage 컬럼 존재 필요).
- 기존 row 영향 0 (canvas_language nullable).

### 3.4 Rollback

```sql
ALTER TABLE "notes" DROP CONSTRAINT "notes_canvas_language_check";
ALTER TABLE "notes" DROP COLUMN "canvas_language";
DROP TYPE "canvas_language";
-- sourceTypeEnum 의 'canvas' 값 제거는 PostgreSQL 직접 지원 안 함.
-- 운영 정책: enum 값은 한 번 추가하면 미사용 처리만 가능.
```

---

## 4. API Contract

`/api/notes/*` 는 사용자 세션 기반 public API. workspace 권한은 `notes.projectId → projects.workspaceId` 체인 + 권한 헬퍼로 강제 (`feedback_internal_api_workspace_scope` 비대상).

### 4.1 POST `/api/notes` — 확장

기존 본문에 canvas 필드 옵셔널 추가.

```ts
// packages/shared/src/notes.ts (또는 등가)
const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  type: z.enum(['note', 'wiki', 'source']).default('note'),

  // 신규
  sourceType: sourceTypeSchema.optional(),       // 'canvas' 포함
  canvasLanguage: canvasLanguageSchema.optional(),
  contentText: z.string().max(64 * 1024).optional(),
}).refine(
  d => d.sourceType !== 'canvas' || d.canvasLanguage !== undefined,
  { message: 'canvasLanguage required when sourceType=canvas', path: ['canvasLanguage'] }
);
```

**테스트:**
- `sourceType='canvas'` + language 누락 → 400 (Zod refine)
- `sourceType='canvas'` + language='python' → 201, response 에 canvasLanguage 포함
- `sourceType` 없음 → 기존 동작 (note 기본값)

### 4.2 GET `/api/notes/:id` — 응답 형태 확장

기존 응답에 `canvasLanguage` 필드 추가. sourceType≠'canvas' 인 노트는 `null`.

### 4.3 PATCH `/api/notes/:id/canvas` — 신규

Plate(Yjs canonical) 노트의 일반 PATCH 경로(content는 strip)와 분리한 캔버스 전용 쓰기 표면.

```ts
const patchCanvasSchema = z.object({
  source: z.string().max(64 * 1024),
  language: canvasLanguageSchema.optional(),
});
```

**Handler 의무:**
1. `requireUserSession` (인증)
2. note 존재 + `sourceType='canvas'` 확인 → 아니면 409 `notCanvas`
3. `canWrite` 권한 체크 (page-level 권한 헬퍼 재사용)
4. `notes.contentText = body.source`, `notes.canvasLanguage = body.language ?? 기존값`
5. `notes.updatedAt = now()` (Drizzle `$onUpdate`)
6. Hocuspocus 우회 — Yjs document 갱신 안 함 (canvas 는 단일 사용자 모델)

**Response:** 200 `{ id, contentText, canvasLanguage, updatedAt }`.

**Edge:**
- 동시 편집 last-write-wins. 협업 필요 시 Phase 2+ Hocuspocus 어댑터 검토.
- 64KB 초과 → 413 `payload-too-large` (Hono bodyLimit + Zod max 이중 가드).

### 4.4 일반 PATCH `/api/notes/:id` — 변경 없음

기존대로 `content`/`folderId` strip 동작 유지. canvasLanguage 도 일반 PATCH 에서는 strip — canvas 전용 endpoint 강제.

### 4.5 i18n 에러 메시지

API 에러는 코드만 (`{error: 'notCanvas'}`), 사용자 노출 문구는 web 측 `canvas.json` lookup.

### 4.6 Phase 2 추가 예정 (Phase 1 아웃)

- `POST /api/code/run` — Code Agent → Temporal CodeAgentWorkflow start
- `POST /api/code/feedback` — 클라이언트 실행 결과 → workflow signal
- `POST /api/canvas/from-template` — Plan 6 템플릿 → 코드 생성

---

## 5. Web 컴포넌트, Tab Mode Router 통합, CSP

### 5.1 파일 구조

```
apps/web/src/
├── lib/
│   └── pyodide-loader.ts                     # lazy load + cache, PYODIDE_VERSION 고정
├── components/
│   ├── canvas/                                # 도메인 런타임 (note 모름)
│   │   ├── PyodideRunner.tsx
│   │   ├── CanvasFrame.tsx
│   │   ├── sandbox-html-template.ts
│   │   ├── useCanvasMessages.ts
│   │   └── __tests__/
│   │       ├── sandbox-html-template.test.ts
│   │       ├── useCanvasMessages.test.tsx
│   │       └── CanvasFrame.test.tsx
│   └── tab-shell/
│       └── canvas-viewer.tsx                  # Tab → note 로드 + textarea + Run
├── app/[locale]/canvas/demo/
│   └── page.tsx                               # standalone playground (DB 우회)
└── tests/e2e/
    └── canvas.spec.ts                         # Playwright (Pyodide + sandbox 격리)
```

### 5.2 PyodideRunner

Plan 7 v2026-04-14 의 코드를 채택하되 다음 변경:

- 하드코딩 문자열 → `useTranslations('canvas.runner')` 키 lookup
- `PYODIDE_VERSION = "0.27.0"` 상수 고정 (floating 금지)
- `EXECUTION_TIMEOUT_MS = 10_000` `Promise.race`
- status: `loading` / `ready` / `running` / `done` / `error`
- matplotlib 캡처는 Phase 1 미지원 — stdout/stderr 만

### 5.3 CanvasFrame + sandbox-html-template + useCanvasMessages

- `MAX_SOURCE_BYTES = 64 * 1024` UI 거부 (Zod + DB 와 이중 가드)
- `sandbox="allow-scripts"` only — `allow-same-origin` 절대 추가 금지
- Blob URL `URL.createObjectURL` + 언마운트 시 `URL.revokeObjectURL`
- `useCanvasMessages`: `event.origin === "null"` + `event.source === iframe.contentWindow` 이중 검증
- esm.sh 버전 고정: `react@19`, `react-dom@19/client`
- 에러 문구는 `canvas.frame.*` i18n 키

### 5.4 CanvasViewer (Tab Mode Router 어댑터)

```
┌────────────────────────────────────────────────────────────┐
│ language: ▼ python    [Run]   status: ● dirty / ✓ saved   │
├────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐ ┌──────────────────────────────┐  │
│ │ <textarea>           │ │ <PyodideRunner /> 또는       │  │
│ │ source 입력          │ │ <CanvasFrame />              │  │
│ │                      │ │                              │  │
│ │                      │ │ stdout / stderr / iframe     │  │
│ └──────────────────────┘ └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

- 탭 진입 시 `GET /api/notes/:id` → `note.contentText` (소스) + `note.canvasLanguage` 로드
- `<textarea>` 편집기 (Phase 1 plain; Monaco 는 Phase 2+)
- "Run" 버튼:
  - `language === 'python'` → `<PyodideRunner key={runId} source={src} />` 마운트 (key 변경 = 재실행)
  - `language ∈ {react, html, javascript}` → `<CanvasFrame source={src} language={lang} />`
- 디바운스 저장 (1.5s) → `PATCH /api/notes/:id/canvas` (`{ source, language? }`)
- 저장 상태 표시: `dirty` (●) / `saving…` / `saved` / `error`

### 5.5 Tab Mode Router 통합

`apps/web/src/components/tab-shell/tab-mode-router.tsx`:

```diff
  case "data":
    return <DataViewer noteId={tab.noteId!} />;
+ case "canvas":
+   return <CanvasViewer noteId={tab.noteId!} />;
  default:
    return <StubViewer mode={tab.mode} />;
```

`isRoutedByTabModeRouter` predicate 에 `'canvas'` 추가. `Tab.titleKey` 폴백은 `canvas.tab.title`.

**Auto-detect:** Phase 3-B 의 `pdf` → `source` 모드 자동 매핑 헬퍼를 확장. 노트 열 때 `note.sourceType === 'canvas'` 면 `tab.mode = 'canvas'` 자동 설정.

### 5.6 Standalone `/canvas/demo` Playground

영속화/탭 시스템 우회한 디버깅·E2E 페이지. URL 쿼리로 lang (`?lang=python` 등).

- 라우트: `apps/web/src/app/[locale]/canvas/demo/page.tsx` ((shell) 라우트 그룹 밖)
- **인증**: Better Auth 미들웨어 통과만 요구 (워크스페이스 컨텍스트 불요). 비로그인 → `/{locale}/login?next=/canvas/demo` 리다이렉트
- DB 안 건드림. 소스는 페이지 로컬 state + sessionStorage (선택)
- E2E 가 이 페이지로 접근 (Phase 3-B 의 `/test-seed` 와 동등한 보조 표면)
- 보안 영향 0 — 사용자 자기 코드, 자기 브라우저, 다른 워크스페이스/노트 접근 불가

### 5.7 사이드바 "+ 새 캔버스" 진입점

- ProjectTree context menu (우클릭) → "새 캔버스" 항목
- 호출 → `POST /api/notes` `{ title: t('canvas.tab.untitled'), projectId, sourceType: 'canvas', canvasLanguage: 'python', contentText: '' }`
- 생성된 note 로 새 탭 (`mode='canvas'`)
- **변경 범위 최소화**: ShellSidebar ProjectTree context menu 코드에 한 줄 추가

### 5.8 CSP 헤더

`apps/web/next.config.ts` (또는 `middleware.ts`):

```ts
const CSP_HEADER = [
  "default-src 'self'",
  "frame-src 'self' blob:",
  "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net/pyodide/ https://esm.sh",
  "worker-src 'self' blob:",
  "connect-src 'self' https://esm.sh https://cdn.jsdelivr.net/pyodide/",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
].join('; ');
```

**메모:**
- `'unsafe-eval'` 은 Pyodide WASM 컴파일에 필요 (ADR-006 인정)
- iframe 자체는 origin `null` (Blob URL) → `frame-src 'self' blob:` 충분
- 기존 CSP 와 머지 — `next.config.ts` 변경은 `headers` 배열 추가 한 줄
- 위반 시 브라우저 콘솔 + Playwright 로그 가드

---

## 6. i18n, Testing, Regression Guards

### 6.1 i18n (`messages/{ko,en}/canvas.json`)

신규 파일, ko/en parity. Plan 9a 의 `pnpm --filter @opencairn/web i18n:parity` CI 가 자동 검증.

```json
// messages/ko/canvas.json (스케치)
{
  "tab": {
    "title": "캔버스",
    "untitled": "이름 없는 캔버스"
  },
  "viewer": {
    "languageLabel": "언어",
    "run": "실행",
    "reset": "되돌리기",
    "save": {
      "saved": "저장됨",
      "saving": "저장 중…",
      "dirty": "변경됨",
      "error": "저장 실패"
    },
    "languages": {
      "python": "Python",
      "javascript": "JavaScript",
      "html": "HTML",
      "react": "React"
    }
  },
  "runner": {
    "status": {
      "loading": "Pyodide 로드 중…",
      "ready": "준비됨",
      "running": "실행 중…",
      "done": "완료",
      "error": "오류"
    },
    "stdout": "표준 출력",
    "stderr": "오류 출력"
  },
  "frame": {
    "loading": "샌드박스 로드 중…",
    "error": "샌드박스 오류"
  },
  "errors": {
    "sourceTooLarge": "소스가 64KB 를 초과했습니다.",
    "executionTimeout": "실행이 10초 시간 제한을 초과했습니다.",
    "notCanvas": "캔버스 노트가 아닙니다."
  },
  "demo": {
    "title": "캔버스 데모",
    "sourcePlaceholder": "여기에 코드를 입력하세요…",
    "languagePython": "Python (Pyodide)",
    "languageReact": "React (esm.sh)",
    "languageHtml": "HTML",
    "languageJavascript": "JavaScript"
  },
  "sidebar": {
    "newCanvas": "새 캔버스"
  }
}
```

en 파일: 동일 키, 영어 1차 값. 런칭 전 배치 번역에서 보완.

### 6.2 Vitest 단위/컴포넌트 테스트

`apps/web/src/components/canvas/__tests__/`:

| 파일 | 검증 |
|---|---|
| `sandbox-html-template.test.ts` | HTML 패스스루, React 모드 import map (`react@19`, `react-dom@19/client`), JS 모드 `<script type="module">` 래핑 |
| `useCanvasMessages.test.tsx` | origin `'null'` 만 통과, `'https://evil.com'` 무시, `event.source !== iframe` 무시 |
| `CanvasFrame.test.tsx` | source > 64KB → 에러 UI, 언마운트 시 `URL.revokeObjectURL` 호출, `sandbox` 속성 = `"allow-scripts"` (정확히) |
| `pyodide-loader.test.ts` | 두 번 호출 시 동일 Promise (캐시), CDN URL 에 `PYODIDE_VERSION` 고정 |

PyodideRunner 자체는 jsdom 에서 WASM 동작 안 함 → `pyodide-loader` mock 후 status 전환만 검증.

### 6.3 API 테스트 (Vitest, apps/api)

| 파일 | 검증 |
|---|---|
| `routes/notes.canvas.test.ts` | POST `/api/notes` `sourceType='canvas'` + language 누락 → 400, language='python' → 201, GET 응답에 canvasLanguage 포함 |
| `routes/notes.canvas-patch.test.ts` | PATCH `/api/notes/:id/canvas` 권한 거부 (canRead only) → 403, sourceType≠canvas → 409 `notCanvas`, 정상 → 200, source > 64KB → 413 |
| `db/canvas-constraint.test.ts` | DB CHECK: `sourceType='canvas'` + `canvasLanguage=NULL` INSERT 거부 |

### 6.4 Playwright E2E (`apps/web/tests/e2e/canvas.spec.ts`)

ADR-006 보안 경계 검증이 핵심. 모든 E2E 는 `/canvas/demo` 페이지 사용.

- Pyodide python 실행 + stdout 스트리밍 (`for i in range(3): print(i)` → `0\n1\n2`)
- `EXECUTION_TIMEOUT_MS` 10초 초과 시 timedOut 상태 (`while True: pass`)
- iframe `sandbox` 속성 = `"allow-scripts"` only (정확히 일치, allow-same-origin 추가 시 실패)
- iframe 에서 `window.parent.document.cookie` 접근 → DOMException (postMessage `BLOCKED` 수신)
- Pyodide CDN URL 은 고정 버전 (`/v\d+\.\d+\.\d+/` 정규식)
- 64KB 초과 소스 → UI 에러 표시, iframe 마운트 안 됨

Tab Mode Router 통합 E2E 는 Phase 3-B 관례대로 deferred. follow-up 으로 등록.

### 6.5 회귀 CI 가드

`.github/workflows/ci.yml` (또는 `package.json` `lint:` 스크립트) 신규 step:

```bash
# allow-same-origin 추가 회귀 차단
! grep -R "allow-same-origin" apps/web/src/components/canvas/ apps/web/src/app/

# postMessage "*" 와일드카드 회귀 차단 (canvas 영역만)
! grep -RE 'postMessage\([^,]*,\s*"\*"' apps/web/src/components/canvas/

# Pyodide floating tag 회귀 차단
! grep -RE "pyodide/(latest|v@latest)" apps/web/src/
```

### 6.6 ko/en parity

PR 머지 전 `pnpm --filter @opencairn/web i18n:parity` 실행. canvas.json 의 모든 키가 ko + en 양쪽 존재해야 통과.

---

## 7. 충돌 회피 (다른 세션과 병렬)

병렬 진행 중인 두 세션과의 파일 충돌 분석:

| 영역 | 본 세션 변경 | Session A (Phase 4 agent panel) | Session B (Deep Research D) | 완화 |
|---|---|---|---|---|
| `enums.ts` | sourceType 확장 + canvasLanguage | chat 관련 enum 추가 가능 | 없음 | 동일 파일·다른 섹션 → rebase 시 손쉬운 머지 |
| migration 번호 | 0020 + 0021 (PG enum 트랜잭션 제약) | 0020 (chat 테이블) 가능성 | 없음 | **이른 PR 머지 우선 차지, 늦은 쪽이 다음 번호로 rename (0022/0023)** |
| `next.config.ts` | CSP 헤더 추가 | 가능성 낮음 | 가능성 낮음 | 동일 파일 머지 conflict 시 수동 |
| `tab-mode-router.tsx` | `canvas` case 추가 | 없음 (right panel) | 없음 | 안전 |
| i18n | `canvas.json` 신규 | `agent-panel.json` 신규 | `research.json` 신규 | 다른 파일 → 안전 |
| 사이드바 | "+ 새 캔버스" | 없음 | 없음 | 안전 |
| `/api/notes` | POST/PATCH 확장 + 신규 sub-route | 없음 | 없음 | 안전 |

**격리 방법:** git worktree (`opencairn-canvas-phase-1` 등 별도 디렉토리) 에서 작업 → main 변화에 자동 따라가지 않으므로 PR 시점에 rebase.

---

## 8. Open Questions / Decisions

이 spec 은 다음을 **확정**한다:

1. ✅ Path B-light (Tab Mode Router 정식 통합 + DB 영속화)
2. ✅ canvasLanguage 는 별도 enum 컬럼 (mimeType 재사용 안 함, 타입 안전)
3. ✅ Phase 1 은 Code Agent / API `/api/code/run` 미포함
4. ✅ Phase 1 plain `<textarea>` 에디터 (Monaco follow-up)
5. ✅ matplotlib output 메모리 표시만 (MinIO 저장 follow-up)
6. ✅ 협업 미지원 (last-write-wins, Hocuspocus 우회)

다음 세션 (Phase 2) 에서 다룰 질문:

- Code Agent 가 Agent Runtime v2 `runtime.Agent` 패턴 채택? (yes 추천)
- Workflow 패턴: Plan 4 / Deep Research 와 동일 (Temporal workflow + activities)
- Code Agent 가 BYOK / Managed 라우팅 (`docs/architecture/billing-routing.md`) 따르는지

---

## 9. Verification

PR 머지 전 다음이 모두 통과해야 한다.

- [ ] `pnpm --filter @opencairn/db migrate` 적용 → 기존 row 영향 0
- [ ] `pnpm --filter @opencairn/db test` (CHECK constraint 단위 테스트 포함) 통과
- [ ] `pnpm --filter @opencairn/api test` 통과 (canvas 신규 + 기존 회귀 없음)
- [ ] `pnpm --filter @opencairn/web test` 통과 (Vitest 신규 + 기존 회귀 없음)
- [ ] `pnpm --filter @opencairn/web i18n:parity` 통과 (canvas.json ko/en parity)
- [ ] `pnpm --filter @opencairn/web playwright test canvas.spec.ts` 통과 (Pyodide + sandbox 격리 보안 검증)
- [ ] CI grep 가드 (allow-same-origin / postMessage `*` / pyodide latest) 0 hit
- [ ] `pnpm --filter @opencairn/web build` 통과 (CSP 헤더 + Next.js 빌드)
- [ ] 수동: `/canvas/demo?lang=python` 에서 `print('hello')` 실행 → "hello" 출력
- [ ] 수동: ProjectTree 우클릭 → "새 캔버스" → 새 탭 열림 + canvas viewer 마운트

---

## 10. Phase 2 인계 (다음 세션)

- Code Agent (`apps/worker/src/agents/code/`) — Agent Runtime v2 `runtime.Agent` + tool-loop
- Temporal `CodeAgentWorkflow` + activities (generate / analyze_feedback)
- `POST /api/code/run` + `POST /api/code/feedback` Hono 라우트
- `POST /api/canvas/from-template` (Plan 6 의존)
- Monaco Editor 또는 CodeMirror 6 통합
- matplotlib PNG → MinIO 저장
- Tab Mode Router E2E 확장 (canvas 모드 포함)

---

## 11. 변경 이력

- 2026-04-25: 최초 작성. Plan 7 v2026-04-14 의 web 측 Tasks A·B·E를 ADR-006 + App Shell + Yjs canonical + Agent Runtime v2 + i18n parity 컨텍스트에 맞춰 Phase 1 으로 재정의.
