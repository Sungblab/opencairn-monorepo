# Session 2 — Ralph Audit Summary (완료)

**마지막 갱신**: 2026-04-28 (Iteration 4 — 종료 조건 충족)  
**도메인**: App Shell & Chat & Agent UI  
**총 iteration**: 4 (최대 8 중 4)  
**종료 사유**: Critical/High 0건 × 연속 2 iteration (Iteration 3+4)

---

## 최종 발견 현황

| ID | 심각도 | 한 줄 요약 | Iter |
|---|---|---|---|
| **S2-001** | **High** | `addTab` 새 탭 포커스 안 함 (`activeId ?? tab.id` 유지) | 1 |
| **S2-006** | **High** | ChatPanel `res.text()` 전체 버퍼링 — SSE 스트리밍 없음 | 1 |
| **S2-007** | **High** | ChatPanel SSE `event: error` 무시 — LLM 미설정 시 빈 응답 | 1 |
| **S2-026** | **High** | Agent Panel `history: []` 하드코딩 — multi-turn 0 | 2 |
| S2-002 | Medium | threads-store slug/UUID 이중 초기화 불일치 | 1 |
| S2-003 | Medium | localStorage 탭 targetId 만료 검증 없음 | 1 |
| S2-008 | Medium | 메모리 칩 RAG 효과 없음 (UI 허용, 서버 필터) | 1 |
| S2-009 | Medium | /message 워크스페이스 재검증 없음 | 1 |
| S2-010 | Medium | ChatPanel messages `key={i}` 인덱스 | 1 |
| S2-011 | Medium | ChatPanel `save_suggestion` SSE 미처리 | 1 |
| S2-016 | Medium | Regenerate 버튼 silent no-op | 2 |
| S2-017 | Medium | SaveSuggestionCard dismiss local-only | 2 |
| S2-021 | Medium | 사이드바 삭제 `window.confirm()` | 2 |
| S2-022 | Medium | 폴더 확장 실패 시 에러 UX 없음 | 2 |
| S2-025 | Medium | Doc editor slash 기본값 OFF | 2 |
| S2-027 | Medium | Palette "Research" 항상 노출 (feature-gated OFF 시 404) | 3 |
| S2-031 | Medium | Strict/Expand scope 차이 없음, top-k만 다름 | 3 |
| S2-004 | Low | TabModeRouter plate throw, 에러 바운더리 없음 | 1 |
| S2-005 | Low | ingest/lit_search 탭 새로고침 시 dashboard로 교체 | 1 |
| S2-012 | Low | ChatPanel stone-* 하드코딩 색상 | 1 |
| S2-013 | Low | RagModeToggle 외부 클릭 닫기 없음 | 1 |
| S2-014 | Low | /message 토큰 3-write 트랜잭션 없음 | 1 |
| S2-019 | Low | Conversation 메시지 목록 가상화 없음 | 2 |
| S2-023 | Low | 사이드바 EventSource onerror 없음 | 2 |
| S2-024 | Low | 트리 PATCH/DELETE api-client 우회 | 2 |
| S2-028 | Low | Palette "New Note" 커맨드 없음 | 3 |
| S2-029 | Low | Notifications EventSource onerror 없음 | 3 |
| S2-030 | Low | share_invite 발신자 UUID 8자 표시 | 3 |
| S2-032 | Low | OnboardingShell 배너 `kr` 클래스 하드코딩 | 4 |

**합계**: High 4건 · Medium 11건 · Low 14건

---

## High 발견 추이 (종료 조건 추적)

| Iteration | High | Critical | 연속 0건 카운터 |
|---|---|---|---|
| 1 | 3 | 0 | 0 |
| 2 | 1 | 0 | 0 |
| **3** | **0** | 0 | 1 |
| **4** | **0** | 0 | **2 → 종료** |

---

## Tier 1 closed 검증 최종 결과

| Audit §항목 | 서버 측 | 클라이언트 측 |
|---|---|---|
| Phase 4 stub (#1) | ✅ CLOSED | ✅ AgentPanel `use-chat-send.ts` 실 SSE 스트리밍 |
| 11A placeholder (#2) | ✅ CLOSED | ⚠️ ChatPanel `res.text()` 버퍼링 미해결 (S2-006) |
| save_suggestion stub (#3) | ✅ CLOSED | ⚠️ ChatPanel handler 누락 (S2-011) |

---

## 우선순위 수정 권고 (severity 순)

### 즉각 수정 권고

1. **S2-006** — ChatPanel SSE 클라이언트 스트리밍 구현  
   `res.text()` → `ReadableStream.getReader()` + eventsource-parser. `use-chat-send.ts` 패턴을 그대로 적용.

2. **S2-007** — ChatPanel SSE `event: error` 핸들러  
   delta/cost 파싱 이후 error 이벤트 처리 + 에러 메시지 표시.

3. **S2-001** — `addTab` 새 탭 포커스  
   `addTab`에서 `activeId: tab.id` 로 변경 (또는 "+" 버튼 전용 helper로 분리).

4. **S2-009** — /message 워크스페이스 재검증  
   `canRead(userId, { type: "workspace", id: convo.workspaceId })` 호출 추가.

### 단기 수정 권고

5. **S2-026** — Agent Panel history 전달  
   `runAgent` 호출 시 `histRows` 조회 + `history` 파라미터 채우기.

6. **S2-027** — Palette Research 액션 feature-gate  
   `CommandPalette`에 `deepResearchEnabled` prop 추가 → `buildActions`에 전달.

7. **S2-011** — ChatPanel save_suggestion 이벤트 처리  
   `event: save_suggestion` 케이스 추가 후 toast 또는 save 핸들러.

8. **S2-031** — Expand mode workspace-wide fallback  
   `resolveProjectIds`에 ragMode 파라미터 추가, expand에서 칩 결과 부족 시 전체 workspace로 확장.

---

## 긍정적 발견 요약

- `use-chat-send.ts` (AgentPanel) — eventsource-parser 기반 실 SSE 스트리밍, 모든 이벤트 처리, AbortController. **교과서적 구현**.
- `ProjectTree` — react-arborist + ResizeObserver 가상화, 10K 노드 UI 레이어 예산 충족.
- `ByokKeyCard` — password input, lastFour 마스킹, provider 셀렉트 없음, Radix Dialog.
- `notifications.ts` — COALESCE idempotency 패턴 올바름.
- Onboarding — BYOK cost philosophy 준수, guard 체인 올바름.
- i18n 파일 29 네임스페이스 ko/en 쌍 모두 존재.
