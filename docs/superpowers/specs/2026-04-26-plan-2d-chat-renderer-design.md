# Plan 2D — Chat Renderer + Editor Block Extensions Design

**Status**: Draft (2026-04-26)
**Owner**: kss19558@gmail.com
**Branch**: `feat/plan-2d-chat-renderer` (worktree `.worktrees/plan-2d`)
**Plan doc**: `docs/superpowers/plans/2026-04-09-plan-2-editor.md` (Tasks 18~20 subset)

## Goal

Plate v49 에디터에 Mermaid · Callout · Toggle · Table · Columns 5 블록 타입을 추가하고, Agent Panel 채팅 메시지를 Claude-급 리치 마크다운 렌더로 표시하며, `save_suggestion` SSE 페이로드를 받아 활성 노트에 Plate 블록으로 직접 삽입한다.

비목표 (out of scope, Plan 2E로 이연):
- Plan 11B 본체 (provenance, slash 6 commands, related pages)
- Image · Embed 블록
- Pin to Page 폴리싱
- Drag-resize column
- Multi-Mode Tab Shell + Artifact (이미 App Shell Phase 3-B + Plan 7 Canvas로 구현됨)

## Background

현재 `apps/web/src/components/editor/NoteEditor.tsx`는 Plate v49 베이스 플러그인 (marks, headings, lists, LaTeX void, wiki-link, research-meta, Yjs collab, comments)만 사용. Notion-급 블록 자유도가 부족하다.

`apps/web/src/components/agent-panel/message-bubble.tsx`는 메시지 본문을 단순 텍스트로 출력. SSE는 `text` (delta), `status`, `thought`, `citation`, `save_suggestion`, `done` 6개 chunk type을 이미 지원 (`apps/api/src/lib/agent-pipeline.ts`). 단 stub generator는 save_suggestion을 emit하지 않는다.

`save-suggestion-card.tsx`는 이미 존재하지만 onSave 핸들러가 미배선 — `MessageBubble`에서 `onSaveSuggestion(msg.content.save_suggestion)` 호출까지만 가고 그 위 어디로도 연결되지 않은 상태.

## Architecture

### 3개 레이어 + 1개 공유 모듈

```
apps/web/src/
├── components/editor/blocks/         (NEW)
│   ├── mermaid/                      # Plate void node + lazy mermaid
│   ├── callout/                      # Plate element + 4 type variants
│   ├── toggle/                       # Plate element + collapsible
│   ├── table/                        # @platejs/table thin wrapper
│   └── columns/                      # 2/3 col layout
│
├── components/chat/                  (NEW)
│   ├── chat-message-renderer.tsx     # react-markdown wrapper
│   ├── renderers/                    # Mermaid · SVG · Code · Callout (chat side)
│   └── streaming-text.tsx            # incremental render with cursor
│
└── lib/markdown/                     (NEW, 공유)
    ├── markdown-to-plate.ts          # @platejs/markdown.deserialize 래퍼
    │                                 # + custom mermaid/callout 패치
    └── shared-prose.ts               # Tailwind prose 토큰 (chat ⇄ editor)
```

### 핵심 설계 원칙

1. **2-track 렌더링, 1-track 데이터**
   - 채팅 표시: react-markdown (가벼움, char-by-char 스트리밍 OK)
   - 저장: Markdown → Plate AST → `editor.tf.insertNodes()`
   - 시각적 일관성: 두 렌더러 모두 `lib/markdown/shared-prose.ts`의 같은 className 토큰 사용

2. **에디터 블록은 모두 Plate v49 element 패턴**
   - `createPlatePlugin({ key, node: { isElement, isVoid? } }).withComponent(Component)`
   - 블록별 transforms (`editor.tf.insert.mermaid()`, `editor.tf.insert.callout({ kind: 'info' })`)
   - 슬래시 메뉴 entry 5개 + ` ```mermaid ` fence 자동 변환

3. **save_suggestion payload 스키마**
   - `packages/shared`에 `saveSuggestionSchema` 신규 추가
   - 현재 stub은 emit 안 함 — 이번 Plan에서 stub에 옵션 (env flag)으로 추가하여 E2E 가능하게
   - 실제 agent runtime 연동은 Plan 4 Phase B 이후 별도 작업

4. **삽입 동작 (스마트 폴백)**
   - 활성 탭이 plate 노트 → 그 노트 끝에 `editor.tf.insertNodes(ast, { at: editor.api.end() })`
   - 그 외 (PDF/canvas/data/source/없음) → `Sonner` 토스트 액션 "새 노트 만들기" / "다른 노트 선택"
   - 새 노트 만들기: `POST /notes` (existing) + `openTab({ noteId, mode: 'plate' })` + `editor.tf.insertNodes(ast)`

## Data + API

### DB 스키마 변경
**없음.** 모든 새 블록은 Plate JSON 안의 element type으로만 존재. `notes.content` 컬럼은 이미 JSONB → 추가 마이그레이션 불필요.

### `packages/shared` — save_suggestion zod 스키마 (신규)

```ts
// packages/shared/src/agent.ts
export const saveSuggestionSchema = z.object({
  title: z.string().min(1).max(200),
  body_markdown: z.string().min(1),
  source_message_id: z.string().uuid().optional(),
});
export type SaveSuggestion = z.infer<typeof saveSuggestionSchema>;
```

agent SSE chunk schema에서 type='save_suggestion'일 때 payload를 이 스키마로 검증.

### `apps/api` — 변경 최소

`apps/api/src/lib/agent-pipeline.ts`의 stub generator에 옵션 분기 추가:

```ts
if (process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION === '1' &&
    opts.userMessage.content.includes('/test-save')) {
  yield {
    type: 'save_suggestion',
    payload: {
      title: 'Test note from chat',
      body_markdown: '# Test\n\n- item 1\n- item 2\n\n```mermaid\ngraph TD\nA --> B\n```',
    },
  };
}
```

**이유**: 실제 LLM 통합 전에 E2E 테스트 가능하도록. 프로덕션 영향 0 (env flag 미설정 시 기존 동작 유지).

`routes/threads.ts`는 이미 `save_suggestion` chunk를 핸들링 중이므로 변경 없음.

### `apps/web` — 신규 client 헬퍼

- **`lib/markdown/markdown-to-plate.ts`**:
  - `@platejs/markdown.deserialize(markdown)` 호출
  - 커스텀 후처리 1: 코드 블록 중 `lang === 'mermaid'`이면 `type: 'mermaid'` element로 변환
  - 커스텀 후처리 2: blockquote 첫 줄이 `> [!info]` 패턴이면 `type: 'callout', kind: 'info'`로 변환 (kind ∈ info|warn|tip|danger)
  - 반환: Plate `Value` (Element[])
- **`lib/notes/insert-from-markdown.ts`**:
  - 입력: `{ markdown, sourceMessageId? }`
  - 활성 탭 plate 모드 검사 → insertNodes / 또는 toast action 발생
  - 호출 측: `save-suggestion-card.tsx` onSave

### 의존성 추가 (`apps/web/package.json`)

```jsonc
{
  "dependencies": {
    "@platejs/code-block": "^49",
    "@platejs/callout": "^49",
    "@platejs/toggle": "^49",
    "@platejs/table": "^49",
    "@platejs/layout": "^49",
    "mermaid": "^11",
    "react-markdown": "^9",
    "remark-gfm": "^4",
    "remark-math": "^6",
    "rehype-katex": "^7",
    "rehype-raw": "^7",
    "isomorphic-dompurify": "^2",
    "react-syntax-highlighter": "^15"
  }
}
```

**syntax highlight 선택**: `react-syntax-highlighter` (Prism.js 베이스). 작은 번들 (~20kb gzip), 즉시 동기 highlight, 채팅 렌더에 적합. shiki는 ROI 낮음.

**Plate v49 sub-packages 검증 (2026-04-26 npm 조회)**: `@platejs/callout@49.0.0`, `@platejs/toggle@49.0.0`, `@platejs/table@49.0.19`, `@platejs/code-block@49.0.0`, `@platejs/layout@49.2.1` 모두 npm에 존재. 기존 `platejs@^49`와 호환되는 ^49 버전 사용 (52/53은 Plate 코어 메이저 변경 동반, 본 Plan 범위 외).

## Components

### Editor Blocks 5종

#### Mermaid (void node)

```tsx
// blocks/mermaid/mermaid-element.tsx
export const MermaidPlugin = createPlatePlugin({
  key: 'mermaid',
  node: { isElement: true, isVoid: true, type: 'mermaid' },
}).withComponent(MermaidElement);

// element shape: { type: 'mermaid', code: string, children: [{ text: '' }] }
```

- **렌더 흐름**: lazy `import('mermaid')` (SSR 금지) → `useEffect` 안에서 `mermaid.render()` → SVG 결과 inline
- **에러 UI**: 파싱 실패 시 빨간 border + "다이어그램 오류" + 코드 그대로 보여주기 + "코드 보기/숨기기" 토글
- **편집**: 블록 클릭 → 우측 사이드 floating editor (textarea, syntax 없음). 이중 모드 (preview / source)
- **테마**: light/dark 둘 다 지원. theme 변경 시 re-render
- **Slash**: `/mermaid` → 빈 코드와 함께 insert
- **Fence**: 일반 code 블록 lang='mermaid' 감지 시 자동 변환 (autoformat 플러그인)

#### Callout (element)

```ts
// element shape: { type: 'callout', kind: 'info'|'warn'|'tip'|'danger', children: [...] }
```

- **렌더**: 좌측 4-color 막대 + 아이콘 (Info / AlertTriangle / Lightbulb / AlertOctagon) + content
- **type 토글**: 좌측 아이콘 클릭 → 4종 순환 (Plate transforms `setNodes`)
- **Slash**: `/callout` (기본 info) — 사용자가 좌측 클릭으로 type 변경
- **편집**: 일반 element라서 안에 paragraphs / lists / code 다 가능

#### Toggle (element)

```ts
// element shape: { type: 'toggle', open: boolean, children: [<summary>, <body>] }
```

- **구조**: 첫 child는 summary text node, 나머지는 body content
- **렌더**: 좌측 chevron (right→down) + summary + (open이면) body
- **상태**: `open`을 element에 저장 → Yjs sync 됨 (다른 사용자에게도 같은 상태 공유). Notion 패턴, 단순하고 의도 분명
- **Slash**: `/toggle`

#### Table (`@platejs/table` 래퍼)

- Plate가 다 해줌 — 컴포넌트 styling만 추가
- 행/열 우클릭 메뉴 (insert above / below / left / right, delete row / col)
- 첫 row를 헤더로 토글 옵션 (셀 type='th' 변환)
- **Slash**: `/table` → 3×3 default

#### Columns (`@platejs/layout` or custom)

```ts
// element shape: { type: 'column-group', children: [<column>, <column>, ...] }
//                 { type: 'column', width?: number, children: [...] }
```

- **렌더**: flex container, 각 column은 `flex-1` (기본 균등)
- **Slash**: `/columns` → submenu (2 cols / 3 cols)
- **MVP**: 드래그 리사이즈 없음 (Notion 1.0 모델). 균등 분할만. 리사이즈는 차후
- **모바일**: 화면 너비 < 768px → 자동 stack (CSS only)

### 슬래시 메뉴 통합

기존 8개 → 13개로 확장:
```
heading 1 / heading 2 / heading 3
bullet list / number list
quote / divider / code
─────────────────────────
mermaid / callout / toggle / table / columns
```
필터링은 키 입력에 자동 반응 (Plate v49 `SlashInputPlugin`). 카테고리 헤더는 `<hr>` 한 줄로 단순 표시.

### Chat Renderer

#### `chat-message-renderer.tsx`

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[rehypeKatex, rehypeRaw]}
  components={{
    code: CodeBlockRenderer,
    pre: ({ children }) => <>{children}</>,
    blockquote: CalloutAwareBlockquote,
    table: ProseTable,
  }}
>
  {sanitizeHtml(message.content.body)}
</ReactMarkdown>
```

`sanitizeHtml`은 DOMPurify 기반. raw `<script>`, `<iframe>`, `on*` 핸들러 제거. SVG는 별도 화이트리스트 (`<svg>`, `<path>`, `<rect>`, `<circle>`, `<g>`, `<text>`, presentation attrs).

#### `streaming-text.tsx` (스트리밍 인디케이터)

- 메시지가 `status === 'streaming'` 중일 때 끝에 깜빡이는 cursor `▍`
- 스크롤 따라가기 (`useChatScrollFollow` hook)

#### `renderers/code-block.tsx`

- `language === 'mermaid'` → `<MermaidChatRenderer code={code} />` (lazy)
- 그 외 → `<SyntaxHighlighter language={lang} style={oneDarkPro}>`
- 우상단에 copy button + 언어 라벨

#### `renderers/mermaid-chat.tsx`

- 에디터의 mermaid와 똑같은 lazy `mermaid.render()` 호출
- 채팅에서는 source 토글 없음. 에러 시 코드 fallback만
- 공유 hook 추출: `useMermaidRender(code, theme)` → 에디터/채팅 둘 다 사용

#### `message-bubble.tsx` 수정

- 현재 `{msg.content.body}` 출력 → `<ChatMessageRenderer message={msg} />`로 교체
- save_suggestion이 있으면 기존 `<SaveSuggestionCard>` 유지 (onSave handler를 `insertFromSaveSuggestion`로 연결)

### save_suggestion → 에디터 삽입 흐름

```
SaveSuggestionCard.onSave()
  ↓
insertFromSaveSuggestion({ title, body_markdown, sourceMessageId })
  ↓
1. 활성 탭 검사 (useTabsStore.activeTab)
   ├─ plate 모드 노트면:
   │     ast = markdownToPlate(body_markdown)
   │     editor.tf.insertNodes(ast, { at: editor.api.end() })
   │     toast.success("노트에 추가됨")
   │
   └─ 그 외 (PDF / canvas / data / source / 없음):
         toast({
           description: "이 채팅을 어디에 저장할까요?",
           action: {
             label: "새 노트로 만들기",
             onClick: async () => {
               const note = await api.notes.create({ title, content: ast });
               openTab({ noteId: note.id, mode: 'plate' });
             }
           },
           cancelLabel: "취소"
         })
```

**Editor instance store** (신규):
- `useActiveEditorStore` (Zustand) — `setEditor(noteId, editor)` / `getEditor(noteId)`
- `NoteEditor` 마운트 시 자기 editor를 store에 등록, unmount 시 제거
- 메모리 누수 방지: `useEffect` cleanup에서 반드시 `removeEditor(noteId)` 호출

## i18n

`pnpm --filter @opencairn/web i18n:parity` 통과 필수.

신규 키 약 20개:
```
editor.blocks.mermaid.{insert,placeholder,error_title,error_help}
editor.blocks.callout.{insert,info,warn,tip,danger}
editor.blocks.toggle.{insert,placeholder}
editor.blocks.table.{insert,row_add,col_add,delete}
editor.blocks.columns.{insert,2col,3col}
chat.renderer.{copy,copied,mermaid_loading}
agentPanel.bubble.save_suggestion_{insert_target_active,insert_target_new}
notes.create_from_chat.success
```

ko/en 동시 작성 (메모리에 적힌 정책: launching 단계 직전 batch 번역. 이 Plan은 dev 단계라 동시).

ESLint `i18next/no-literal-string`: 모든 user-facing 문자열 키 사용.

## Testing

### Unit (Vitest, `apps/web`)

- **`lib/markdown/markdown-to-plate.test.ts`** (~15 case): GFM 기본 / GFM 확장 / math / mermaid 후처리 / callout 후처리 / 엣지케이스 (빈 문자열, 깨진 마크다운)
- **`components/editor/blocks/*/element.test.tsx`** (블록당 2~3 case): mermaid lazy mock + render, mermaid 에러, callout 토글, toggle open/close, table insert, columns insert
- **`components/chat/*.test.tsx`**: chat-renderer GFM/math/mermaid/svg/xss 시도, code-block copy
- **`lib/notes/insert-from-markdown.test.ts`**: 활성 탭 plate / 비plate / 새 노트 생성 분기

### E2E (Playwright, `apps/web/e2e/plan-2d/`)

- **`plan-2d-editor-blocks.spec.ts`**: 5 블록 슬래시 삽입 + 인터랙션 (mermaid SVG, callout type 토글, toggle 펼침, table 셀 입력 + 행 추가, columns 양쪽 텍스트)
- **`plan-2d-chat-renderer.spec.ts`**: code 블록 syntax highlight, mermaid SVG, GFM table, copy 버튼
- **`plan-2d-save-suggestion.spec.ts`** (env `AGENT_STUB_EMIT_SAVE_SUGGESTION=1` 필요): "/test-save" → SaveSuggestionCard → 활성 plate 노트 케이스 / 비plate 케이스 (toast → 새 노트 만들기 → 콘텐츠 검증)

### API/Worker

- `apps/api/src/routes/threads.test.ts`에 case 추가:
  - stub env flag 켜면 `save_suggestion` chunk가 SSE로 흘러감
  - finalize된 메시지의 `content.save_suggestion` 필드가 zod schema 통과

## Risks & Mitigations

| 리스크 | 대응 |
|--------|------|
| `@platejs/callout`/`toggle` 패키지 부재 | 2026-04-26 npm 조회로 v49 존재 확인 완료. ^49 핀 사용 |
| Mermaid SSR crash | 무조건 `'use client'` + `next/dynamic({ ssr: false })`. SSR HTML에는 placeholder |
| react-markdown raw HTML XSS | `rehype-raw` + DOMPurify 양쪽. SVG는 별도 화이트리스트 |
| char-by-char 스트리밍 시 markdown 미완성 상태 매번 파싱 | react-markdown은 toFrag/toRaw 둘 다 지원. 미완성 ` ``` ` 등은 자연스럽게 처리됨. 토큰당 ~0.3ms 안전 |
| Markdown→Plate 변환 누락 케이스 | round-trip 손실 케이스(callout, mermaid)는 후처리로 보강. 미인식 fallback to plain blockquote/code |
| 에디터 인스턴스 store 메모리 누수 | NoteEditor `useEffect` cleanup에서 `removeEditor(noteId)`. unit test로 mount/unmount 시 store 사이즈 검증 |
| save_suggestion stub flag 프로덕션 유출 | `AGENT_STUB_EMIT_SAVE_SUGGESTION` env는 dev/test only. CI 빌드 env 화이트리스트 검증 |
| Yjs sync 시 toggle open 상태 동시 편집자 영향 | 의도 (Notion 패턴). 사용자 hint는 Plan 외 |

## Migration Safety

- DB 변경 없음
- 기존 노트의 Plate JSON에 새 element type 등장할 일 없음 (block 추가는 future-only)
- 기존 렌더러는 알 수 없는 element type을 fallback paragraph로 처리 (Plate 기본) — 롤백 시 데이터 손실 없음

## Open Questions

해결됨:
- Chat 렌더러: hybrid (react-markdown 표시 + Plate AST 캐싱)
- save_suggestion UX: 스마트 폴백 (active plate / 그 외 toast)
- 블록 생성 UX: slash + fence + inline 토글
- 스코프: 5 블록 + chat 렌더러 + save_suggestion. Plan 11B는 Plan 2E

남은 검증 (구현 시 수행):
- mermaid CDN vs npm 번들 사이즈 비교 (npm으로 갈 가능성 높음, lazy chunk라 OK)
- `next-intl`이 toast description 안의 key + value interpolation 지원 여부 (대부분 지원)
- `api.notes.create`가 `content` (Plate Value) 필드를 직접 받는지, 아니면 빈 노트 생성 후 별도 PATCH 필요한지 (구현 시작 시 `apps/api/src/routes/notes.ts` 확인)

## Out of Scope (Plan 2E로 이연)

- Plan 11B 본체: provenance markers, slash 6 commands (`/summarize`, `/expand`, `/translate`, ...), related pages 패널
- Image · Embed 블록
- Pin to Page 폴리싱 (drag from chat → editor 시각 효과)
- Drag-resize column

## Estimated Scope

약 18~22 task. App Shell Phase 4 (~18 commits) 와 비슷한 사이즈.

분포:
- Editor blocks 5종: 5~7 task
- Chat 렌더러: 4~5 task
- Markdown → Plate 변환기: 2~3 task
- save_suggestion 흐름 + editor instance store: 3 task
- i18n + 테스트 + 의존성 추가: 3~4 task
