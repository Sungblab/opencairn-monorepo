# Plan 2A: Editor Core — Design Spec

**Date:** 2026-04-21
**Status:** Draft → User review pending
**Supersedes (for scope 1~7):** `docs/superpowers/plans/2026-04-09-plan-2-editor.md` Task 1~7
**Parent:** Plan 2 (editor + collab). 2A는 **에디터 코어만**. 협업(2B), 알림(2C), chat 렌더러(2D), tab shell(2E)은 후속.

---

## 1. Why this spec exists

2026-04-09 작성된 Plan 2 문서는 2,951줄 / 21+ 태스크를 단일 plan으로 묶어두고 있다. 사이 기간에 다음이 바뀌었다:

- **Plan 9a 완료 (2026-04-20)**: i18n (`next-intl`, ko/en, ESLint `no-literal-string` + parity CI), 테마 4팔레트(default = warm editorial stone+ember), 라우트 prefix `[locale]`.
- **ADR-007 (2026-04-21)**: 임베딩 768d MRL. `notes.embedding` 벡터 차원 변경.
- **Plan 1 / 3 / 4 완료**: workspace/project/page 3계층 권한 (`canRead`/`canWrite`/`resolveRole`), `/api/notes` GET, 인제스트 파이프라인.

Plan 2 문서 Task 1~7을 그대로 실행하면 i18n 키화, 테마 토큰, 라우트 prefix 전부 불일치. 본 스펙은 Task 1~7 **의도**만 뽑아 현재 상태에 맞춰 재설계한다.

---

## 2. Scope

### In

| 영역 | 내용 |
|---|---|
| Plate 에디터 | Plate v49 + 기본 블록(p/h1~3/ul/ol/quote/code/hr) + inline marks(bold/italic/strikethrough/inline code) |
| LaTeX | `@platejs/math` + KaTeX. inline `$...$` + block `$$...$$` (렌더 전용, 편집은 textarea) |
| Wiki-link | `[[` trigger → combobox → 선택 시 `wiki-link` inline node 삽입. hover preview. |
| Slash command | `/` trigger → 9개 기본(h1/h2/h3/bullet/num/quote/code/divider/math) |
| 저장/로드 | `PATCH /api/notes/:id` + debounced save + optimistic update |
| 사이드바 | project 범위 폴더 tree (browse) + note list + "새 노트" 버튼 |
| 라우트 | `/[locale]/(app)/w/[wsSlug]/p/[projectId]/notes/[noteId]/`. `/app` 진입 시 server redirect. |
| i18n | 모든 user-facing 문자열을 `messages/{ko,en}/editor.json` + `sidebar.json` 에 키화 |
| 테마 | Plan 9a `stone + ember` 토큰 재사용. shadcn 설치하되 Tailwind 토큰을 기존 CSS 변수에 매핑. |
| 테스트 | API integration (Vitest) + Playwright E2E happy path |

### Out (후속 플랜 소관)

- Yjs / Hocuspocus / presence / cursor sharing → **2B**
- 코멘트 / @mention / 알림 / 공개 링크 / guest 초대 → **2B/2C**
- Chat 렌더러 + Mermaid / SVG / Toggle / Table / Column → **2D**
- Multi-mode tab shell / split pane / diff view / command palette → **2E**
- 폴더 CRUD UI (생성/이름 변경/삭제/드래그 이동) → 2A 후 follow-up
- 이미지/파일 업로드 → Plan 3에 이미 있음. 2A는 에디터에 이미지 블록만 렌더 안 함.
- 드래그로 블록 재정렬 → 후속
- 마크다운 import/export → 후속
- 에디터 협업 cursor/presence → 2B

### 명시적으로 배제하는 것

- **Server Actions 사용 금지.** 모든 mutation은 Hono API 경유 (CLAUDE.md 규약).
- **DB 직접 접근 금지** (apps/web 에서). 권한 헬퍼는 apps/api 안에서만.
- **shadcn `new-york` 기본 컬러 사용 금지.** Plan 9a 토큰에 매핑.

---

## 3. Architecture

```
Browser
 └ Next.js 16 (apps/web)
    [locale]/(app)/
      ├ page.tsx            ─── server redirect → first workspace+project
      └ w/[wsSlug]/
         └ p/[projectId]/
            ├ layout.tsx    ─── sidebar + main flex shell
            └ notes/[noteId]/
               └ page.tsx   ─── server shell, canRead check, render <NoteEditor/>

HTTP
 └ Hono (apps/api)
    ├ routes/notes.ts       ─── GET list / GET :id / PATCH :id (신규) / POST (신규) / GET search (신규)
    ├ routes/folders.ts     ─── GET ?projectId= (사이드바 tree)
    └ lib/permissions.ts    ─── canRead/canWrite (Plan 1)

DB
 └ Postgres (packages/db)
    └ notes (Plan 1 스키마, 변경 없음)
       - content jsonb        ← Plate Value
       - content_text text    ← 서버가 derive
       - content_tsv tsvector ← GENERATED (확인 필요)
       - embedding vector(768) ← Plan 3 인제스트가 관리, 2A는 건드리지 않음
```

**단방향 의존**: web → api (HTTP) → db (drizzle). web이 db를 직접 import 하지 않는다.

**데이터 흐름 (edit → save)**:

```
Plate onChange(value)
  → <NoteEditor>: setState(value); debounce(500ms) 시작
    → useSaveNote.mutate({ id, content: value })
      → PATCH /api/notes/:id
        → apps/api: canWrite(session, "page", id)
          → drizzle: update notes set content=$1, content_text=$2, updated_at=now()
          → return { updatedAt }
      → TanStack Query: optimistic → confirmed → savedAt 상태 업데이트
```

**데이터 흐름 (wiki-link 삽입)**:

```
사용자 `[[Atten` 입력
  → wiki-link-plugin: matchesTrigger → combobox open, q="Atten"
    → useNoteSearch("Atten", projectId)
      → GET /api/notes/search?q=Atten&projectId=<proj>
        → apps/api: canRead per row → drizzle: ilike title + limit 10
        → return [{ id, title, updatedAt }]
      → 사용자 선택
        → Plate: insertNode({ type: "wiki-link", targetId, title })
```

---

## 4. Component boundaries

각 단위는 (무엇을 / 어떻게 쓰는지 / 뭐에 의존하는지) 답 가능해야 한다. 파일당 300줄 이하 목표.

### 4.1 apps/web 컴포넌트

| 파일 | 책임 | 입력 | 출력 | 의존 |
|---|---|---|---|---|
| `components/editor/NoteEditor.tsx` | Plate 인스턴스 + 플러그인 엮음 + toolbar 포함. 저장 상태 표시 (Saved / Saving / Error). | `{ noteId, initialValue, readOnly? }` | `<ReactElement>` | `useSaveNote`, plugins/* |
| `components/editor/editor-toolbar.tsx` | Plate selection mark/block 조작 버튼. i18n aria-label. | `{ editor }` (Plate) | `<ReactElement>` | shadcn Button, Tooltip |
| `components/editor/plugins/latex.tsx` | `@platejs/math` plugin factory + 엘리먼트 컴포넌트 (inline/block). KaTeX render. | — | Plate `Plugin[]` | `@platejs/math`, `katex` |
| `components/editor/plugins/wiki-link.tsx` | `[[` trigger + combobox + insert. | `{ projectId }` | Plate `Plugin` | `useNoteSearch`, shadcn Command |
| `components/editor/plugins/slash.tsx` | `/` trigger + 9개 명령어 combobox. | — | Plate `Plugin` | shadcn Command |
| `components/editor/elements/wiki-link-element.tsx` | `wiki-link` inline node 렌더. hover → tooltip(제목/업데이트 시각). | Plate element props | `<ReactElement>` | shadcn Tooltip, `next/link` |
| `components/editor/elements/math-inline-element.tsx` | inline math 렌더 (클릭 시 raw tex 편집) | Plate element props | `<ReactElement>` | KaTeX |
| `components/editor/elements/math-block-element.tsx` | block math 렌더 + raw tex textarea | Plate element props | `<ReactElement>` | KaTeX |
| `components/sidebar/Sidebar.tsx` | 프로젝트 내 트리 shell (workspace/project 헤더 + FolderTree + NoteList + 새 노트 버튼) | `{ workspaceSlug, projectId }` | `<ReactElement>` | `useProjectTree` |
| `components/sidebar/FolderTree.tsx` | 재귀 collapsible. browse only. | `{ folders, activeNoteId }` | `<ReactElement>` | 없음 |
| `components/sidebar/NoteList.tsx` | 폴더 내 노트 링크 + 활성 강조. | `{ notes, activeNoteId }` | `<ReactElement>` | `next/link` |
| `lib/editor-utils.ts` | `plateValueToText`, `emptyEditorValue`, `parseEditorContent`. pure. | — | — | 없음 |
| `hooks/use-note.ts` | `GET /api/notes/:id` cache. TanStack Query. | `noteId` | `{ data, isLoading, error }` | TanStack Query, api-client |
| `hooks/use-save-note.ts` | debounced PATCH + dirty/saving/saved 상태. | `noteId` | `mutate(value)` + 상태 | TanStack Query, lodash.debounce |
| `hooks/use-note-search.ts` | `GET /api/notes/search` combobox용. | `(q, projectId)` | `{ data }` | TanStack Query |
| `hooks/use-project-tree.ts` | 사이드바용 folder+note tree 쿼리. | `projectId` | `{ tree }` | TanStack Query |
| `lib/api-client.ts` | 타입드 fetch wrapper (이미 있으면 확장). zod response 파싱. | — | — | `@opencairn/shared` (zod) |

### 4.2 apps/api 라우트

| 파일 | 엔드포인트 | 책임 |
|---|---|---|
| `routes/notes.ts` (확장) | `PATCH /api/notes/:id` | canWrite → content/content_text/title 업데이트. zod validate. |
|  | `POST /api/notes` | canWrite(project) → 새 노트 생성. `{ projectId, folderId?, title? }` body. |
|  | `GET /api/notes?projectId=` | canRead → 프로젝트 노트 list (사이드바용) |
|  | `GET /api/notes/:id` | canRead → 단건 (이미 있음) |
| `routes/notes.ts` (확장) | `GET /api/notes/search?q=&projectId=` | wiki-link 전용. title ilike, limit 10. 별도 파일 분리하지 않고 같은 라우터 안에 둠 (너무 얇음). |
| `routes/folders.ts` | `GET /api/folders?projectId=` | 사이드바 tree용. 이미 있으면 shape만 확인. |

**zod 스키마**는 `@opencairn/shared/schemas/notes.ts` 에 기존 것 확장. 특히 `content` = `z.array(z.unknown())` 로 느슨하게 (Plate Value 엄밀 스키마는 런타임 cost 큼).

---

## 5. Data model touches

`notes` 테이블 변경 없음. 다만 확인:

- `content_tsv` 가 **GENERATED COLUMN** 이라면 자동. 아니면 `PATCH /api/notes/:id` 핸들러에서 `to_tsvector('simple', content_text)` 로 직접 업데이트.
- `content` 컬럼은 `jsonb`. Plate Value는 `Array<PlateNode>` 인데 현재 schema는 `$type<Record<string, unknown>>()`. 타입 좁히기: `$type<PlateValue>()` 로 변경 (packages/db에서 Plate 타입 직접 import 피하고, 자체 타입 alias 정의).

### 마이그레이션

- 없음. 스키마 변경 없음.
- 단, `content` 컬럼의 기존 값이 `null` 인 경우 → 핸들러가 `emptyEditorValue()` 로 fallback. DB 업데이트 없이 클라이언트만.

---

## 6. Error handling

| 상황 | 처리 |
|---|---|
| PATCH 저장 5xx | exponential backoff(500ms, 1.5s, 3s) 3회. 최종 실패 시 toast "저장 실패. 로컬에만 있어요." + dirty 유지. 탭 닫기 시 `beforeunload` 경고. |
| PATCH 403 | toast "편집 권한이 없어요." + 에디터 readOnly 전환. URL 유지. |
| PATCH 404 | 노트 삭제됨. toast "노트가 삭제됐어요." + 2초 후 프로젝트 홈으로 이동. |
| GET :id 403 | Next.js `notFound()` (존재 누설 방지). |
| GET :id 404 | Next.js `notFound()`. |
| wiki-link target 삭제 | 렌더 시 회색 취소선 + tooltip "삭제된 노트". 클릭은 막음 (span). |
| wiki-link 검색 네트워크 실패 | combobox 안 빈 상태 + "검색 실패, 다시 시도해주세요" 문구 (키). |
| KaTeX 파싱 실패 | 블록은 빨간 테두리 + 에러 메시지. 인라인은 raw `$...$` 그대로 렌더. 편집은 가능. |
| offline | TanStack Query `onlineManager` 감지 → 사이드바 상단 작은 "오프라인" 배지. 저장 mutation은 큐잉 (`retry` 옵션). |

권한 실수는 **서버가 유일한 진실**. 클라이언트 readOnly 플래그는 UX 힌트일 뿐이다.

---

## 7. Test strategy

### 7.1 API integration (Vitest, Plan 1 패턴)

`apps/api/tests/routes/notes.test.ts` 에 추가:

1. `PATCH /api/notes/:id` — editor 권한으로 content 업데이트 → `updatedAt` 갱신, `content_text` 동기화.
2. viewer 권한 → 403.
3. 다른 workspace 유저 → 404 (존재 누설 방지).
4. 삭제된 노트 (`deletedAt != null`) → 404.
5. `POST /api/notes` — editor 권한으로 project에 새 노트 생성.
6. `GET /api/notes/search?q=&projectId=` — ilike 매치, limit 10, viewer 이상만 접근.

### 7.2 Playwright E2E

`apps/web/tests/e2e/note-editor.spec.ts`:

1. **seed**: test user 1명 + workspace 1개 + project 1개 + 기존 노트 1개 ("Welcome").
2. 로그인 → `/ko/app` 접근 → `/ko/app/w/<ws-slug>/p/<proj-id>` 로 redirect 확인.
3. 사이드바 "새 노트" → 새 노트 URL 변경 + 에디터 포커스 확인.
4. 제목 필드 "Test Note" 입력 → 본문 "Hello world" 입력 → 1.5s 대기 → "저장됨" indicator → page reload → 내용 유지 확인.
5. 본문에 `[[Wel` 입력 → combobox 열림 → "Welcome" 아이템 → Enter → wiki-link node 확인 (span with data-target-id).
6. 새 줄에 `/` 입력 → "제목 1" 선택 → h1 블록 전환 확인.
7. 본문에 `$x^2$` 입력 → KaTeX 렌더 확인 (`.katex` 셀렉터).
8. 본문에 `$$\int_0^1 x dx$$` 블록 → 렌더 확인.

### 7.3 i18n parity

`pnpm --filter @opencairn/web i18n:parity` 통과 강제 (기존 CI).

### 7.4 비테스트

- Plate 내부 unit test 안 씀 (모킹 비용 > 가치).
- Hocuspocus 테스트 없음 (2B 범위).
- 시각 회귀 없음 (Lighthouse는 배포 단계에서).

---

## 8. UX 디테일 (copy/style)

### 8.1 i18n 키 구조

```
messages/ko/editor.json
  placeholder.title       "제목 없음"
  placeholder.body        "무엇이든 적어보세요…"
  save.saving             "저장 중…"
  save.saved              "저장됨"
  save.failed             "저장 실패"
  save.failed_detail      "변경 사항이 로컬에만 있어요. 새로고침하면 사라질 수 있습니다."
  wikilink.search_empty   "찾는 노트가 없어요."
  wikilink.deleted        "삭제된 노트"
  slash.heading_1         "제목 1"
  slash.heading_2         "제목 2"
  slash.heading_3         "제목 3"
  slash.bulleted_list     "글머리 기호 목록"
  slash.numbered_list     "번호 매기기 목록"
  slash.quote             "인용구"
  slash.code              "코드 블록"
  slash.divider           "구분선"
  slash.math              "수식 블록"
  math.parse_error        "수식 파싱 오류"
  toolbar.bold            "굵게"
  toolbar.italic          "기울임"
  toolbar.strike          "취소선"
  toolbar.code            "인라인 코드"
  toolbar.h1              "제목 1"
  toolbar.h2              "제목 2"
  toolbar.h3              "제목 3"

messages/ko/sidebar.json
  new_note                "새 노트"
  empty_folder            "비어 있어요."
  offline                 "오프라인"

messages/en/*             동일 키, 영문
```

카피 규율: 존댓말, 경쟁사 미언급(Notion/Obsidian 안 씀).

### 8.2 스타일 토큰

- Plan 9a `stone + ember` 팔레트 재사용.
- shadcn `components.json` `tailwind.css` 경로는 `src/app/globals.css`, `baseColor` = `neutral` (임시), 하지만 컴포넌트 내부에서 쓰는 `bg-background`/`text-foreground` 등은 `tailwind.config`에서 Plan 9a CSS 변수(`--fg`, `--bg-surface`, `--accent-ember`)에 매핑되도록 override.
- 에디터 최대 너비: `max-w-[720px]` 중앙 정렬 (Notion/Substack 중간 감각).
- 기본 폰트: 본문 system-ui. 제목 Plan 9a에서 가져온 `Instrument Serif`.

### 8.3 단축키 (2A 범위)

| 키 | 동작 |
|---|---|
| `Cmd/Ctrl+B` | bold |
| `Cmd/Ctrl+I` | italic |
| `Cmd/Ctrl+Shift+X` | strikethrough |
| `Cmd/Ctrl+E` | inline code |
| `Cmd/Ctrl+K` | wiki-link (현재 선택 → combobox 시드) |
| `Cmd/Ctrl+S` | 강제 저장 (디바운스 무시, 저장 인디케이터 보여줌) |

탭 관리 단축키는 2E 소관 — 본 스펙은 단일 노트 페이지만.

---

## 9. 비기능 요구사항

- **성능**: 노트 초기 로드 p50 < 300ms (SSR 포함). Plate 초기화 비용은 클라이언트에서 감수.
- **저장 debounce**: 500ms. 유저가 연속 타이핑 시 네트워크 요청 과도하지 않도록.
- **검색 응답**: wiki-link combobox 응답 p95 < 200ms (title ilike 단순 인덱스면 문제 없음).
- **i18n 누락 방지**: `no-literal-string` ESLint + `i18n:parity` CI. 위반 시 빌드 실패.
- **접근성**: 모든 버튼 aria-label 키화. 색대비 WCAG AA.
- **보안**: `content` 는 jsonb 저장 — HTML이 아님. wiki-link는 `/notes/:id` 내부 링크만 허용 (외부 URL 삽입은 Plate `link` plugin이 별도, 2A 범위 외).

---

## 10. 구현 순서 (E2E first — plan에서 상세화)

1. **Plate + shadcn + KaTeX 설치 + 테마 매핑** — 빈 에디터가 페이지에 뜨고 Plan 9a 토큰으로 렌더됨.
2. **API: PATCH/POST/search 추가 + 통합 테스트** — 백엔드가 준비됨.
3. **라우트 + 사이드바 shell + 에디터 wiring + save/load** — 첫 E2E 통과 (create → edit → reload persists).
4. **LaTeX plugin** — E2E 7~8 케이스 통과.
5. **Wiki-link plugin + 검색** — E2E 5 케이스 통과.
6. **Slash command plugin** — E2E 6 케이스 통과.
7. **i18n parity + 최종 정리 + post-feature workflow (verify → review → docs → commit)**.

Plan 문서에서 이 7단계를 태스크로 풀어내며, 각 태스크 끝나면 즉시 커밋 + E2E 스냅샷.

---

## 11. Open questions (구현 중 결정)

- `content_tsv` GENERATED 여부 — migration 0001~0007 확인 필요. 필요 시 0008로 보강 또는 서버에서 업데이트.
- shadcn 설치 시 `components.json` 의 `tailwind.config` 경로 — Tailwind 4는 JS config 안 씀. PostCSS + `@theme` 블록으로 매핑해야 할 수 있음. 설치 단계에서 확인.
- `@platejs/math` v49 API 변경 — plan 문서 기준 `MathKit` 인데 실제 패키지 export 확인 필요.
- TanStack Query provider — 이미 layout에 있는지 확인 필요 (없으면 `[locale]/(app)/layout.tsx` 에서 주입).

---

## 12. Out of scope reminder

2B/2C/2D/2E는 본 스펙이 깔아놓은 기반 위에서 각각 brainstorm → spec → plan → implement 사이클을 따로 돈다. 본 스펙은 그 기반이 된다는 점에서 스키마·라우트·컴포넌트 경계가 **후속과 호환되도록** 설계돼 있다:

- `NoteEditor` 의 `readOnly` prop은 2B에서 permission-based readOnly 에 재사용.
- `content jsonb` 포맷이 Plate Value — Yjs binding 시 `y-prosemirror`/`y-slate` 중 하나로 직렬화·역직렬화 가능.
- 라우트 `/[locale]/(app)/w/<ws>/p/<proj>/notes/<note>` 은 collaboration-model §7 deep-link 포맷과 일치 — 알림(2C)이 바로 링크 가능.
