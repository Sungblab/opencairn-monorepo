# Session 2 — Iteration 2 Findings

**Date**: 2026-04-28  
**Areas covered**: 영역 3 (Agent Panel + Doc Editor 슬래시) + 영역 4 (사이드바 트리)  
**Files audited**:
- `apps/web/src/components/agent-panel/agent-panel.tsx`
- `apps/web/src/components/agent-panel/conversation.tsx`
- `apps/web/src/components/agent-panel/message-bubble.tsx`
- `apps/web/src/hooks/use-chat-send.ts`
- `apps/api/src/lib/agent-pipeline.ts`
- `apps/api/src/routes/doc-editor.ts`
- `apps/web/src/components/sidebar/project-tree.tsx`
- `apps/web/src/components/sidebar/shell-sidebar.tsx`
- `apps/web/src/hooks/use-project-tree.ts`
- `apps/web/src/hooks/use-tab-mode-shortcut.ts`

---

## HIGH

### S2-026 — Agent Panel LLM history 항상 빈 배열
**파일**: `apps/api/src/lib/agent-pipeline.ts:56`  
**심각도**: High  
**축**: Missing Features / Correctness

```ts
for await (const chunk of runChat({
  …
  history: [],   // 항상 빈 배열
  userMessage: opts.userMessage.content,
```

`Conversation` 컴포넌트는 `useChatMessages`로 이전 턴을 UI에 표시하지만, LLM에 전달되는 history는 `[]`이다. 유저가 "아까 말한 것처럼" / "이전 답변을 기반으로" 식으로 참조하면 LLM이 맥락 없이 답한다.

코멘트: "History reload is out of scope for v1 — the agent panel renders prior turns from chat_messages on its own." — 의도적 gap이지만 "채팅" 인터페이스를 표방하는 제품에서 multi-turn statefulness 0은 사용자 신뢰 훼손 위험. `plans-status` ✅ Phase 4, ✅ Plan 11B-A에 이 gap의 추적 이슈가 없음.

---

## MEDIUM

### S2-016 — Regenerate 버튼 silent no-op
**파일**: `apps/web/src/components/agent-panel/conversation.tsx:60-63`  
**심각도**: Medium  
**축**: UX / Missing Features

```ts
onRegenerate={() => {
  // Plan 11A wires regenerate; Phase 4 leaves it as a no-op so the
  // action button doesn't disappear and reflow the row mid-thread.
}}
```

`MessageActions` 컴포넌트에 regenerate 버튼이 렌더링되지만 동작이 없다. disabled 상태도, tooltip도, visual indicator도 없다. 유저가 누르면 아무 일도 일어나지 않는다.

---

### S2-017 — SaveSuggestionCard dismiss가 local-only, 재로드 후 복원
**파일**: `apps/web/src/components/agent-panel/conversation.tsx:116-119`  
**심각도**: Medium  
**축**: UX / Missing Features

```ts
onDismiss={() => {
  /* dismissal is local-only until Phase 4 wires the persisted state */
}}
```

유저가 "닫기"를 클릭해도 `content.save_suggestion` 필드는 DB에 남는다. 페이지 새로고침 또는 스레드 재로드 시 카드가 다시 나타난다. `message-bubble.tsx:112-120`에서 `msg.content.save_suggestion`을 직접 참조하기 때문.

---

### S2-021 — `window.confirm()` 삭제 확인 다이얼로그
**파일**: `apps/web/src/components/sidebar/project-tree.tsx:185-199`  
**심각도**: Medium  
**축**: UX / Code Quality

```ts
const confirmed = window.confirm(t("confirm_delete", { label }));
```

`window.confirm`는:
1. 메인 스레드 블로킹
2. iOS Safari (일부 모드) + PWA에서 미지원
3. Radix AlertDialog 디자인 시스템과 불일치
4. 키보드 접근성 미흡 (포커스 관리 없음)

Radix `AlertDialog` 또는 커스텀 modal 교체 필요.

---

### S2-022 — 폴더 확장 실패 시 에러 UX 없음 (빈 폴더 표시)
**파일**: `apps/web/src/components/sidebar/project-tree.tsx:130-139`  
**심각도**: Medium  
**축**: UX / Correctness

```ts
await loadChildren(id).catch(() => {
  /* useProjectTree owns error UX via its SSE re-sync */
});
```

폴더 확장(`handleToggle`) 중 API 실패 시 폴더가 expanded 상태로 표시되지만 children은 빈 배열. `sidebar-store`의 `expanded` 세트는 이미 업데이트됐기 때문에 에러 후 자동 복원 없음. SSE가 재연결되더라도 `loadChildren`이 실패한 노드는 re-sync 트리거가 없음 (`tree.*_created` 등의 이벤트가 없으면 무한 빈 상태). 에러 시 토스트 + `toggleExpanded(id)` 롤백 필요.

---

### S2-025 — Doc editor slash 기본값 OFF (OSS 설치 시 기능 미노출)
**파일**: `apps/api/src/routes/doc-editor.ts:37-42`  
**심각도**: Medium  
**축**: Missing Features

```ts
const enabled =
  (process.env.FEATURE_DOC_EDITOR_SLASH ?? "false").toLowerCase() === "true";
if (!enabled) return c.json({ error: "not_found" }, 404);
```

Plan 11B-A의 핵심 deliverable인 4개 LLM 슬래시 커맨드(`/summarize`, `/rewrite`, `/translate`, `/explain`)가 `FEATURE_DOC_EDITOR_SLASH=false` 기본값으로 fresh OSS 설치에서 모두 비노출. 마찬가지로 web 측 슬래시 메뉴도 게이트 여부 확인 필요 (Iteration 3에서 검증).

`.env.example`에 `FEATURE_DOC_EDITOR_SLASH` 설명/기본값 안내가 있는지 확인 필요.

---

## LOW

### S2-019 — Conversation 메시지 목록 가상화 없음
**파일**: `apps/web/src/components/agent-panel/conversation.tsx:56-67`  
**심각도**: Low  
**축**: Performance

```tsx
{messages.map((m) => (
  <MessageBubble key={m.id} … />
))}
```

`MessageBubble`은 `key={m.id}` 사용 (OK). 그러나 메시지 수 무제한 렌더링. 100+ 턴 스레드에서 DOM 비대 가능. `use-chat-messages.ts`가 전체 히스토리를 한 번에 로드하는 경우 초기 렌더 비용이 커짐. @tanstack/virtual 또는 react-window 도입 권장 (현 단계에서 낮은 위험).

---

### S2-023 — EventSource onerror 핸들러 없음
**파일**: `apps/web/src/hooks/use-project-tree.ts:78-127`  
**심각도**: Low  
**축**: UX / Correctness

```ts
const src = new EventSource(…, { withCredentials: true });
// src.onerror 없음
```

401 (세션 만료) 또는 서버 다운 시 EventSource는 자동 재시도를 무한 반복한다. 유저에게 "연결 끊김" 알림 없음, 탭 닫을 때까지 백그라운드 polling 지속.

---

### S2-024 — 트리 PATCH/DELETE가 api-client를 우회
**파일**: `apps/web/src/components/sidebar/project-tree.tsx:48-92`  
**심각도**: Low  
**축**: Code Quality

`persistMove`, `persistRename`, `persistDelete`가 직접 `fetch()`를 호출한다. 공유 `api-client` 또는 `chatApi` 패턴을 따르지 않아, 향후 인증 헤더 / 에러 인터셉터 추가 시 누락 위험.

---

## 긍정적 발견 (Good)

### use-chat-send.ts — SSE 스트리밍 올바르게 구현
`apps/web/src/hooks/use-chat-send.ts`는 `eventsource-parser` + `ReadableStream.getReader()`로 실제 토큰 스트리밍을 구현한다. 모든 이벤트 타입(text/thought/status/citation/save_suggestion/error/done) 처리, AbortController 중복 전송 방지, 서버 에러 toast 표시. **ChatPanel(S2-006/S2-007)과 정반대의 품질**.

### ProjectTree — react-arborist 가상화 정상
`project-tree.tsx:113-126` ResizeObserver 기반 `observedHeight` + `rowHeight=28`. 10K 노트의 경우 보이는 행만 렌더링. 초기 로드는 root만, 이후 lazy expansion. 10K 페이지 500ms 예산은 **API 레이어(DB 쿼리)에 달려 있고 UI 레이어는 충족**한 것으로 판단.

### ⌘⇧R 탭 모드 토글 — 정상 구현
`use-tab-mode-shortcut.ts` — plate ↔ reading 토글, 다른 모드에서는 의도적으로 무시. 정상.

---

## 파일 미확인 (다음 iteration 커버)

- `apps/web/src/components/palette/` — Cmd+K 등록, 권한 필터
- `apps/web/src/components/notifications/` — 5 알림 타입, badge polling
- `apps/web/src/components/byok/` — BYOK 키 등록/삭제/마스킹
- `apps/api/src/lib/chat-retrieval.ts` — Strict/Expand fallback 동작 검증
- Doc editor 슬래시 web 측 게이트 여부
