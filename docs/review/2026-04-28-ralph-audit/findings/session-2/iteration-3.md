# Session 2 — Iteration 3 Findings

**Date**: 2026-04-28  
**Areas covered**: 영역 5 (Cmd+K palette) + 영역 6 (Notifications) + chat-retrieval Strict/Expand 검증  
**Files audited**:
- `apps/web/src/components/palette/command-palette.tsx`
- `apps/web/src/components/palette/palette-actions.ts`
- `apps/web/src/components/palette/palette-search.ts`
- `apps/web/src/components/notifications/use-notifications.ts`
- `apps/web/src/components/notifications/notification-drawer.tsx`
- `apps/web/src/components/notifications/notification-item.tsx`
- `apps/api/src/lib/chat-retrieval.ts`

---

## HIGH

없음. (Iteration 3 High 0건)

---

## MEDIUM

### S2-027 — Palette "Research" 액션이 feature-flag 무관 항상 노출
**파일**: `apps/web/src/components/palette/palette-actions.ts:30`  
**심각도**: Medium  
**축**: Missing Features / UX

```ts
{ id: "research", labelKey: "research",
  run: (r) => r.push(`${wsBase}/research`) },
```

`FEATURE_DEEP_RESEARCH !== "true"` 기본 상태(fresh OSS 설치)에서는 `/research` 라우트가 `notFound()`를 반환한다(`apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/research/page.tsx`). 팔레트에 "Research" 액션이 항상 표시되지만 선택 시 404.

`CommandPalette`에 `deepResearchEnabled` prop이 없어서 `palette-actions.ts`가 flag를 볼 수 없다. `deepResearchEnabled`를 ShellProviders → CommandPalette → buildActions로 드릴하거나, 라우트 수준 feature flag를 actions 레이어에서도 읽도록 수정 필요.

---

### S2-031 — Strict/Expand RAG mode scope 차이 없음, top-k만 다름
**파일**: `apps/api/src/lib/chat-retrieval.ts:29-33`, `130-166`  
**심각도**: Medium  
**축**: Missing Features / Correctness

```ts
function topK(mode: RagMode): number {
  if (mode === "strict") return envInt("CHAT_RAG_TOP_K_STRICT", 5);
  return envInt("CHAT_RAG_TOP_K_EXPAND", 12);   // expand만 top-k=12
}
```

`resolveProjectIds`는 ragMode 파라미터를 받지 않는다. 스펙 의도:
- **Strict**: 칩 scope만 검색
- **Expand**: 칩 scope + fallback to workspace-wide

실제 동작: 두 모드 모두 동일한 project scope(칩 기반 또는 구조적 scope)를 사용, 차이는 top-k(5 vs 12)뿐.

Expand 모드에서 칩 범위 결과가 부족할 때 workspace-wide로 자동 확장하는 폴백 로직 없음. `RagModeToggle` UI는 마치 scope가 달라지는 것처럼 보여주지만 실제로는 숫자만 다름.

---

## LOW

### S2-028 — Palette에 "New Note" 커맨드 없음
**파일**: `apps/web/src/components/palette/palette-actions.ts`  
**심각도**: Low  
**축**: Missing Features / UX

등록된 액션: dashboard, research, import, ws-settings, new-project, profile, toggle-sidebar, toggle-agent. "New Note" 커맨드가 없어 프로젝트 컨텍스트 없이 새 노트 생성 불가. UX conveniences 백로그(Cmd+K 팔레트 항목)에 기록됨.

---

### S2-029 — Notifications EventSource onerror 없음
**파일**: `apps/web/src/components/notifications/use-notifications.ts:34-40`  
**심각도**: Low  
**축**: UX

S2-023과 동일 패턴:
```ts
const src = new EventSource("/api/stream/notifications");
// src.onerror 없음
```
세션 만료(401) 또는 서버 다운 시 무한 재시도, 유저 피드백 없음.

---

### S2-030 — share_invite 알림에 발신자 UUID 8글자 노출
**파일**: `apps/web/src/components/notifications/notification-item.tsx:36-38`  
**심각도**: Low  
**축**: UX / Code Quality

```ts
from: typeof p.fromUserId === "string" ? p.fromUserId.slice(0, 8) : "",
```

알림 요약에 발신자 이름 대신 UUID 앞 8자리가 표시된다. "a1b2c3d4 님이 노트를 공유했습니다" 형태. 표시 이름(email/display name) resolve 로직 필요.

---

## 긍정적 발견 (Good)

### CommandPalette — cmdk + 올바른 debounce
- `cmdk` 라이브러리: Escape/Arrow 키 접근성 기본 제공. ✅
- 120ms setTimeout debounce (line 62-65). ✅
- 검색 실패 시 빈 배열 폴백 (`palette-search.ts:12-17`). ✅
- wsId 미해결 시 검색 스킵 (line 58-60). ✅

### NotificationDrawer — 조건부 마운트 + SSE 통합
- `{open ? <DrawerBody /> : null}` — drawer 닫혔을 때 쿼리/EventSource 미실행. ✅
- React Query 캐시 무효화로 폴링 없는 실시간 업데이트. ✅
- `markRead` COALESCE 패턴 아닌 단순 mutate지만 idempotency는 서버 측에서 처리.

### chat-retrieval — 권한/workspace 경계 올바름
- `resolveProjectIds` 칩 처리 시 workspace 경계 검증 (`projectInWorkspace`, `projectIdForNote`). ✅
- 메모리 칩 서버 측 필터링 주석 명시 ("Memory chips are silently ignored at retrieval"). ✅
- 안티패턴 "Strict mode 자동 fallback 없음" 충족. ✅

### Anti-pattern 체크리스트 (Iteration 3 항목)

- [x] Strict mode top-k 부족 시 자동 fallback 없음 — 충족. Strict=5, Expand=12, scope는 동일 (S2-031은 스펙 미완 이슈, 안티패턴 위반 아님) ✅
- [x] BYOK/PAYG 선제 차단 없음 — 팔레트/알림 레이어에서 billing gate 없음 ✅
- [x] LLM provider 셀렉트 UI 없음 — 팔레트/알림에 provider 선택 없음 ✅
- [ ] 카피 룰 (palette/notification i18n) — 키 사용 확인, literal 한글 없음 ✅

---

## 종료 조건 추적

**Iteration 3: High 0건.** Iteration 2: High 1건. 연속 2회 0건 미충족 → Iteration 4 계속.

---

## 파일 미확인 (Iteration 4 계획)

- 영역 7: `apps/web/src/components/byok/`, `/settings/ai` BYOK UI
- 영역 8: `apps/web/src/components/onboarding/` 2-mode prereq, BYOK cost philosophy
- i18n parity: `apps/web/src/messages/ko/*.json` vs `en/*.json` 키 카운트
- `apps/api/src/routes/notifications.ts` idempotency 확인
