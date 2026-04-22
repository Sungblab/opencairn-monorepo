# Plan 2B: Hocuspocus Collaboration — Design

> **Status**: Approved spec (2026-04-22). Implementation plan to follow via `superpowers:writing-plans`.
> **Scope**: 실시간 공동편집(Task 8·9) + 블록 앵커 코멘트(Task 10) + @mention 입력·파싱(Task 11).
> **Canon reference**: [`docs/architecture/collaboration-model.md`](../../architecture/collaboration-model.md). 본 spec은 캐논을 중복 정의하지 않고 **구현 경계**만 정의한다.

---

## 1. Scope

### 1.1 In-scope

1. **Hocuspocus 서버 앱** (`apps/hocuspocus` 신규) — Yjs WebSocket 허브. Better Auth 세션 검증 + `resolveRole` 기반 권한 hook. PostgreSQL persistence.
2. **Plate ↔ Yjs 클라이언트 통합** — `NoteEditor.tsx`의 editing surface가 Yjs Awareness + 공유 Y.Doc 기반으로 전환. Presence 아바타 스택 + 원격 커서 렌더.
3. **Block-anchor 코멘트** — `comments` + `comment_mentions` 테이블, `/api/comments` CRUD, Plate `CommentsPlugin`(블록 hover 버튼/뱃지), 우측 사이드 `CommentsPanel` + 스레드 UI, block 삭제 시 anchor 강등.
4. **@mention 파서 & Resolver** — Plate combobox plugin (trigger `@`), 4 타입(`user` · `page` · `concept` · `date`) 검색 API, void element 저장 포맷, 서버측 mention 추출 → `comment_mentions` insert.
5. **권한 공유 패턴** — `apps/api/src/lib/permissions.ts` 를 `apps/hocuspocus`에서 재사용 (single source of truth).
6. **Docker 인프라** — `docker-compose.yml`에 hocuspocus 서비스 (기본 프로필, depends_on postgres).

### 1.2 Non-goals (2B에서 하지 않음)

| 범위 | 이동 대상 |
|---|---|
| Notification dispatch / SSE / 이메일 (Task 12~14) | **Plan 2C** |
| Activity feed 확장 (Task 15) | **Plan 2C** |
| Public share link (Task 16) | **Plan 2C** |
| Guest invite UX (Task 17) | **Plan 2C** |
| 노트 **본문** 내 mention 알림 트리거 | **Plan 2C** — 2B는 comment 내 mention만 `comment_mentions` insert까지 수행 |
| 채팅 렌더러, 확장 블록, 탭 쉘 | **Plan 2D / 2E** |
| Workspace admin 설정 UI | **Plan 2C** (`collaboration-model.md` 경계) |

### 1.3 Dependencies

- ✅ Plan 1 (`resolveRole` / `canRead` / `canWrite` + workspace·page permissions)
- ✅ Plan 2A (Plate v49 에디터, `/notes/:id` 서버 셸, `notes.content` JSON, `content_text` FTS)
- ✅ Plan 9a (i18n 규율 — 모든 user-facing 문자열은 `messages/{locale}/collab.json` 키)
- ✅ Plan 12 (Agent Runtime — 참조만, 에이전트 권한 상속은 이미 정의됨)

---

## 2. Architectural Decision: **Yjs Canonical**

세 가지 후보 중 Approach A 채택:

| 옵션 | 설명 | 결론 |
|---|---|---|
| **A. Yjs canonical** | Y.Doc state = truth. `notes.content` + `content_text`는 Hocuspocus `onStoreDocument` 훅에서 **파생 스냅샷**으로 기록. 검색·에이전트 read-path 유지. | ✅ 채택 |
| B. Dual-write | Plate `onValueChange` → `PATCH /notes/:id` 유지 + 병행 Yjs provider. | ❌ race 조건·충돌 불가피. 2A 로직 재사용 유혹은 있으나 CRDT 속성 파괴. |
| C. DB canonical + ephemeral Yjs | Yjs는 세션 동안만 사용, 주기적으로 DB flush 후 폐기. | ❌ 오프라인 재연결·늦은 편집 병합 이점 상실. 캐논 §1.5("CRDT는 최상위 기술") 위배. |

### 2.1 Derived-write contract

- **Writer**: Hocuspocus 서버 `onStoreDocument` hook (`@hocuspocus/extension-database`의 저장 콜백).
- **When**: 30s idle-debounce + 연결 종료 시 즉시 flush.
- **What**: Y.Doc → Plate JSON → `notes.content`. 서버측에서 `plate-text`(기존 `apps/api/src/lib/plate-text.ts` 재사용)로 `content_text` derive. 같은 트랜잭션에서 UPDATE.
- **Failure mode**: 저장 실패해도 Y.Doc은 메모리·`yjs_documents` 테이블에서 살아있으므로 다음 idle·재연결에서 재시도. Plate JSON 변환 실패 시 Sentry/로거에 기록하고 `content_text`만 실패 허용(기존 값 유지).

### 2.2 Plan 2A migration

- `use-save-note.ts` + `PATCH /api/notes/:id` (content 변경 경로)는 **삭제**. 메타(제목·icon·위치) PATCH는 유지.
- `NoteEditor.tsx`는 Plate value를 로컬 state가 아닌 Y.XmlText 기반 shared type으로 바꾼다.
- 기존 노트는 Y.Doc이 없으므로 첫 연결 시 `persistence.fetch`가 `notes.content` → Y.XmlText 주입 후 `notes.yjs_state_loaded_at` 세팅. 이미 `loaded_at IS NOT NULL`이면 DB content 무시하고 Y.Doc만 신뢰.
- E2E(`editor-core.spec.ts`) 갱신: "PATCH 호출 확인" 단계는 "Y.Doc update가 WS로 나가는지" 확인으로 교체.

---

## 3. Component Architecture

### 3.1 `apps/hocuspocus/` (신규)

```
apps/hocuspocus/
  package.json
  tsconfig.json
  Dockerfile
  src/
    server.ts              — Hocuspocus 인스턴스 + extension 등록 + port 리스닝
    auth.ts                — onAuthenticate: Better Auth 세션 → resolveRole → { userId, readOnly }
    persistence.ts         — fetch(documentName) & store(documentName, state) 구현
    permissions-adapter.ts — apps/api의 resolveRole을 Node 런타임에서 호출(공유 모듈 import)
    plate-bridge.ts        — Y.XmlFragment ↔ Plate JSON 양방향 변환
    config.ts              — env parsing (PORT, DATABASE_URL, BETTER_AUTH_SECRET, HOCUSPOCUS_ORIGINS)
    readonly-guard.ts      — onChange hook: readOnly 연결은 update drop + 로그
    logger.ts
  tests/
    auth.test.ts
    persistence.test.ts
    readonly-guard.test.ts
```

- **Runtime**: Node 22, TypeScript, tsx in dev / compiled in Docker.
- **Libs**: `@hocuspocus/server`, `@hocuspocus/extension-database`, `yjs`, `y-protocols`, `better-auth` (server API).
- **권한 공유 방식**:
  - `@opencairn/api/lib/permissions`의 `resolveRole` · `canRead` · `canWrite`를 직접 import (모노레포 workspace 의존). 해당 모듈이 `apps/api` 내부에 갇혀 있으면 `apps/api/src/public.ts` 를 만들어 함수들만 re-export.
  - `permissions-adapter.ts`는 thin wrapper — hocuspocus 자체 DB 풀(`@opencairn/db`의 `createDb` 재사용, 별 커넥션 풀)을 주입해 `resolveRole` 호출. 로직 재구현 금지.
  - **DB 연결은 `@opencairn/db`를 hocuspocus가 직접 열고, Better Auth verifier도 자체 인스턴스 생성** (HTTP cross-call 금지 — 레이턴시·단일 장애점 방지).

### 3.2 `apps/api/src/routes/`

- **`comments.ts` (신규)**
  - `GET /api/notes/:noteId/comments` — canRead, 스레드별 트리 구조 반환
  - `POST /api/notes/:noteId/comments` — canWrite 또는 commenter, body(markdown) + `anchor_block_id?` + `parent_id?`
  - `PATCH /api/comments/:id` — author_id만
  - `DELETE /api/comments/:id` — author OR canWrite(page)
  - `POST /api/comments/:id/resolve` — canWrite(page), toggle
  - 저장 시 `parseMentions(body)` → `comment_mentions` upsert (2C의 dispatcher가 소비)
- **`mentions.ts` (신규)**
  - `GET /api/mentions/search?type=user|page|concept&q=&workspaceId=&projectId=` — 타입별 핸들러
    - `user` → workspace members 이름/이메일 prefix match
    - `page` → notes title ILIKE + `canRead` 필터
    - `concept` → 프로젝트 KG 벡터 검색 (Plan 4 hybrid-search 재사용)
    - `date` → 서버는 관여하지 않음, 클라이언트에서 `chrono-node`로 파싱 (라우트 불필요)
- **`notes.ts` (수정)**
  - 기존 PATCH에서 `content` 필드 제거(메타만 업데이트). `content_text` derive 로직은 Hocuspocus persistence가 담당하도록 이동.

### 3.3 `apps/web/src/`

```
components/editor/
  NoteEditor.tsx               — HocuspocusProvider + withYjs, readOnly 플래그 반영
  PresenceStack.tsx            — Awareness에서 사용자 리스트 추출 → 아바타 스택
  RemoteCursors.tsx            — Plate decorate hook으로 원격 selection 오버레이
  plugins/
    comments.tsx               — block hover 버튼 + 뱃지 + `mark` decoration
    mention.tsx                — @ trigger combobox (Plan 2A wiki-link 패턴 재사용)
  elements/
    comment-anchor.tsx         — block-level 뱃지 컴포넌트
    mention-chip.tsx           — void inline element
components/comments/
  CommentsPanel.tsx            — 우측 사이드 panel, 스레드 리스트
  CommentThread.tsx            — 댓글 + 답글 + resolve 버튼
  CommentComposer.tsx          — Plate combobox 재사용, markdown 입력
hooks/
  useCollaborativeEditor.ts    — Provider lifecycle + Awareness user 정보 세팅
  useComments.ts               — TanStack Query로 comments 리스트/invalidation
  useMentionSearch.ts          — debounced query per type
messages/ko/collab.json        — Presence/Comments/Mention strings
messages/en/collab.json
```

- **Color assignment**: Awareness user color는 userId → HSL 고정 해시 (사용자 간 안정적).
- **Cursor**: Plate `decorate` API + 원격 selection range를 `data-remote-cursor` span으로 표시. selection idle 2s 후 페이드.
- **Comments decoration**: 블록에 연결된 comment 개수를 블록 element의 `data-comments-count` 속성으로 주입 → CSS로 뱃지 렌더. 별도 React state 추적 없음.

### 3.4 `packages/db/src/schema/`

- **`comments.ts`** — 캐논 §2.3 스키마 그대로. Drizzle table + indexes:
  - `idx_comments_note_id` (note_id, created_at DESC)
  - `idx_comments_parent_id` (parent_id) WHERE parent_id IS NOT NULL
  - `idx_comments_anchor` (note_id, anchor_block_id) WHERE anchor_block_id IS NOT NULL
- **`comment_mentions`** — PK (comment_id, mentioned_type, mentioned_id) + `idx_comment_mentions_target` (mentioned_type, mentioned_id).
- **`yjs_documents`** (신규 — Hocuspocus persistence 전용)
  - `name text PRIMARY KEY` (예: `page:<noteId>`)
  - `state bytea NOT NULL`
  - `state_vector bytea NOT NULL`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
- **`notes` migration**
  - `ADD COLUMN yjs_state_loaded_at timestamptz NULLABLE` — 최초 Y.Doc 주입 후 기록. 재주입 방지 가드.

### 3.5 `packages/shared/src/`

- **`comment-types.ts`** — Zod schemas: `commentBodySchema`, `createCommentSchema`, `updateCommentSchema`, `commentResponseSchema`, `mentionSearchQuerySchema`.

---

## 4. Data Flows

### 4.1 Editing session

```
Web                          Hocuspocus                     Postgres
 │                                 │                             │
 │─ WS connect (cookie token)─────>│                             │
 │                                 │─ verifySession(token)──────>│
 │                                 │─ resolveRole(user, note)───>│
 │                                 │<── role in {owner,admin,editor,commenter,viewer}
 │<─ {readOnly: bool}──────────────│
 │                                 │─ fetch("page:<id>")────────>│  yjs_documents
 │                                 │   (없으면 notes.content)    │
 │                                 │<──────────── state ─────────│
 │<─ Y.Doc initial sync────────────│                             │
 │                                 │                             │
 │─ Y update ────────────────────>│─ broadcast to peers          │
 │                                 │   (readOnly면 drop + log)   │
 │                                 │                             │
 │─ Awareness (cursor/user)──────>│─ broadcast                  │
 │                                 │                             │
 │        (30s idle)              │                             │
 │                                 │─ store("page:<id>")────────>│  UPDATE yjs_documents
 │                                 │   → plate-bridge → JSON────>│  UPDATE notes.content
 │                                 │   → derive content_text────>│
```

### 4.2 Adding a block-anchor comment

1. 사용자가 블록 hover → "💬" 버튼 클릭
2. `CommentsPanel`이 해당 `anchor_block_id`로 스레드 열고 `CommentComposer` 포커스
3. Composer에서 `@` → mention combobox → 선택 시 `@[user:id]` 직렬 삽입
4. Submit → `POST /api/notes/:noteId/comments` — 서버: canRead 체크 + body validation + `parseMentions(body)` → `comments` + `comment_mentions` 한 트랜잭션으로 insert
5. 응답 수신 → `useComments(noteId)` invalidate → `CommentsPanel` 리렌더 + 블록 뱃지 +1
6. 다른 접속자에게: 30s 폴링(또는 Hocuspocus custom message — **stretch**)으로 invalidate

### 4.3 Block deletion with comments

1. 편집자가 블록 삭제 → Y.XmlFragment에서 해당 block id 사라짐
2. Hocuspocus 서버 `onChange` 훅에서 삭제된 block id 수집 (diff observer)
3. `UPDATE comments SET anchor_block_id = NULL WHERE note_id = $1 AND anchor_block_id = ANY($2)`
4. 다음 polling cycle에 UI가 "페이지 코멘트 (원본 블록 삭제됨)"로 표시

---

## 5. Permission Enforcement Matrix

| 액션 | Gate | 구현 위치 |
|---|---|---|
| WS 연결 (Yjs doc) | `resolveRole !== 'none'` | `apps/hocuspocus/src/auth.ts` |
| 편집(Y update send) | `!readOnly` | 클라(UI disable) + 서버 onChange drop |
| 코멘트 조회 | `canRead(note)` | `comments.ts` GET |
| 코멘트 작성 | `role >= commenter` | `comments.ts` POST, `resolveRole` 결과 체크 |
| 코멘트 수정 | `author_id === userId` | `comments.ts` PATCH |
| 코멘트 삭제 | `author_id === userId ∥ canWrite(note)` | `comments.ts` DELETE |
| 코멘트 resolve | `canWrite(note) ∥ author` | `comments.ts` resolve |
| Mention search: `user` | workspace member | `mentions.ts` + `workspace_members` 조인 |
| Mention search: `page` | `canRead` batch | `mentions.ts` + 권한 필터 |
| Mention search: `concept` | 프로젝트 canRead | `mentions.ts` + 프로젝트 스코프 |

에이전트 권한은 캐논 §3.5 그대로 — 2B는 **인간 사용자 경로만** 다룸. 에이전트가 코멘트 쓰는 경로는 2C 이후.

---

## 6. Error Handling

| 실패 | 동작 |
|---|---|
| WS 연결 타임아웃 | 지수 백오프 재시도 (1s, 3s, 9s, 27s). 60s 넘으면 read-only 배너 + "재시도" 버튼 |
| `resolveRole === 'none'` | 서버가 auth throw → 클라이언트는 "권한 없음" 페이지로 리다이렉트 |
| Y.Doc persistence store 실패 | 30s 뒤 다음 idle에서 재시도. Sentry 경고. 클라이언트에는 영향 없음 |
| Plate ↔ Y.XmlFragment 변환 실패 (store 시점) | 로그 + 해당 store cycle 스킵 (`notes.content` · `content_text` 업데이트 건너뜀). Y.Doc은 그대로 유지되고 다음 idle cycle에 재시도. 편집 중인 클라이언트에는 영향 없음 |
| 코멘트 저장 실패 | Composer에 에러 메시지, 입력 보존, 재시도 버튼 |
| 블록 삭제 감지 실패 | 다음 store cycle에서 reconcile — 일시적으로 orphan anchor (뱃지만 표시) |
| viewer가 편집 시도 | 클라이언트가 Plate `readOnly=true` 설정 이전에 입력이 새면 서버 onChange에서 drop + 경고 로그 (defense in depth) |
| 네트워크 단절 중 로컬 편집 | Yjs가 자체 큐잉. 재연결 시 자동 merge |

---

## 7. Testing Strategy

### 7.1 Unit / Integration

- **`apps/hocuspocus/tests/auth.test.ts`** (vitest) — owner/admin/editor/commenter/viewer/none 각 경로의 `onAuthenticate` 반환값 검증. Better Auth mock + `resolveRole` spy.
- **`apps/hocuspocus/tests/persistence.test.ts`** — `notes.content`에서 초기화 → Y.Doc 편집 → store → `notes.content` 업데이트 라운드트립. `yjs_state_loaded_at` 보호 시나리오.
- **`apps/hocuspocus/tests/readonly-guard.test.ts`** — readOnly 연결이 update를 보냈을 때 drop + broadcast 차단 검증.
- **`apps/api/tests/comments.test.ts`** — CRUD 각 엔드포인트 × 권한 레벨 매트릭스. Block-anchor 강등. 트랜잭션 롤백.
- **`apps/api/tests/mentions.test.ts`** — 타입별 검색 결과 + 권한 필터 + workspace 격리.

### 7.2 E2E (Playwright)

- **`apps/web/tests/e2e/collab.spec.ts`**
  - 2 브라우저 컨텍스트로 같은 페이지 연결 → 편집 sync (한쪽에서 입력 → 다른쪽 DOM 반영 < 1s)
  - Viewer 컨텍스트에서 Plate disabled + 편집 시도 무시
  - Presence: 아바타 스택에 상대 사용자 표시, 커서 위치 오버레이 확인
  - 블록 hover → "💬" → 코멘트 작성 → 다른 브라우저에서 뱃지 +1
  - `@`로 user 검색 → 선택 → `comment_mentions` row 생성 (DB 쿼리로 검증)
  - 블록 삭제 시 코멘트 anchor 강등 확인

### 7.3 Performance budgets (soft)

- Y update propagation P95 < 500ms (같은 LAN)
- Presence aware update < 200ms
- 코멘트 CRUD P95 < 300ms
- 대용량 노트 (10,000 블록) 초기 Y.Doc fetch < 2s

---

## 8. Infrastructure & Environment

### 8.1 `docker-compose.yml` 추가

```yaml
  hocuspocus:
    build:
      context: .
      dockerfile: apps/hocuspocus/Dockerfile
    ports:
      - "1234:1234"
    environment:
      - DATABASE_URL=${DATABASE_URL:-postgres://opencairn:changeme@postgres:5432/opencairn}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET in .env}
      - HOCUSPOCUS_ORIGINS=${HOCUSPOCUS_ORIGINS:-http://localhost:3000}
      - HOCUSPOCUS_PORT=1234
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
```

기본 프로필(worker처럼 `profiles` 지정 없음) — 웹 접속 시 필수 서비스.

### 8.2 환경 변수 (신규)

- `HOCUSPOCUS_URL` — 웹 클라이언트용 (dev: `ws://localhost:1234`)
- `HOCUSPOCUS_ORIGINS` — 허용 오리진 CSV (서버측 CORS/Origin 체크)
- `BETTER_AUTH_SECRET` — 이미 존재, hocuspocus에도 주입

### 8.3 마이그레이션

- `packages/db/src/migrations/0010_yjs_and_comments.sql` (next available)
  - `yjs_documents` 테이블
  - `comments` + `comment_mentions` 테이블 + 인덱스
  - `notes.yjs_state_loaded_at` 컬럼

---

## 9. i18n

`apps/web/messages/{ko,en}/collab.json` 신규. 필요한 키 (영어는 런칭 전 배치 번역):

- `presence.viewing_count` — "{count}명이 보고 있습니다"
- `presence.you` — "나"
- `comments.panel_title` — "코멘트"
- `comments.add_button` — "코멘트 추가"
- `comments.composer_placeholder` — "코멘트를 입력하세요..."
- `comments.reply` · `comments.resolve` · `comments.resolved` · `comments.unresolved`
- `comments.delete_confirm` — "이 코멘트를 삭제하시겠어요?"
- `comments.orphan_block` — "원본 블록이 삭제되었습니다"
- `mention.combobox_hint.user/page/concept/date`
- `collab.readonly_banner` — "읽기 전용 모드입니다"
- `collab.disconnected_banner` — "연결이 끊겼습니다. 재시도 중..."
- `collab.restore_connection` — "다시 연결"

ESLint `i18next/no-literal-string` 위반 없이 통과해야 함. `pnpm --filter @opencairn/web i18n:parity`도 통과.

---

## 10. Risks & Open Decisions

| 항목 | 상태 | 처리 |
|---|---|---|
| Plate Yjs 통합 정확한 패키지명 (`@platejs/yjs` 존재 여부) | **구현 plan에서 확인** (context7 + node_modules 검증) | 없으면 `@slate-yjs/core` + Plate adapter 직접 작성 |
| Y.Doc 손상·malformed state 복구 정책 | 스냅샷(`notes.content`) 폴백 구현 후 plan 확정 | §6 에 방향만 명시 |
| 코멘트 업데이트 실시간 전파 | 폴링 30s를 기본으로, Hocuspocus custom message로 invalidate broadcast는 **stretch goal** | 2B MVP는 폴링, 2C에서 SSE 통합 고려 |
| 대용량 노트 초기 fetch 스트리밍 | 기본은 전체 state blob. 분할 스트리밍은 필요성 대두 시 별도 plan | — |

---

## 11. Out of Scope (명시)

- 알림 dispatcher / SSE / 이메일 → Plan 2C
- Activity feed verbs 확장 (`commented`, `comment_resolved` 등) → Plan 2C (`activity_events` 테이블 재구조화와 함께)
- Public share link, Guest invite UX → Plan 2C
- 노트 본문 내 `@mention` 알림 파이프 → Plan 2C (2B는 파서·삽입·저장만)
- Mermaid / SVG / Callout 등 블록 렌더러 → Plan 2D
- Chat renderer, Chat→Editor 변환 → Plan 2D
- Multi-mode tab shell, Split Pane, Diff View → Plan 2E

---

## 12. Success Criteria

- [ ] 2 브라우저로 같은 노트를 동시에 편집해도 충돌 없이 CRDT merge, 재연결 시 누락 없음
- [ ] Viewer 권한 사용자는 편집 불가(UI + 서버 이중 보장), Read-only 배너 표시
- [ ] 블록에 코멘트 → 다른 사용자에게 뱃지 & 패널 반영 (30s 내)
- [ ] `@` 입력 → combobox가 user/page/concept/date 4종 결과 표시, 선택 시 `mention-chip` 삽입
- [ ] 코멘트 저장 시 `comment_mentions` row 생성 (2C dispatcher가 바로 소비 가능)
- [ ] 블록 삭제 시 anchor_block_id NULL로 강등, "원본 블록 삭제됨" 표시
- [ ] Hocuspocus 컨테이너 무상태 재시작 OK (state는 Postgres에만)
- [ ] i18n parity + ESLint literal-string CI 통과
- [ ] 모든 테스트 (hocuspocus unit + api integration + Playwright e2e) 그린

---

## 13. Changelog

- 2026-04-22: 최초 작성. Plan 2B 범위 = Task 8+9+10+11 (Hocuspocus + Presence + Comments + @mention). Approach A (Yjs canonical) 확정. 알림·share·guest는 2C로 분리.
