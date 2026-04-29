# Session 1 — Iteration 1 Findings

> **범위**: Area 1 (Plate 에디터 코어) + Area 2 (Slash commands & blocks + save_suggestion 검증)
> **감사일**: 2026-04-28
> **브랜치**: `codex/self-hosting-compose-stabilization` (main 기준 +2 infra커밋)
> **읽은 파일**: NoteEditor.tsx · note-editor-client.tsx · plugins/slash.tsx · plugins/latex.tsx · plugins/wiki-link.tsx · plugins/mermaid-fence.tsx · blocks/\*\*/\* · elements/\*\*/\* · doc-editor/\* · useCollaborativeEditor.ts · PresenceStack.tsx · hocuspocus/src/\* (server · auth · config · permissions-adapter · persistence · plate-bridge · readonly-guard) · hooks/use-note-search.ts · components/comments/CommentComposer.tsx · components/share/share-dialog.tsx · api/src/lib/agent-pipeline.ts

---

## ✅ 검증 통과 사항 (회계 클리어)

| 항목 | 결과 |
|---|---|
| `from 'platejs/react'` import (§8 antipattern) | ✅ 모든 파일 준수 |
| `BasicNodesKit` / `MathKit` bundle export | ✅ 개별 플러그인 사용 |
| `.withComponent()` 패턴 (LaTeX) | ✅ `EquationPlugin.withComponent(MathBlock)` |
| `editor.tf.{key}.toggle()` 패턴 | ✅ `actions.toggleMark` + toolbar 모두 준수 |
| `<Plate>` + `<PlateContent>` 구조 | ✅ `<Plate editor={editor} readOnly>` + `<PlateContent>` |
| `editor.tf.insertNodes` (plural) | ✅ SlashMenu 전체 적용 |
| `deleteBackward("character")` TextUnit | ✅ 정확한 스트링 사용 |
| `toggleList` (v49 indent-based) | ✅ `toggleList(editor, { listStyleType: "disc" })` |
| `awareness` 접근 패턴 | ✅ `editor.getOption(YjsPlugin, "awareness")` (§11) |
| awareness 상태 키 | ✅ `state.data.{name,color}` (cursorDataField = "data") |
| `readonly-guard` → `onChange`만 (§11) | ✅ `beforeHandleMessage` throw 없음 |
| `connectionConfig.readOnly` 세팅 | ✅ `payload.connectionConfig.readOnly = ctx.readOnly` |
| Plan 11B Phase A save_suggestion (Tier 1 §1.3) | ✅ **CLOSED** — `AGENT_STUB_EMIT_SAVE_SUGGESTION` 코드패스 완전 제거, `save-suggestion-fence.ts` + `chat-llm.ts` 경로 실 LLM 연동 확인 |
| Plan 11B Phase A Agent Panel stub (Tier 1 §1.1) | ✅ **CLOSED** — `agent-pipeline.ts` 의 하드코딩 stub echo 제거, `runChat()` 호출로 교체 |

---

## High

### S1-001 — SlashMenu window keydown: 포커스 없이 에디터 외 컨텍스트에서 트리거

**파일**: `apps/web/src/components/editor/plugins/slash.tsx:172-190`

**현상**: `SlashMenu`가 `window.addEventListener("keydown", onKey)` 로 `/` 키를 감청하되 `document.activeElement`가 PlateContent 내부인지 확인하지 않는다.

**재현 경로**:
1. 페이지 제목 input에 포커스 후 `/` 입력 → 슬래시 메뉴 팝업
2. 메뉴 항목 클릭 시 `editor.tf.deleteBackward("character")` 실행 → Plate 에디터의 마지막 커서 위치 문자가 삭제됨
3. 제목 input의 `/`는 그대로 남아 "타이틀 + 에디터 양쪽이 동시에 변형"

같은 문제가 `CommentComposer.tsx`(textarea), `ShareDialog`(member search input), Wiki-link combobox 내부 input에서도 발생.

**영향**:
- 에디터에 내용이 있을 때 타이틀에서 `/` 타이핑 → **데이터 무결성 파괴** (에디터 문자 삭제)
- UX: 다른 입력 필드에서 항상 슬래시 메뉴가 열림

**수정 방향**:
```ts
const onKey = (e: KeyboardEvent) => {
  // ACTIVE ELEMENT GUARD: 에디터 contenteditable 내부에만 반응
  const target = e.target as Element | null;
  if (!target?.closest('[data-testid="note-body"]')) return;
  ...
};
```
또는 `useEditorRef()`로 editor를 읽어 `editor.isFocused()`를 체크하는 방식.

---

### S1-002 — Hocuspocus 인증: 클라이언트 `token: ""` → 서버 `payload.token = ""` → 인증 우회 가능성

**파일**: `apps/web/src/hooks/useCollaborativeEditor.ts:57` + `apps/hocuspocus/src/server.ts:53-58` + `apps/hocuspocus/src/auth.ts:39-68`

**현상**:
클라이언트가 HocuspocusProvider에 `token: ""` (빈 문자열)을 전달한다. `@hocuspocus/provider` v3는 `token`이 falsy이면 `MessageType.Auth` 메시지를 서버로 보내지 않는다. 결과적으로 서버의 `onAuthenticate` 훅이 호출되지 않을 수 있다.

**두 시나리오 중 하나**:

**시나리오 A — `onAuthenticate` 미호출**:
- `payload.connectionConfig.readOnly`가 설정되지 않음 (기본값: false = 쓰기 가능)
- `readonly-guard.onChange`가 체크하는 `ctx?.readOnly` → `undefined` → falsy → 경비 통과
- 결과: **인증 없이 누구든 임의 노트에 쓰기 가능** (Critical 등급 취약점)

**시나리오 B — `onAuthenticate` 호출되지만 `verifySession("") → null`**:
- `makeAuthenticate`가 `throw new Error("unauthenticated")` → 연결 거절
- 결과: 모든 협업 연결 실패, 에디터가 완전히 broken

**근거**: `auth.ts:95-96` `verifySession("")` → `extractSignedValue("")` → `raw.includes("=")` = false → bare value path → `""` 반환 → `unsignCookieValue("") ` → `dot = -1` → `null` → `session = null` → throw

**올바른 구현**: 서버가 `payload.requestHeaders?.cookie` 를 폴백으로 전달해야 한다:
```ts
async onAuthenticate(payload) {
  const token =
    payload.token || payload.requestHeaders?.cookie || "";
  const ctx = await authenticate({
    documentName: payload.documentName,
    token,
  });
  ...
```

**검증 우선순위**: 실제 dev 서버를 띄워 WebSocket 연결이 성공/실패하는지, 에디터 내용 변경이 DB에 반영되는지 확인 필요.

---

### S1-003 — HOCUSPOCUS_ORIGINS env var 정의되었지만 `Server`에 미전달

**파일**: `apps/hocuspocus/src/config.ts:8` + `apps/hocuspocus/src/server.ts:42-77`

**현상**: `config.ts`에서 `HOCUSPOCUS_ORIGINS` 환경 변수를 파싱·검증하지만, `server.ts`의 `new Server({...})` 생성자에 `origins` 옵션이 없다. Hocuspocus v3의 `Server`는 `origins: string[]` 파라미터로 WebSocket Upgrade 요청의 `Origin` 헤더를 검증한다.

**영향**: 허용된 오리진 제한 없음 → 임의 도메인의 WebSocket 클라이언트가 Hocuspocus 서버에 연결 가능. S1-002와 결합 시 크로스-오리진 공격 표면.

**수정 방향**:
```ts
const server = new Server({
  port: env.HOCUSPOCUS_PORT,
  name: "opencairn-hocuspocus",
  origins: env.HOCUSPOCUS_ORIGINS.split(",").map((o) => o.trim()),
  ...
```

---

## Medium

### S1-004 — WikiLinkCombobox Cmd+K 전역 감청: 포커스 가드 없음

**파일**: `apps/web/src/components/editor/plugins/wiki-link.tsx:87-99`

**현상**: S1-001과 동일한 패턴. `window.addEventListener("keydown", ...)` 로 Cmd/Ctrl+K를 감청하되 PlateContent 포커스 여부를 체크하지 않는다. CommentComposer, ShareDialog, 검색 input에서 Cmd+K 시 위키링크 combobox가 열리고, 결과 선택 시 `editor.tf.insertNodes(node)` + `editor.tf.insertText(" ")`가 에디터의 마지막 커서 위치에 삽입된다.

**영향**: 에디터 외부에서 wiki-link 노드가 에디터에 삽입되거나 에디터가 포커스 없는 상태에서 selection을 잃어 삽입 위치가 예측 불가.

---

### S1-005 — 위키링크 노트 검색 debounce 없음

**파일**: `apps/web/src/hooks/use-note-search.ts:11-18`

**현상**: `useNoteSearch(q, projectId)`는 TanStack Query에 `staleTime: 15_000`만 설정. `q`가 변할 때마다 새 쿼리 키(`["note-search", projectId, q]`)가 생성돼 즉시 네트워크 요청이 발사된다. "knowledge" 를 타이핑하면 k→kn→kno→know→knowl→… 9번 요청.

**비교**: `ShareDialog` 멤버 검색도 동일 패턴이지만 서버가 결과를 10개로 capping하고 workspace member 수가 적어 영향이 제한적. 노트 검색은 대형 workspace에서 부담.

**수정 방향**: 호출 사이트(`WikiLinkCombobox`) 또는 훅 내부에 300ms debounce 추가.

---

### S1-006 — `storeImpl` 매 호출마다 전체 Y.Doc 재구성

**파일**: `apps/hocuspocus/src/persistence.ts:196-200`

```ts
const doc = new Y.Doc();
Y.applyUpdate(doc, state);
const plateValue = yDocToPlate(doc);
```

**현상**: Hocuspocus의 `onStoreDocument`(= `Database.store`)는 문서 변경마다 호출된다. 매번 `Y.Doc`을 새로 생성하고 전체 state를 `applyUpdate`한 뒤 `yDocToPlate` + `extractText` 변환을 동기 실행. 100+ 블록 노트의 경우 per-change CPU spike가 발생.

**영향 범위**: 동시 편집 중 다수 변경 이벤트 → 다수 재구성 → Node.js 이벤트 루프 지연.

**완화 방안**: `onStoreDocument` 배치 debounce(Hocuspocus `debounce` 옵션) 설정, 또는 `Database` 확장의 `debounce` 파라미터 활용.

---

### S1-007 — Share link `expiresAt` 미시행 + 추적 이슈 없음

**파일**: `apps/web/src/components/share/share-dialog.tsx` (전체)

**현상**: Plan 2C가 share link 비밀번호/만료 enforcement를 "post-launch deferred"로 명시했으나:
1. `share-dialog.tsx`에 만료일 입력 UI 없음
2. `shareApi.create(noteId, role)` 서명에 `expiresAt` 파라미터 없음
3. 공개 링크 viewer가 만료된 링크로 접근 시 서버가 실제로 거절하는지 `apps/api/src/routes/share.ts` 미확인 (이번 iteration 범위 외)
4. 이 gap을 추적하는 GitHub issue/Plan 없음

**위험**: 한 번 발급된 공개 링크가 영구 유효. 사용자가 링크를 revoke하는 수밖에 없음.

---

## Low

### S1-008 — @mention raw token 삽입: 서버 측 workspace 귀속 검증 필요

**파일**: `apps/web/src/components/comments/CommentComposer.tsx:122-144`

**현상**: `insertToken(tokenString)` 함수는 사용자가 검색·선택한 결과의 token을 그대로 body에 삽입한다. 그러나 사용자가 textarea에 직접 `@[user:00000000-0000-0000-0000-000000000001]` 을 타이핑하면 front-end mention 검색을 우회한 채 임의 UUID가 `comment_mentions` 테이블에 들어갈 수 있다. 서버 측 `parseMentions` 가 `workspaceId` 귀속 검증을 수행하는지 `apps/api/src/routes/comments.ts` 미확인 (Area 4 — iteration 2).

### S1-009 — SlashMenu 구분선 위치 하드코딩 (`i === 8`)

**파일**: `apps/web/src/components/editor/plugins/slash.tsx:363`

`{i === 8 && (<li className="my-1 border-t ..." />)}` — BLOCK_COMMANDS의 실제 길이 변화 시 separator 위치가 틀림. `BLOCK_COMMANDS.length`로 계산하거나 카테고리 필드를 추가해야 함. 현재는 13 commands 기준 hr(index 7)/mermaid(index 8) 사이에 separator가 정확히 위치하나, 명시적이지 않음.

### S1-010 — `PresenceStack` awareness `useEffect`: `editor` 의존성 안전성

**파일**: `apps/web/src/components/editor/PresenceStack.tsx:32-58`

`useEffect([editor])` → editor reference가 바뀌면(noteId/readOnly 변경) 재실행. cleanup에서 `awareness.off("change", refresh)` 호출. `refresh` 클로저 내 `setUsers` 가 cleanup 후에 fire되면 React 18에서 자동으로 no-op 처리되므로 leak 없음. ✅ 현 구현 안전. Minor 기록.

---

## 검증 완료 (Plan 2D / 11B Phase A)

| Claim | 실제 코드 | 결론 |
|---|---|---|
| `AGENT_STUB_EMIT_SAVE_SUGGESTION` 제거 | `agent-pipeline.ts` 검색: 해당 환경 변수 코드패스 없음 | ✅ CLOSED |
| `save-suggestion-fence.ts` 실제 LLM 연동 | `chat-llm.ts:3` import + `:137` yield 확인 | ✅ CLOSED |
| Agent Panel echo stub 제거 | `agent-pipeline.ts:34-62` `runChat()` 호출 | ✅ CLOSED |
| Plan 11B Phase A audit Tier 1 #1/2/3 | agent-pipeline + chat-llm + threads 코드 모두 실 LLM 경로 | ✅ CLOSED |
