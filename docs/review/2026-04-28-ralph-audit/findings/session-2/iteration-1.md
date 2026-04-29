# Session 2 — Iteration 1 Findings

**Date**: 2026-04-28
**Areas covered**: 영역 1 (App Shell 3-panel + 탭 시스템) + 영역 2 (Chat panel — Plan 11A + 11B-A)
**Files audited**:
- `apps/web/src/components/shell/app-shell.tsx`
- `apps/web/src/components/shell/shell-providers.tsx`
- `apps/web/src/components/tab-shell/tab-shell.tsx`
- `apps/web/src/components/tab-shell/tab-bar.tsx`
- `apps/web/src/components/tab-shell/tab-mode-router.tsx`
- `apps/web/src/stores/tabs-store.ts`
- `apps/web/src/stores/threads-store.ts`
- `apps/web/src/hooks/use-url-tab-sync.ts`
- `apps/web/src/hooks/use-tab-navigate.ts`
- `apps/web/src/hooks/useWorkspaceId.ts`
- `apps/web/src/lib/tab-url.ts`
- `apps/web/src/components/chat-scope/ChatPanel.tsx`
- `apps/web/src/components/chat-scope/RagModeToggle.tsx`
- `apps/web/src/components/agent-panel/agent-panel.tsx`
- `apps/api/src/routes/chat.ts`
- `apps/api/src/routes/threads.ts`
- `apps/api/src/lib/agent-pipeline.ts`
- `apps/api/src/lib/chat-llm.ts` (first 50 lines)
- `docs/review/2026-04-28-completion-claims-audit.md`

---

## HIGH

### S2-001 — `addTab`이 새 탭 포커스하지 않음
**파일**: `apps/web/src/stores/tabs-store.ts:155`
**심각도**: High
**축**: Correctness / UX

```ts
const activeId = s.activeId ?? tab.id;  // 기존 activeId가 있으면 유지
```

"+" 버튼(`tab-bar.tsx:141-155`) 또는 ⌘T 단축키(`shell-providers.tsx:55-68`)가 `addTab`을 호출할 때, 이미 활성 탭이 있으면 `activeId`는 변경되지 않는다. 새 탭이 추가되지만 유저는 이전 탭에 그대로 남는다.

Chrome / VSCode / 브라우저 기본 동작은 "+" → 새 탭 포커스. 현재 동작은 탭이 1개 이상 있을 때만 발생하므로 처음엔 보이지 않는다. `addTab` 에서 `activeId: tab.id`로 바꾸거나, "+" 전용 helper로 분리.

---

### S2-006 — ChatPanel SSE가 실제로 스트리밍되지 않음
**파일**: `apps/web/src/components/chat-scope/ChatPanel.tsx:96-117`
**심각도**: High
**축**: Correctness / Performance
**관련**: completion-claims-audit §11A, Plan 11B-A Tier 1 #2 closed

```ts
const raw = await res.text();  // 전체 SSE body 버퍼링 후 파싱
for (const block of raw.split("\n\n")) { … }
```

Plan 11B-A가 `/api/chat/message`에 실제 LLM streaming(`streamSSE`)을 연결했지만, **ChatPanel 클라이언트는 여전히 `res.text()`로 전체 응답을 버퍼링**한다. 코드 주석(line 26-28)은 "Real LLM streaming arrives in Plan 11B"라고 명시하는데, Plan 11B-A가 서버 측만 바꾸고 클라이언트를 누락했다.

결과: 10초 이상 LLM 응답 중 유저는 아무 토큰도 보지 못한다. `busy` 스피너만 보이고 완성 후 전체 텍스트가 한 번에 나타난다. Tier 1 #2가 서버 측만 닫히고 클라이언트 측은 열려 있다.

Fix: `ReadableStream` + `getReader()`로 교체하거나, EventSource/`eventsource-parser` 라이브러리 도입. `setMessages`를 점진적으로 업데이트.

---

### S2-007 — SSE `event: error`가 ChatPanel에서 무시됨
**파일**: `apps/web/src/components/chat-scope/ChatPanel.tsx:108-113`
**심각도**: High
**축**: Correctness / Missing Features

```ts
if (eventLine === "delta") assistant.content += …;
if (eventLine === "cost") { … }
// event: error 처리 없음
```

`/api/chat/message`는 Gemini 미설정 시 `event: error\ndata: {"code":"llm_not_configured",…}`를 SSE로 전송한다(`chat.ts:440-452`). ChatPanel은 이 이벤트를 파싱하지 않는다. 결과: LLM이 설정되지 않은 fresh OSS 설치에서 유저가 메시지를 보내면 빈 어시스턴트 응답 + ₩0 cost badge만 보인다. 에러 메시지 전혀 없음.

---

## MEDIUM

### S2-002 — threads-store 이중 초기화, 키 불일치
**파일**: `apps/web/src/components/shell/shell-providers.tsx:79-86`, `apps/web/src/components/agent-panel/agent-panel.tsx:48-51`
**심각도**: Medium
**축**: Correctness

`useThreadsStore.setWorkspace`가 두 곳에서 다른 키로 호출된다:
1. `ShellProviders` → `setThreadsWs("ws_slug:${wsSlug}")` — slug 기반
2. `AgentPanel` → `setWorkspace(workspaceId)` — UUID 기반 (`useWorkspaceId` 쿼리 결과)

데이터는 UUID 키 아래 저장되지만(`setActiveThread`에서 `s.workspaceId` 사용), `ShellProviders`가 slug 키로 읽는다. 콜드 캐시에서는 순서가 맞아 떨어지지만, warm cache(5분 이내 재방문)에서 React effect bottom-up 실행 순서에 따라 ShellProviders가 AgentPanel의 올바른 restore를 덮어쓸 수 있다. 결과: active thread가 페이지 새로고침 후 복원되지 않을 위험.

실증: `threads-store.ts:7` `key = (wsId) => \`oc:active_thread:${wsId}\`` — 쓸 때 UUID, 읽을 때 slug 키가 달라 localStorage hit 0.

---

### S2-008 — 메모리 칩이 RAG에 실제로 영향 없음 (UI는 허용)
**파일**: `apps/api/src/routes/chat.ts:396-402`
**심각도**: Medium
**축**: Missing Features / Correctness

```ts
const chips: RetrievalChip[] = (convo.attachedChips as AttachedChip[])
  .filter(c => c.type === "page" || c.type === "project" || c.type === "workspace")
  .map(…);
// memory:l3 / memory:l4 / memory:l2 는 필터에서 제거됨
```

댓글: "Memory chips … retrieval ignores memory:* in v1." 그런데 `AddChipCombobox`는 유저가 메모리 칩 추가를 허용한다. 유저가 memory:l3 칩을 추가해도 retrieval에 영향 0. UI에 어떤 경고도 없음.

---

### S2-009 — /message 엔드포인트 워크스페이스 재검증 없음
**파일**: `apps/api/src/routes/chat.ts:374-376`
**심각도**: Medium
**축**: Security

```ts
if (convo.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);
// canRead(userId, workspace) 호출 없음
```

유저가 워크스페이스에서 제거된 후에도 이전에 생성한 conversation에 메시지를 계속 보낼 수 있다. 대화 내용은 워크스페이스 데이터(RAG retrieval)에 접근한다. `scope → retrieve()`까지 이어지는 경로에서 워크스페이스 멤버십 재검증 필요.

---

### S2-011 — ChatPanel이 `save_suggestion` SSE 이벤트 미처리
**파일**: `apps/web/src/components/chat-scope/ChatPanel.tsx:103-113`
**심각도**: Medium
**축**: Missing Features

`/api/chat/message`는 Plan 11B-A 이후 `event: save_suggestion`을 방출한다(`chat.ts:562-568`). AgentPanel은 `handleSaveSuggestion`으로 처리하지만 ChatPanel은 해당 이벤트를 파싱하지 않아 페이지 스코프 채팅에서 save suggestion이 완전히 유실된다.

---

### S2-010 — 메시지 목록 `key={i}` (배열 인덱스)
**파일**: `apps/web/src/components/chat-scope/ChatPanel.tsx:164`
**심각도**: Medium
**축**: Code Quality

```tsx
{messages.map((m, i) => (
  <div key={i} …>
```

배열 인덱스 key는 메시지 추가/삭제 시 React가 불필요하게 DOM을 재생성한다. `m.id`(서버에서 받는 UUID)를 사용하거나, 클라이언트에서 `crypto.randomUUID()`로 임시 ID 부여.

---

### S2-003 — localStorage 탭 `targetId` 만료 검증 없음
**파일**: `apps/web/src/stores/tabs-store.ts:105-121`
**심각도**: Medium
**축**: Correctness / UX

`loadPersisted`는 localStorage에서 탭을 복원할 때 `targetId`가 여전히 유효한지 확인하지 않는다. 삭제된 노트의 탭이 계속 탭 바에 나타나고, 클릭 시 404나 에러를 유발한다. 탭 복원 시 소프트 validation(예: 노트 탭의 `targetId` HEAD request)을 권장하거나, 에러 시 graceful fallback(노트를 "닫힌 탭"으로 이동).

---

## LOW

### S2-004 — `TabModeRouter` plate 모드 throw (에러 바운더리 없음)
**파일**: `apps/web/src/components/tab-shell/tab-mode-router.tsx:32-33`
**심각도**: Low
**축**: Code Quality

```ts
throw new Error("TabModeRouter received plate mode — …");
```

`isRoutedByTabModeRouter` 가드가 있어 정상 경로에서는 도달 불가하지만, 미래 리팩토링이나 테스트 코드에서 우회 시 `TabShell` 전체가 크래시된다. `tab-shell.tsx`에 에러 바운더리가 없음. `throw` 대신 `console.error` + `<StubViewer>` fallback 권장.

---

### S2-005 — `ingest`/`lit_search` 탭 새로고침 시 dashboard 탭으로 교체
**파일**: `apps/web/src/lib/tab-url.ts:32-36`
**심각도**: Low
**축**: UX / Missing Features

```ts
case "ingest":
case "lit_search":
  return base;  // /w/{slug} — 워크스페이스 기본 URL
```

`ingest`/`lit_search` 탭이 활성 상태에서 새로고침하면 URL이 `/w/{slug}`이므로 `urlToTabTarget`이 `dashboard` kind로 파싱해 ingest/lit_search 탭이 사라진다. 세션 간 상태 복원 불가.

---

### S2-012 — ChatPanel/RagModeToggle 하드코딩 color 토큰
**파일**: `apps/web/src/components/chat-scope/ChatPanel.tsx:169-170`, `RagModeToggle.tsx:30,37`
**심각도**: Low
**축**: Code Quality / i18n (디자인 시스템)

`text-stone-900`, `text-stone-700`, `border-stone-200`, `bg-white` 등 raw Tailwind 색상. 다크 모드 / 팔레트 전환 시 불일치. 시맨틱 토큰(`text-foreground`, `border-border`, `bg-background`) 사용 필요.

---

### S2-013 — RagModeToggle 클릭 외부 닫기 없음
**파일**: `apps/web/src/components/chat-scope/RagModeToggle.tsx:26-60`
**심각도**: Low
**축**: UX / Correctness

커스텀 드롭다운이 click-outside handler나 Escape 키 닫기 없이 구현됨. 다른 영역 클릭 시 드롭다운 잔존. Radix `DropdownMenu` 혹은 `useClickOutside` 훅으로 교체 권장.

---

### S2-014 — /message 토큰 어카운팅 3-write 트랜잭션 없음
**파일**: `apps/api/src/routes/chat.ts:524-560`
**심각도**: Low
**축**: Correctness (데이터 정합성)

user row UPDATE → assistant row INSERT → conversation totals UPDATE 세 쿼리가 트랜잭션 없이 순차 실행. 서버 크래시 시 billing 상태 불일치 가능. 빌링 정밀도 요건이 낮은 초기 단계에서는 허용 가능하나 Plan 9b/Spec B(AI Usage Visibility) 전에 해결 필요.

---

## Anti-pattern 체크리스트 결과

- [x] chat scope 칩 없이 workspace 전체 검색 호출 안 됨 — `chat.ts:380-394` scope 매핑 확인. ✅
- [ ] Strict mode top-k 부족 시 자동 fallback 없음 — `chat-retrieval.ts` 미확인 (Iteration 2에서 검증)
- [x] `search.hybrid(query, scope_chips, mode)` 시그니처 — `chat.ts:466-469` chips + ragMode 전달. ✅
- [x] BYOK · PAYG 사용자 선제 차단 없음 — 채팅 엔드포인트에서 billing gate 없음. ✅
- [x] LLM provider 셀렉트 UI 없음 — ChatPanel/AgentPanel에서 provider UI 없음. ✅
- [ ] 카피 룰 준수 — ChatPanel 하드코딩 색상 있으나 카피(텍스트) 자체는 i18n 키 사용. 완전 점검은 영역 7에서.
- [ ] user-facing 문자열 i18n 키 — ChatPanel.tsx에 `className` 내 한글 없음, 토스트는 `t()`로 처리. ✅ (ChatPanel 범위)

---

## Tier 1 closed 검증 (completion-claims-audit §1.1/§1.2/§1.3)

| Claim | 검증 결과 |
|---|---|
| Tier 1 #1 Phase 4 stub CLOSED | ✅ `agent-pipeline.ts:51` — `runChat()` 호출. echo string 없음 |
| Tier 1 #2 11A placeholder CLOSED | ✅ `chat.ts:463-508` — `runChat()` for-await 스트리밍. "(11A placeholder reply)" 없음 |
| Tier 1 #3 save_suggestion stub CLOSED | ✅ `agent-pipeline.ts` — `AGENT_STUB_EMIT_SAVE_SUGGESTION` env 없음, `chat-llm.ts` fence parser 통해 emit |

**신규 gap**: Tier 1 #2는 서버 측 완료. **클라이언트(`ChatPanel.tsx`) SSE 스트리밍 미구현** (S2-006). 유저 경험 관점에서 절반만 닫힌 상태.

---

## 파일 미확인 (다음 iteration)

- `apps/web/src/lib/chat-retrieval.ts` — Strict/Expand fallback 동작
- `apps/web/src/components/agent-panel/conversation.tsx` — 가상화 여부
- `apps/web/src/components/sidebar/` — react-arborist + dnd-kit
- `apps/web/src/components/palette/` — Cmd+K 등록
