# Session 1 — Editor & Realtime Collab: Audit Summary

> **Status**: **TERMINATED at Iteration 3** — Critical/High 0건 × 연속 2 iteration (Iter 2 + Iter 3)
> **범위**: Plan 2A/2B/2C/2D, App Shell Phase 3/4, Plan 11B Phase A 관련 에디터·협업 레이어
> **실행 iteration**: 3 / max 8

---

## 발견 전체 목록 (누적)

| ID | 심각도 | 영역 | 한 줄 요약 | 상태 |
|---|---|---|---|---|
| S1-001 | High | Slash / Editor | SlashMenu 전역 keydown: PlateContent 포커스 미확인 → 타이틀/댓글 입력 시 에디터 문자 삭제 가능 | 미해결 |
| S1-002 | High | Hocuspocus Auth | 클라이언트 `token:""` → 서버 인증 미동작 가능성 (연결 전면 거절 or 인증 우회) | **검증 필요** |
| S1-003 | High | Hocuspocus Security | `HOCUSPOCUS_ORIGINS` env 파싱되지만 `Server({origins})` 미전달 → 오리진 검증 무효 | 미해결 |
| S1-004 | Medium | WikiLink | WikiLinkCombobox Cmd+K 전역: 에디터 외 컨텍스트에서 열림 + 에디터에 삽입 | 미해결 |
| S1-005 | Medium | WikiLink | 노트 검색 debounce 없음 → 키 입력마다 API 요청 발사 | 미해결 |
| S1-006 | Medium | Hocuspocus Perf | `storeImpl` 매 호출마다 전체 Y.Doc 재구성 (CPU spike) | 미해결 |
| S1-007 | Medium | Share | share link 만료(expiresAt) 미시행 + 추적 이슈 없음 | 미해결 |
| S1-008 | Low | Comment | @mention raw token: 서버 workspace 귀속 검증 미확인 → S1-011로 승격 확인 | ✅ 해소 (S1-011) |
| S1-009 | Low | Slash | SlashMenu 구분선 `i===8` 하드코딩 | 미해결 |
| S1-010 | Low | Presence | PresenceStack awareness cleanup 안전성 | ✅ 안전 확인 |
| S1-011 | Medium | Comment / Security | @mention token 크로스-워크스페이스 알림 injection — workspace 귀속 검증 미실시 | 미해결 |
| S1-012 | Medium | Comment / UX | 코멘트 author 이름 미표시 — UUID 앞 8자 노출 (Plan 2B 미완성 피처) | 미해결 |
| S1-013 | Low | Share / i18n | share.ts 알림 본문 한국어 하드코딩 — i18n 파이프라인 외부 | 미해결 |
| S1-014 | Low | Comment | CommentThread orphan 라벨 판별 heuristic 오류 — 페이지-레벨 코멘트 오표시 | 미해결 |
| S1-015 | Low | Comment | 블록-앵커 코멘트 `canWrite` 전용 — commenter 역할 제한, UI 미처리 | 미해결 |
| S1-016 | Low | Editor Perf | MermaidFencePlugin onChange: O(N) 전체 최상위 노드 순회 (대형 문서 비효율) | 미해결 |

---

### 검증 완료 (Completion Claims Audit 항목 클리어)

| ID | 내용 | 결론 |
|---|---|---|
| — | Plan 2D save_suggestion AGENT_STUB 제거 (Tier 1 §1.3) | ✅ CLOSED |
| — | Plan 11B Phase A Agent Panel echo stub 제거 (Tier 1 §1.1) | ✅ CLOSED |
| — | Chat LLM 실 연동 (11A placeholder 제거, Tier 1 §1.2) | ✅ CLOSED |

---

## 심각도별 집계 (최종)

| 심각도 | 건수 | ID |
|---|---|---|
| Critical | 0 | — |
| High | 3 | S1-001, S1-002, S1-003 |
| Medium | 5 | S1-004, S1-005, S1-006, S1-007, S1-011, S1-012 (6건) |
| Low | 6 | S1-009, S1-013, S1-014, S1-015, S1-016 (5건, S1-010 해소) |

> *정정: Medium 실제 6건 (S1-004/005/006/007/011/012)*

---

## Iteration별 High/Critical 집계

| Iteration | 범위 | Critical | High | 종료 조건 |
|---|---|---|---|---|
| 1 | Editor Core + Slash + WikiLink + Hocuspocus Auth/Security | 0 | 3 | — |
| 2 | Hocuspocus 심층 + Comments + @mention + Share | 0 | 0 | 1/2 |
| 3 | 에디터 블록 요소 + Mermaid + DocEditor + 공유 토큰 | 0 | 0 | **2/2 → 종료** |

---

## Plate v49 §8 체크리스트 결과 (누적)

- [x] `from '@platejs/core/react'` 직접 import 금지 ✅ 준수
- [x] `BasicNodesKit`, `MathKit` bundle export 사용 안 함 ✅ 준수
- [x] `Plugin.withComponent(Component)` 패턴 ✅ 준수
- [x] `editor.tf.toggleMark` / `editor.tf.toggleBlock` 사용 안 함 ✅ 준수 (per-plugin toggle)
- [x] `<Plate onValueChange>`, 바디 `<PlateContent>` ✅ (`onValueChange` 미사용이지만 Yjs 경로이므로 정상)
- [x] hocuspocus origin 명시 검증 ❌ **S1-003 미해결**
- [x] iframe `allow-scripts allow-same-origin` 금지 ✅ (에디터 영역 적용 없음, Canvas는 별도 세션)
- [x] `editor.tf.replaceNodes` (Mermaid) ✅ 올바른 v49 API
- [x] `@platejs/layout/react` columns 직접 사용 ✅

---

## 우선순위 수정 권고 (High 먼저)

1. **S1-001** (High): SlashMenu keydown 포커스 가드 — `PlateContent` 포커스 여부 확인 후 메뉴 열기
2. **S1-002** (High): Hocuspocus `token: ""` — 클라이언트 쿠키 전달 또는 서버 cookie-fallback 인증 경로 추가
3. **S1-003** (High): `origins` 옵션 `Server({})` 에 전달
4. **S1-011** (Medium): @mention workspace 귀속 검증 — `workspaceMembers` 테이블 필터
5. **S1-012** (Medium): 코멘트 author name JOIN + `CommentResponse.authorName` 추가
