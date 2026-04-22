# Sidebar Design (exploring — not a decision)

> **Status: exploring** (2026-04-23). Notion 대체 포지션의 1차 진입 인상이 사이드바라는 판단 하에, **"리눅스급 성능 + macOS/Windows급 GUI"** 기준으로 구조와 성능 예산을 먼저 박아두는 문서. **결정 아님.**

## 1. 왜 별도 문서인가

- 모든 기능(편집/탭/검색/공유)의 진입 지점. 느린 순간 하나가 전체 제품 인상을 결정
- Plan 2A(에디터)·2B(협업)·2E(Tab shell) 사이에 **사이드바 재설계**를 끼워넣지 않으면, 나중에 탭이 붙고 기능이 붙은 상태에서 성능 부채를 뒤에서 찢어내야 함
- 백엔드(트리 로딩/권한/SSE)와 프론트엔드(가상화/드래그드롭/키보드)가 동시에 엮인 **아키텍처 결정**이므로 UX 백로그와 분리

## 2. 성능 예산 (통과 기준)

| 지표 | 목표 | 비고 |
|------|------|------|
| 워크스페이스 10K 페이지 초기 렌더 | **< 500ms** | 대형 조직도 버티는 수준 |
| 폴더 확장 (1K 자식) | **< 100ms** | 체감 즉시 |
| 드래그-드롭 이동 1개 (낙관적) | **< 50ms** | Finder 급 |
| 사이드바 퍼지 검색 결과 | **< 50ms** | 타이핑 붙는 속도 |
| 리사이저 드래그 | **60fps 유지** | macOS 느낌 |

이 숫자는 합의 후 수정. 벤치마크는 E2E + Lighthouse 조합.

## 3. 백엔드 구조

- **트리 구조**: `pages.parent_id` 이미 있음 + **materialized path** (`ltree`) 또는 **closure table** 중 택일. 이동/하위카운트 N+1 방지가 목적
- **Lazy children**: `GET /api/pages/tree?parent_id=X` — 열 때만 로드, 기본 2단계 프리패치
- **권한 배칭**: workspace-level 권한은 sidebar mount 시 **1회 배치 fetch** → 클라 캐시. 렌더 루프에서 per-node 권한 체크 금지
- **실시간 업데이트 채널**: 페이지 메타(제목 변경/이동/삭제)는 **SSE 전용** (`/api/stream/pages`). Yjs awareness 사용 금지 (편집 cursor마다 사이드바 리렌더되는 사고)

## 4. 프론트엔드 구조

**후보 스택**:
```
react-arborist (virtualized tree)
  + @dnd-kit/core (drag-drop, 접근성 포함)
  + Zustand (UI state, selector 기반 구독)
  + React Query (server state)
  + SSE hook (/api/stream/pages for 메타)
  + cmdk 연동 (⌘K 글로벌 팔레트에서 사이드바 액션 호출)
```

선정 근거:
- `react-arborist` — 가상화·키보드·드래그 내장, Linear/유사 UX에 채용 사례 다수
- `@dnd-kit` — react-dnd는 레거시. dnd-kit이 접근성·터치·modern React 기준
- `cmdk` — 글로벌 Command Palette와 짝

## 5. GUI 체크리스트 (macOS/Windows 수준)

핵심:
- [ ] 키보드 완전 커버: ↑↓ / → 펼침 / ← 닫힘 / Enter 열기 / F2 rename / Space 미리보기 / Cmd+Del 삭제
- [ ] **Type-ahead** — 포커스 상태에서 타이핑 시 접두사 점프
- [ ] **Multi-select** — Shift+클릭 범위, Cmd+클릭 토글
- [ ] **Inline rename** — double-click 또는 F2, Enter 확정 / Esc 취소
- [ ] **Context menu** — 우클릭과 `…` 버튼이 **동일 컴포넌트 공유**
- [ ] **Drag 피드백** — 위/아래/안쪽 3-way 드롭존 하이라이트, 그림자 커서
- [ ] **리사이저** 드래그 + 더블클릭 리셋
- [ ] **사이드바 토글** `Cmd+\` (VSCode 패리티)
- [ ] **Collapsed state 영속화** — 세션 간

섹션 구분:
- [ ] Favorites / 즐겨찾기
- [ ] Recently visited
- [ ] Private / Shared 분리 (Notion 패턴)

배지/아이콘:
- [ ] 페이지 이모지/아이콘 (Notion 수준)
- [ ] 공개 링크, 댓글, 멘션, presence 배지

## 6. 지뢰 (미리 박아둠)

- **React reconciliation 폭탄**: 부모 리렌더 시 수천 노드 전부 재렌더. `memo` + `areEqual` + Zustand selector로 구독 분리 필수
- **Yjs awareness를 사이드바에 연결하는 실수**: 편집 cursor 이벤트마다 리렌더. 사이드바는 Yjs 미사용, SSE 메타만
- **렌더 루프 안의 per-node 권한 체크**: workspace 마운트 시 1회 배치 → 렌더는 순수 데이터
- **드래그 중 실제 DB write**: preview만, 놓기 시점 1회 write + 낙관적 UI + 실패 롤백 토스트

## 7. Open Questions

- [ ] Closure table vs `ltree` — 성능·쿼리 단순성·이동 비용 비교
- [ ] `react-arborist` 의 커스터마이즈 한계 (이모지/배지/인라인 rename 자유도)
- [ ] Multi-workspace switcher 위치 (상단 dropdown vs 별도 shell)
- [ ] 모바일 드로어 UX — 같은 컴포넌트 재사용 가능한지

## 8. Next Steps

1. **Plan 2F (Sidebar Redesign)** 제안 문서 작성 검토 — Plan 2B 마무리 후, Plan 2E(Tab shell) 전
2. `react-arborist` + `@dnd-kit` POC — 10K 노드 렌더·드래그 벤치 확인
3. 백엔드: closure table vs `ltree` ADR
4. SSE `/api/stream/pages` 스펙
5. GUI 체크리스트 전부 케이스로 쪼개서 Plan task 목록화
