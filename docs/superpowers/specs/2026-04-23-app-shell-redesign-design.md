# App Shell Redesign — Design Spec

**Date:** 2026-04-23
**Status:** Draft (approved in brainstorm 2026-04-23)
**Supersedes:**
- `docs/superpowers/specs/2026-04-20-tab-system-design.md`
- `docs/architecture/sidebar-design.md`

**References (still authoritative for their domain):**
- `docs/superpowers/specs/2026-04-20-agent-chat-scope-design.md` — 스코프 칩 · 메모리 4계층
- `docs/superpowers/specs/2026-04-21-plan-11b-chat-editor-knowledge-loop-design.md` — 저장 제안 · provenance · slash
- `docs/superpowers/specs/2026-04-22-agent-humanizer-design.md` — thought bubble · status line
- `docs/superpowers/specs/2026-04-22-model-router-design.md` — 5 모드 (auto/fast/balanced/accurate/research)
- `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md` — Research lifecycle UI
- `docs/architecture/ux-conveniences.md` — Daily Notes · Web Clipper backlog
- `docs/architecture/text-search.md` — 전역 텍스트 검색 (Palette 통합)
- `docs/architecture/billing-routing.md` — 모드별 billing 경로

**Related plans:**
- Plan 2E (Tab Shell) + Plan 2F (Sidebar Redesign) → 본 spec으로 통합, 단일 `Plan App Shell Redesign`
- Plan 2A (Editor Core) · Plan 2B (Collab) · Plan 2D (Chat Renderer) — 흡수 소비자
- Plan Deep Research Phase D — Phase 4/5 와 동시 진행

---

## 1. 설계 철학

Notion 대체 포지션이지만 Notion과 다른 모델. **프로젝트가 격리 경계, 내부는 다중 작업(탭) 동시 진행.** Cursor처럼 에디터가 중심이고 AI 채팅은 부속이다.

### 1.1 4대 원칙

1. **프로젝트 = 격리 경계, 내부 자유** — 폴더/노트 이동은 프로젝트 내부에서만 허용. 프로젝트 경계를 넘는 이동은 없다(복사만 가능). 사이드바 트리는 "현재 프로젝트만" 보여준다. Notion식 평탄 펼침 금지.
2. **Editor primary, chat secondary** — 탭이 작업 공간, AI는 우측 패널의 부속. Cursor 모델. 사이드바·탭·AI 패널 세 영역 중 탭이 가장 크고, 나머지 둘은 토글 가능한 dock.
3. **데스크톱 우선** — `≥1024px`가 본 제품 경험. `640~1023px`와 `<640px`는 degrade 대상이며, 모든 기능 패리티를 목표로 하지 않는다.
4. **탭 = 작업 단위** — 단순 렌더러 컨테이너 아님. `(콘텐츠, 모드, 스크롤 위치, AI 제안 pending, 분할 파트너)` 를 묶은 unit.

### 1.2 왜 재설계인가

- Plan 2A/2B 동안 에디터 단독으로 돌고 있던 구조를, 탭/사이드바/AI 패널이 맞물리는 3축 셸로 승격.
- 기존 `tab-system-design`은 sessionStorage 단일 스택을 가정했지만 workspace 스위칭이 실제 제품에서 주요 이용 패턴으로 드러남 — per-workspace 스코프 필요.
- 기존 `sidebar-design`은 architecture draft에 머물러 실행 spec이 없었음 — 프로젝트 격리 모델과 UI 세부를 묶어 실행 가능한 단일 문서로 통합.
- Deep Research Phase D가 UI 결정을 대기하고 있음 — research hub/run 라우트를 shell 안에 위치시켜야 진행 가능.

---

## 2. 전체 레이아웃

### 2.1 3영역 셸

```
┌──────────────┬──────────────────────────────────┬──────────────────┐
│              │ [Tab Bar]                        │ [AI Agent Panel] │
│  Sidebar     │ [📄 대시보드] [📄 노트 ●] [+]    │ 타이틀 · + · ··· │
│  (240px)     ├──────────────────────────────────┤                  │
│              │                                  │  대화 영역       │
│ 워크스페이스 │   TabModeRouter                  │  (스레드)        │
│ 스위처       │                                  │                  │
│              │   현재 모드에 맞는 뷰            │                  │
│ 전역 nav 4칸 │   (plate / artifact / ...)       │                  │
│              │                                  │  스코프 칩 row   │
│ 프로젝트     │                                  │                  │
│ 히어로 ▾     │                                  │  입력창          │
│              │                                  │  (360px,         │
│ 검색         │                                  │   collapsible)   │
│              │                                  │                  │
│ 트리         │                                  │                  │
│              │                                  │                  │
│ 푸터(유저)   │                                  │                  │
└──────────────┴──────────────────────────────────┴──────────────────┘
```

### 2.2 너비 스펙

| 영역 | 기본 | 최소 | 최대 | 리사이즈 | 영속화 |
|------|------|------|------|----------|--------|
| Sidebar | 240px | 180 | 400 | 드래그 + 더블클릭 리셋 | user-global (localStorage) |
| Main | `flex-1` | — | — | — | — |
| Agent Panel | 360px | 300 | 560 | 드래그 + 더블클릭 리셋 | user-global (localStorage) |

### 2.3 토글 단축키

| 단축키 | 동작 | 근거 |
|--------|------|------|
| `⌘\` | 사이드바 토글 | VSCode 패리티 |
| `⌘J` | 에이전트 패널 토글 | 기존 spec 유지 |

`⌘\`는 기존 spec에서 split pane이 사용하던 단축키였지만, 사이드바 토글이 보편 표준이므로 우선권을 바꾸고 split pane을 `⌘⇧\`로 이동한다(§5.6).

### 2.4 반응형 요약

- `≥1024px` — 풀 3패널 (기본)
- `640~1023px` — 사이드바/에이전트 모두 `Sheet` 오버레이, 탭 단독 메인
- `<640px` — 탭 단독, split pane 자동 해제

자세한 레이아웃 전환 규칙은 §10.

---

## 3. 라우팅 모델

### 3.1 URL 스키마

```
/                                   → 루트. 로그인 상태면 last viewed workspace로 redirect
/w/<workspaceSlug>/                 → 대시보드 탭
/w/<workspaceSlug>/n/<noteId>       → 노트 탭
/w/<workspaceSlug>/p/<projectId>    → 프로젝트 뷰 탭
/w/<workspaceSlug>/research         → Research 허브 탭
/w/<workspaceSlug>/research/<runId> → Research 상세 탭
/w/<workspaceSlug>/import           → 임포트 탭
/w/<workspaceSlug>/settings/*       → 워크스페이스 admin 탭 (멤버·초대·통합·공유·휴지통)
/settings/*                         → 계정 레벨 (shell 바깥, full-page)
/settings/profile                   →   프로필·언어·타임존
/settings/providers                 →   BYOK 키 관리
/settings/security                  →   비밀번호·세션
/settings/billing                   →   구독·크레딧·인보이스
/auth/login, /auth/signup           → 인증 (shell 바깥)
/onboarding                         → 최초 설정 (shell 바깥)
```

`workspaceSlug`는 워크스페이스 생성 시 생성되는 URL-safe 식별자. 변경 가능하면 별도 redirect 테이블 필요(v1 미지원, workspace admin에서 변경 시 옛 slug에 임시 redirect 배치하는 방안은 §14).

### 3.2 URL ↔ 탭 동기화 규칙

URL이 authoritative. 네 가지 규칙으로 동작:

1. **URL 변경 감지** (외부 진입, 브라우저 back/forward): 해당 `(kind, targetId)`를 가진 탭이 현재 워크스페이스 스택에 있으면 → `active` 전환. 없으면 → 새 탭 생성 + active.
2. **탭 클릭** (사용자가 탭 바에서 다른 탭 선택): `router.replace(tabUrl)` — 브라우저 history에 쌓지 않음.
3. **새 탭 생성** (사이드바 클릭, 딥링크 진입, AI SSE `tab_open` 이벤트 등): `router.push(tabUrl)` — 브라우저 history 누적.
4. **탭 닫기**: 닫히는 탭이 active였으면 → 우측 이웃 탭의 URL로 `router.replace`. 마지막 탭이었으면 → `/w/<slug>/` (대시보드로 fallback).

### 3.3 딥링크 동작

| 상황 | 동작 |
|------|------|
| 권한 있음 | 해당 라우트 진입, 탭 생성/활성화 |
| 권한 없음 | 403 페이지(shell 바깥, "이 페이지는 공유되지 않았습니다") |
| 삭제된 대상 | 404 페이지(shell 바깥) |
| 워크스페이스 슬러그 unknown | 404 |
| 로그아웃 상태 | `/auth/login?next=<원래 URL>` |

### 3.4 브라우저 history semantics

브라우저 back = URL history back. 새 탭 열기(사이드바 클릭·딥링크)는 history에 누적, 탭 클릭 전환은 쌓지 않음.

결과:
- "뒤로가기"가 "방금 연 것 취소"처럼 직관적으로 동작.
- VSCode와 달리 **탭 자체의 별도 back stack은 두지 않는다** (기존 `tab-system-design` §3.1의 `history`/`historyIdx` 제거). URL history가 그 역할을 담당한다.
- Scroll restoration은 각 탭의 `scrollY` 필드가 담당(§5.2).

---

## 4. 사이드바

### 4.1 구조 (위→아래)

```
┌─────────────────────────────────┐
│ [K] 김성빈 워크스페이스 ▾       │  워크스페이스 스위처
├─────────────────────────────────┤
│ [홈] [Res] [임포트] [⋯]          │  전역 nav (4 icon, hover 툴팁)
├─────────────────────────────────┤
│ 투자노트 ▾                      │  프로젝트 히어로
│                                 │
│ [🔍 이 프로젝트에서 검색   ⌘K] │  스코프 검색 shortcut
├─────────────────────────────────┤
│ 폴더 · 문서                  +  │  트리 섹션 헤더
│ ▸ 2026 Q2 포트폴리오 리뷰   24 │  react-arborist
│   ├ AI 인프라 트렌드            │  + dnd-kit
│   ├ 반도체 공급망 분석          │  indent guide line
│   └ ... 20개 더                 │
│ ▸ 경쟁사 분석                5 │
│ ▾ 매크로 자료                3 │
│                                 │
├─────────────────────────────────┤
│ [S] 김성빈 Pro ₩12,300  🔔 ⚙  │  푸터
└─────────────────────────────────┘
```

### 4.2 워크스페이스 스위처

- 상단 `[K] 김성빈 워크스페이스 ▾`. `[K]`는 워크스페이스 이니셜 아바타(16px), 이름은 14px semibold.
- 드롭다운 내용:
  - 소속 워크스페이스 전체 (아바타 + 이름 + 역할 배지 `Owner/Admin/Editor/Viewer`)
  - 초대 대기 중인 워크스페이스 (별도 섹션, accept/decline 버튼)
  - `+ 새 워크스페이스` 버튼
- 스위치 동작은 §9 workspace switch semantics.
- Hover 시 현재 워크스페이스 전체 이름을 툴팁으로(긴 이름 truncate 대비).

### 4.3 전역 nav (4 icon)

| 아이콘 | 대상 | URL | Hover 툴팁 |
|--------|------|-----|------------|
| 🏠 홈 | 대시보드 | `/w/<slug>/` | "대시보드" |
| 🔬 Deep Research | Research 허브 | `/w/<slug>/research` | "Deep Research" |
| ⬇ 임포트 | 임포트 탭 | `/w/<slug>/import` | "가져오기" |
| ⋯ 더보기 | 팝오버 | — | "더보기" |

클릭은 §3.2 rule 3 (새 탭 생성).

**`⋯` 더보기 팝오버 항목**:
- 템플릿 갤러리
- 공유 링크 관리
- 휴지통
- 워크스페이스 설정 (`/w/<slug>/settings`)
- 피드백 보내기
- 무엇이 새로운가 (changelog)

### 4.4 프로젝트 히어로

- 현재 프로젝트 이름 14px semibold + `▾` 드롭다운 트리거.
- 드롭다운 내용:
  - 현재 워크스페이스의 전체 프로젝트 리스트 (최근 활동 순)
  - `+ 새 프로젝트` 버튼 (클릭 시 모달)
  - 검색 input (프로젝트 많을 때, ≥10개부터)
- 히어로 아래 별도 표시하지 않는 메타(페이지 개수, 마지막 활동 등)는 **프로젝트 뷰 탭**에서 노출 (§7).

**프로젝트 없을 때**: 히어로가 `"프로젝트를 만들어 시작하세요"` CTA로 교체. 트리 영역은 empty state 일러스트 + `+ 프로젝트 만들기` 버튼.

### 4.5 스코프 검색

- `🔍 이 프로젝트에서 검색` 박스 — 클릭/`⌘K` 로 **Command Palette** 진입 shortcut 역할.
- Palette 자체는 전역 overlay 컴포넌트 (§7.8).
- 기본 scope = 현재 프로젝트. Palette 내부에서 토글로 `이 워크스페이스 전체`로 확장 가능.
- 검색 엔진: `docs/architecture/text-search.md` 의 Postgres FTS + pg_trgm + 벡터 병렬.

### 4.6 트리 (핵심)

**스코프: 현재 프로젝트만.** 프로젝트를 바꾸면 트리 전체가 swap.

#### 4.6.1 백엔드

- **트리 구조**: `pages.parent_id` (기존) + **materialized path (`ltree`) 또는 closure table** 중 택일 (§14 Open Question, Phase 2 시작 전 ADR 009 결정).
- **Lazy children API**: `GET /api/projects/<projectId>/tree?parent_id=<X>` — 기본 2단계 프리패치(요청한 depth + 1).
- **권한 배칭**: `GET /api/projects/<projectId>/permissions` — 프로젝트 마운트 시 1회 호출, 클라이언트 캐시. 렌더 루프의 per-node 권한 체크 절대 금지.
- **실시간 메타 채널**: `GET /api/stream/projects/<projectId>/tree` SSE. 이벤트:
  - `page.created` — 새 페이지 생성 (parent_id, id, title, icon)
  - `page.renamed` — 제목/아이콘 변경
  - `page.moved` — parent_id 변경 (프로젝트 내부만)
  - `page.deleted` — soft delete (휴지통 이동)
  - `page.restored` — 휴지통에서 복구
- Yjs awareness 사용 금지 — 편집 cursor마다 사이드바 리렌더되는 사고 방지.

#### 4.6.2 프론트엔드 스택

```
react-arborist          # virtualized tree, 키보드·드래그 내장
@dnd-kit/core           # drag-drop (react-dnd 레거시, dnd-kit이 접근성·터치 표준)
zustand                 # UI state + selector 기반 구독 분리
@tanstack/react-query   # server state 캐시
cmdk                    # ⌘K 팔레트 (전역)
```

- `react-arborist` — Linear/유사 UX 채용 사례. 이모지/배지/인라인 rename은 커스텀 row renderer로 구현.
- `@dnd-kit/core` — 3-way 드롭존, 키보드 드래그, 스크린리더 패리티.
- `zustand` selector subscriptions — 노드 단일 변경이 트리 전체 재렌더되지 않도록 state를 per-node subscribe.

#### 4.6.3 성능 예산 (Phase 2 통과 기준)

| 지표 | 목표 | 측정 방법 |
|------|------|-----------|
| 프로젝트 전환 후 트리 초기 렌더 (5K 페이지) | < 300ms | E2E Playwright, 프로젝트 히어로 클릭 → 첫 노드 paint |
| 폴더 확장 (1K 자식) | < 100ms | 손으로 ▸ 클릭, Chrome performance tab |
| 드래그-드롭 이동 (낙관적 UI) | < 50ms | 드래그 drop → 새 위치에 노드 표시 |
| 리사이저 드래그 | 60fps | Chrome performance tab frame graph |
| 사이드바 mount (cold) | < 400ms | workspace 진입 → 첫 노드 paint |

10K 페이지 테넌트는 보통 프로젝트 여러 개로 쪼개져 있음 — 프로젝트당 5K가 현실적 상한. 초과 시 virtualization 깊이 추가 조정.

### 4.7 GUI 체크리스트 (파리티 기준)

Phase 2 착수 시 각 항목을 task로 쪼갬:

- [ ] ↑↓ 이동, → 펼침, ← 닫음, Enter 열기, F2 rename, Space 프리뷰, `⌘Del` 삭제
- [ ] Type-ahead — 포커스 상태 타이핑 시 접두사 점프
- [ ] Multi-select — Shift+클릭 범위, `⌘+클릭` 토글
- [ ] Inline rename — 더블클릭/F2, Enter 확정 / Esc 취소
- [ ] Context menu — 우클릭과 `⋯` hover 버튼 **동일 컴포넌트 공유**
- [ ] Drag 피드백 — 3-way 드롭존(위/안쪽/아래) 하이라이트, 그림자 커서, 금지 커서(프로젝트 경계 시도 시)
- [ ] 리사이저 드래그 + 더블클릭 → 기본값 리셋
- [ ] `⌘\` 사이드바 토글 (VSCode 패리티)
- [ ] Collapsed state 영속화 (per-workspace localStorage — 프로젝트별 펼침 상태 기억)
- [ ] 페이지 이모지/아이콘 렌더
- [ ] 공개 링크·댓글·멘션·presence 배지

### 4.8 의도적으로 빼는 Notion 패턴

- **Favorites 섹션** — v1 YAGNI. 탭 pin(§5.5)으로 대체.
- **Recently visited 섹션** — 탭이 이미 그 역할.
- **Private / Shared 섹션 분리** — 대신 페이지 노드 옆에 공유 배지. 섹션 단위 분리는 시각적 노이즈.

### 4.9 푸터

```
┌─────────────────────────────────┐
│ [S] 김성빈                  🔔 ⚙│
│     Pro · ₩12,300               │
└─────────────────────────────────┘
```

- 아바타 영역 클릭 → 계정 메뉴 팝오버
  - 프로필 (`/settings/profile`)
  - BYOK 키 (`/settings/providers`)
  - 청구·크레딧 (`/settings/billing`)
  - 다크 모드 토글
  - 로그아웃
- `🔔` 클릭 → 알림 드로어 슬라이드 오버 (§7.9)
- `⚙` 클릭 → 워크스페이스 admin 탭 (`/w/<slug>/settings`)
- Pro/Free/BYOK 배지는 `user_plan` enum 기반 색상 구분(neutral mono 규율 위배 금지, outline 차이로만 구분).

### 4.10 지뢰 (구현 시 주의)

- **React reconciliation 폭탄** — 부모 리렌더 시 수천 노드 전부 재렌더. `memo` + `areEqual` + zustand selector 필수.
- **Yjs awareness 연결 금지** — Hocuspocus 이벤트를 사이드바에 연결하면 편집 cursor마다 리렌더.
- **렌더 루프 내 per-node 권한 체크 금지** — 마운트 시 1회 배칭으로 끝.
- **드래그 중 DB write 금지** — preview만, drop 시점 1회 write + 낙관적 UI + 실패 시 롤백 토스트.
- **React Query의 invalidate 폭주 금지** — SSE 이벤트에서 `queryClient.invalidateQueries`를 남발하면 서버 폭격. 이벤트 종류별 세밀 invalidation 필수.

---

## 5. 탭 시스템

### 5.1 설계 원칙

**에디터 탭이 PRIMARY, 채팅이 SECONDARY.** 탭은 `(콘텐츠, 모드, 스크롤, AI pending, 분할 파트너)` 를 묶은 작업 단위. Cursor 모델.

### 5.2 데이터 모델 (per-workspace localStorage)

```ts
type TabKind =
  | 'dashboard'
  | 'project'
  | 'note'
  | 'research_hub'
  | 'research_run'
  | 'import'
  | 'ws_settings'

type TabMode =
  | 'plate'        // Plate v49 rich-text editor
  | 'reading'      // 집중 읽기 (read-only)
  | 'diff'         // AI 수정안 accept/reject
  | 'artifact'     // HTML/React/SVG iframe
  | 'presentation' // Reveal.js 풀스크린
  | 'data'         // JSON 트리 뷰어
  | 'spreadsheet'  // 연구 데이터 테이블
  | 'whiteboard'   // Excalidraw
  | 'source'       // PDF/문서 뷰어
  | 'canvas'       // Pyodide 코드 실행
  | 'mindmap'      // Cytoscape KG
  | 'flashcard'    // SM-2 복습

interface Tab {
  id:         string               // 클라이언트 UUID (탭 인스턴스)
  kind:       TabKind
  targetId:   string | null        // noteId / projectId / runId (kind별)
  mode:       TabMode              // note kind 외에는 항상 kind 기본 모드
  title:      string               // 탭 헤더 표시
  pinned:     boolean              // 📌 표시, 닫기 버튼 숨김
  preview:    boolean              // italic 표시, 다음 single-click이 이 탭 내용 교체
  dirty:      boolean              // ● 표시, 저장 안 된 변경 있음
  splitWith:  string | null        // 분할 파트너 Tab.id
  splitSide:  'left' | 'right' | null
  scrollY:    number               // 탭 복귀 시 스크롤 복원
}

interface WorkspaceTabStore {
  workspaceId: string
  tabs:        Tab[]
  activeId:    string | null
  // 브라우저 history가 back/forward 담당 — 별도 스택 없음
}

// localStorage key: `oc:tabs:<workspaceId>`
```

**기존 spec 대비 변경점:**
- `sessionStorage` → `localStorage` (재시작 후 복원).
- Store가 workspace-scoped. 스위치 시 해당 workspace의 store만 로드.
- `history` / `historyIdx` 제거 (URL history가 담당, §3.4).
- `kind` 필드 추가 (탭이 노트 외에도 dashboard, research hub 등).
- `preview` 필드 추가 (preview mode, §5.4).

### 5.3 12 탭 모드 요약

모드별 상세 UI는 §5.10 에 정리. 여기선 요약:

| 모드 | 아이콘 | 설명 | 저장 형식 |
|------|--------|------|-----------|
| `plate` | 📄 | Plate v49 rich-text 에디터 | Plate JSON Value |
| `reading` | 👁 | 집중 읽기 (편집 UI 제거) | — (plate 콘텐츠 그대로) |
| `diff` | ± | AI 수정 제안 accept/reject | diff patch + 원본 |
| `artifact` | ⚡ | AI 생성 HTML/React/SVG (iframe) | HTML 문자열 |
| `presentation` | 🖥 | Reveal.js 슬라이드 풀스크린 | HTML (reveal.js) |
| `data` | {} | JSON 트리 뷰어 + 편집 | JSON 문자열 |
| `spreadsheet` | 🗃 | 스프레드시트 (연구 데이터) | JSON `{columns,rows}` |
| `whiteboard` | ✏ | Excalidraw 자유 드로잉 + Yjs 협업 | Excalidraw JSON |
| `source` | 📑 | PDF/문서 뷰어 (pdf.js) | R2 URL |
| `canvas` | ▶ | Pyodide WASM 코드 실행 (Plan 7) | Python 코드 |
| `mindmap` | 🕸 | Cytoscape mindmap 뷰 (Plan 5) | KG node IDs |
| `flashcard` | 🃏 | SM-2 플래시카드 (Plan 6) | deck ID |

### 5.4 Preview Mode

**동작:**
1. 사이드바에서 노트 **싱글 클릭** → 현재 `preview: true`인 탭이 있으면 그 탭의 내용을 교체. 없으면 새 preview 탭 생성(`preview: true`).
2. 해당 탭에서 **편집 시작 또는 명시적 pin** → `preview: false`로 승격, 일반 탭이 됨. 다음 싱글 클릭이 교체하지 않음.
3. 사이드바에서 노트 **더블 클릭** → 바로 `preview: false`로 탭 열기.
4. 탭 제목 스타일: preview일 때 *italic*, 일반일 때 regular, pinned는 📌.

**상태 머신:**
```
 [sidebar single click]   [edit or explicit pin]        [close]
         ↓                          ↓                      ↓
     PREVIEW ─────────────────▶  NORMAL  ◀──pin toggle── PINNED
         │                          │                      │
         ├─[another single click]   ├─[close]              ├─[close]
         │  ↓ replace content       │  ↓ remove tab        │  ↓ remove tab
         └──────────────────────────┴──────────────────────┘
```

**"편집 시작"의 정의 (§14 Open Question)**:
- VSCode는 키 입력 또는 스크롤.
- OpenCairn v1 구현 시 결정 — Plate `onChange` 첫 발화 기준이 가장 안전 (scroll로 승격 안 함).

### 5.5 탭 바 UI

```
[📄 Attention... ●] [*📄 preview-note*] [📑 vaswani.pdf 📌] [+] ···
```

- `●` — dirty (저장 안 된 변경)
- `📌` — pinned (닫기 버튼 숨김)
- *italic* — preview tab
- 우클릭 컨텍스트 메뉴:
  - Pin / Unpin
  - Duplicate (같은 target, 새 탭 인스턴스)
  - Close / Close Others / Close Right
  - Copy Link (`/w/<slug>/n/<noteId>`)
- 드래그로 순서 변경 (`@dnd-kit/sortable`)
- 오버플로우 → `···` 드롭다운 (숨겨진 탭 목록, 가로 스크롤 + 드롭다운 병행)
- 드래그 near edge → 가로 스크롤 자동 발동

### 5.6 키보드 단축키

| 단축키 | 동작 | 변경 여부 |
|--------|------|-----------|
| `⌘T` | 새 빈 노트 탭 | 유지 |
| `⌘W` | 현재 탭 닫기 (pinned 무시) | 유지 |
| `⌘⇧T` | 최근 닫은 탭 복원 (워크스페이스 내) | 유지 |
| `⌘1` ~ `⌘9` | n번째 탭으로 이동 | 유지 |
| `⌘←` / `⌘→` | 이전/다음 탭 | 유지 |
| `⌘⌥←` / `⌘⌥→` | 탭 순서 이동 | 유지 |
| `⌘\` | **사이드바 토글** | **변경** (기존 spec은 split pane) |
| `⌘J` | 에이전트 패널 토글 | 유지 |
| `⌘⇧\` | **Split pane 토글** | **변경** (기존 `⌘\`에서 이동) |
| `⌘⇧K` | 탭 선택 텍스트 → 채팅 컨텍스트 주입 | 유지 |
| `⌘P` | Quick Open | 유지 |
| `⌘⇧P` | Command Palette | 유지 |
| `F11` | Presentation 풀스크린 | 유지 |

OS 감지: macOS = `⌘`, Windows/Linux = `Ctrl`. 구현은 `useKeyboardShortcut(['mod+t'])` 스타일 cross-OS hook.

### 5.7 Split Pane

**트리거:**
- `⌘⇧\` 또는 탭 우클릭 → "Split Right"
- AI SSE `split` 이벤트 (§5.9)

**레이아웃:**
```
┌─────────────────────┬─────────────────────┐
│  [📑 paper.pdf]     │  [📄 Notes]          │
│  source mode        │  plate mode          │
│                     │                      │
│  PDF 보기           │  노트 작성           │
└─────────────────────┴─────────────────────┘
         ↑ 드래그 리사이즈 핸들 (react-resizable-panels)
```

- 두 탭이 각자 독립적인 탭 바 + 모드.
- 드래그 핸들로 비율 조정 (기본 50:50).
- 어느 탭이 포커스 받는지 border-primary로 강조.
- Split 닫기: 핸들 더블클릭 또는 "Unsplit" 컨텍스트.

**활용 예시:**

| 좌측 | 우측 | 시나리오 |
|------|------|----------|
| `source` (PDF) | `plate` (노트) | 논문 읽으며 정리 |
| `plate` (초안) | `diff` (AI 수정안) | AI 교정 검토 |
| `mindmap` (KG) | `plate` (노트) | 그래프 보며 글쓰기 |
| `artifact` (결과) | `canvas` (코드) | 코드 실행 + 시각화 |

**데이터 모델:** `Tab.splitWith` 로 파트너 참조. `TabShell`이 `splitWith !== null`인 탭을 감지해 `react-resizable-panels`로 래핑.

```tsx
// apps/web/src/components/tab-shell/tab-shell.tsx
if (activeTab.splitWith) {
  const partner = tabs.find(t => t.id === activeTab.splitWith)
  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={50}><TabModeRouter tab={activeTab} /></Panel>
      <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40" />
      <Panel defaultSize={50}><TabModeRouter tab={partner} /></Panel>
    </PanelGroup>
  )
}
```

### 5.8 Diff View

**트리거:** AI가 기존 노트를 수정 제안. SSE 스트림에 `diff` 이벤트:

```ts
{ type: 'diff', noteId: string, patch: string, summary: string }
```

클라이언트 감지 → 해당 note 탭을 `plate → diff` 모드로 전환, 탭 제목에 `[±]` 표시.

**UI:**
```
┌─ Diff View ──────────────────────────────────────────┐
│  AI suggestion: "3 paragraphs rewritten, 1 added"    │
│  [Accept All] [Reject All]                           │
├──────────────────────────────────────────────────────┤
│  - 기존 문장이 여기 있었습니다.              [Accept] │  (빨간 배경)
│  + AI가 수정한 새 문장이 들어갑니다.         [Reject] │  (초록 배경)
│                                                      │
│    변경 없는 컨텍스트 문장 (회색)                    │
│                                                      │
│  + 새로 추가된 섹션 제목                    [Accept] │
│  + 새로 추가된 내용                         [Reject] │
└──────────────────────────────────────────────────────┘
```

**Accept/Reject:**
- Accept (chunk) — hunk를 노트에 적용 (Plate value 업데이트).
- Reject (chunk) — 기존 텍스트 유지.
- Accept All / Reject All — 전체 patch 처리 후 `plate` 모드로 복귀.
- 모든 hunk 처리 완료 → 자동으로 `plate` 모드 복귀.

**구현:** `diff` npm 라이브러리(`parsePatch`, `applyPatch`) + Plate Value ↔ plaintext 직렬화(`plateValueToText`).

### 5.9 AI ↔ 탭 프로토콜

**SSE 이벤트 매핑:**

| 이벤트 | 탭 동작 |
|--------|---------|
| `artifact` | 새 탭 artifact 모드로 열기 |
| `diff` | 현재 노트 탭을 diff 모드로 전환 |
| `split` | Split pane 자동 구성 |
| `tab_open` | 지정 `(kind, targetId, mode)`로 탭 열기 |
| `tab_close` | 지정 탭 닫기 |
| `tab_focus` | 지정 탭으로 포커스 이동 |
| `presentation` | presentation 모드 탭 열기 |

**AI 발화 → 탭 동작 예시:**

| 채팅 발화 | 탭 동작 |
|-----------|---------|
| "Transformer 다이어그램 만들어줘" | `artifact` 탭 자동 열림 |
| "이 노트 다듬어줄게" | 현재 탭 → `diff` 모드 |
| "PDF 보면서 노트 쓰자" | Split pane (source \| plate) |
| "슬라이드로 만들어줘" | `presentation` 탭 열림 |
| "플래시카드 복습 시작" | `flashcard` 탭 열림 |
| "이걸 스프레드시트로 정리해줘" | `spreadsheet` 탭 + 데이터 |
| "두 노트 비교해줘" | Split pane (plate \| plate) |

**탭 → 채팅 컨텍스트 주입 (`⌘⇧K`):**
```
> [📄 Attention is All You Need] line 42-47:
> "Multi-Head Attention allows the model to jointly attend..."

[이게 무슨 의미야?]
```

Cursor의 `Add to Chat` 패리티.

**탭 → 스코프 chip 자동 반영:**
- `note` 탭 (plate/reading/diff) → `[📄 페이지] [📂 프로젝트]` 자동 부착
- `project` 탭 → `[📂 프로젝트]`
- `dashboard` 탭 → `[🏠 워크스페이스]`
- `research_run` 탭 → `[🔬 이 리서치]`

`agent-chat-scope-design` §4 칩 UI와 연동.

### 5.10 모드별 상세

#### 5.10.1 Reading Mode

Plate 콘텐츠를 read-only 렌더. 편집 UI(툴바, 슬래시 커맨드, 커서) 전부 제거.

- 우측 상단: 예상 읽기 시간 ("약 8분")
- 폰트 크기 슬라이더 (14~20px)
- 집중 모드 토글 시 사이드바 + 에이전트 패널 자동 숨김
- `⌘⇧R` 단축키로 `plate` ↔ `reading` 토글

#### 5.10.2 Spreadsheet Mode

연구 데이터, 실험 결과, 문헌 비교표. Notion Database의 경량 대체.

- 라이브러리: `@tanstack/react-table` (헤드리스) + 커스텀 셀 편집 UI
- 셀 타입: 텍스트 / 숫자 / 날짜 / 체크박스 / 선택(enum) / 위키링크
- 컬럼 리사이즈, 정렬, 필터
- CSV import/export
- 저장 형식: JSON `{ columns: [...], rows: [...] }`

#### 5.10.3 Whiteboard Mode

`@excalidraw/excalidraw` (MIT 라이선스, 자체 호스팅 가능).

- Excalidraw 상태를 JSON으로 직렬화해 `note.content`에 저장
- Yjs 연동: Hocuspocus + ExcalidrawElement 배열을 Yjs Map으로 동기화 → 실시간 협업 화이트보드

#### 5.10.4 Presentation Mode

Plan 10의 `html_slides` (Reveal.js 출력)을 탭에서 직접 실행.

- `srcDoc`에 Reveal.js CDN + 슬라이드 HTML 주입
- F11 → 풀스크린
- 화살표 키 → 슬라이드 이동 (iframe에 keydown 포워딩)
- 우측 상단 미니맵 (Reveal.js 내장 overview)

AI가 `study_pack_generator`로 슬라이드 생성 → 자동으로 presentation 탭에 열림.

#### 5.10.5 Mindmap Mode

Plan 5 Cytoscape mindmap 뷰를 탭 모드로 임베드.

- Cytoscape.js + fcose 레이아웃
- 현재 탭의 `noteId` 또는 `projectId` 기준으로 KG 노드 필터
- 노드 클릭 → Split pane으로 해당 노트 열기
- 노드 더블클릭 → 해당 노트 탭으로 이동

#### 5.10.6 Flashcard Mode

Plan 6 SM-2 복습을 탭 전체 UI로.

- 앞면(질문) → 스페이스바/클릭 → 뒷면(답)
- [다시] [어려움] [보통] [쉬움] 버튼 → SM-2 간격 조정
- 세션 진행률 바 (상단)
- 완료 시 → `plate` 모드로 복귀 제안

### 5.11 Quick Open + Command Palette

Quick Open `⌘P`과 Command Palette `⌘⇧P`는 **동일 `cmdk` 기반 컴포넌트**, 기본 모드만 다름.

**Quick Open:**
- 노트 제목 + 최근 탭 통합 검색
- `↑↓` 이동, `Enter` 열기, `⌘Enter` Split으로 열기

**Command Palette:**
- 모든 앱 액션 검색(Tab, View, AI, Nav, Ingest 등)
- 타이핑 없이 첫 결과 그룹은 "추천" (현재 탭 기준 맞춤)

자세한 Palette 설계는 `docs/architecture/ux-conveniences.md` Tier S 참조.

---

## 6. AI 에이전트 패널

### 6.1 패널 구조

```
┌── AI 에이전트 ────────────── [+] [···] [→] ─┐
│                                               │
│  (스레드 목록 모드 또는 대화 모드 중 하나)    │
│                                               │
│  ─ 대화 모드 ─────────────────────────────    │
│  나:  ...                                     │
│                                               │
│  에이전트 [BALANCED] :                        │
│    ▸ 생각 2초                                │
│    ● H100 관련 문서 훑는 중...                │
│    2026년 1분기 기준 ...                      │
│    [1] AI 인프라 트렌드  [2] 공급망 분석      │
│    ▢ "H100 리드타임 추이" 노트 제안  [저장] × │
│                                               │
│    [복사] [재생성] [👍] [👎]                  │
│                                               │
├───────────────────────────────────────────────┤
│ [📄 페이지] [📂 프로젝트] [🧠 메모리] [+]      │  스코프 칩 row
│                             Strict ▾          │
├───────────────────────────────────────────────┤
│ + [메시지를 입력하세요...         ] auto ▾ 🎤│
└───────────────────────────────────────────────┘
```

**헤더:**
- 타이틀 `AI 에이전트` (not "AI 어시스턴트")
- `+` — 새 대화 (새 스레드 생성, 현재 대화 자동 저장)
- `···` — 히스토리 드롭다운 (워크스페이스 내 스레드 리스트, 제목·시간·첫 메시지 snippet)
- `→` — 패널 접기 (`⌘J` 와 동등)

**빈 상태** (신규 워크스페이스 첫 진입):
> 이 워크스페이스의 지식을 기반으로 물어보세요.
> 스코프 칩으로 범위를 조정할 수 있습니다.
>
> [+ 첫 대화 시작]

### 6.2 스레드 모델 (per-workspace 서버 저장)

#### 6.2.1 DB 스키마 (신설 — 기존 `conversations/messages` 대체)

```sql
-- 기존 미사용 테이블 제거
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TYPE IF EXISTS conversation_scope;
DROP TYPE IF EXISTS message_role;

-- 신규 enum
CREATE TYPE message_role AS ENUM ('user', 'agent');

-- 신규 테이블
CREATE TABLE chat_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  archived_at   timestamptz
);
CREATE INDEX chat_threads_workspace_id_idx ON chat_threads(workspace_id);
CREATE INDEX chat_threads_user_id_idx ON chat_threads(user_id);
CREATE INDEX chat_threads_updated_at_idx ON chat_threads(updated_at DESC);

CREATE TABLE chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role          message_role NOT NULL,
  content       jsonb NOT NULL,  -- { body, thought?, status_trace?, citations?, save_suggestions? }
  mode          text,             -- fast/balanced/accurate/research/auto (agent 메시지만)
  provider      text,             -- 'gemini-2.5-pro' / 'ollama:qwen3-8b'
  token_usage   jsonb,            -- { input, output, cost_krw }
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX chat_messages_thread_id_idx ON chat_messages(thread_id);
CREATE INDEX chat_messages_created_at_idx ON chat_messages(thread_id, created_at);

CREATE TABLE message_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sentiment    text NOT NULL CHECK (sentiment IN ('positive', 'negative')),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX message_feedback_message_id_idx ON message_feedback(message_id);
```

기존 `conversations/messages` 테이블은 **현재 애플리케이션 코드에서 import 되지 않음** (2026-04-23 확인, grep 결과 `apps/hocuspocus` `apps/web/src/i18n.ts` 등 비 관련 파일만). 따라서 drop 안전.

#### 6.2.2 API 엔드포인트

```
GET    /api/threads?workspace_id=X&limit=N&cursor=C
POST   /api/threads                    # body: { workspace_id, title?, first_message }
GET    /api/threads/:id
GET    /api/threads/:id/messages?cursor=C
POST   /api/threads/:id/messages       # SSE streaming response
PATCH  /api/threads/:id                # body: { title?, archived_at? }
DELETE /api/threads/:id                # soft delete (archived_at = NOW())

POST   /api/message-feedback           # body: { message_id, sentiment, reason? }
```

권한: 모든 엔드포인트가 `workspace_member` scope 요구. `chat_threads.user_id = caller`인 경우만 read/write (스레드는 사용자별 프라이빗, 공유는 v1 미지원).

#### 6.2.3 클라이언트 상태

| 상태 | 범위 | 저장소 |
|------|------|--------|
| 활성 스레드 ID | per-workspace | localStorage `oc:active_thread:<wsId>` |
| 스레드 목록 캐시 | per-workspace | React Query (server state) |
| 스레드 메시지 | per-thread | React Query (paginated) |
| 입력창 draft | per-thread | localStorage `oc:draft:<threadId>` (미저장 임시) |

워크스페이스 전환 시: `oc:active_thread:<newWsId>` 로드 → 있으면 그 스레드 복원, 없으면 패널 빈 상태.

### 6.3 대화 메시지 UI (외부 spec 참조)

개별 요소 렌더링은 기존 spec 소유, 이 spec은 **구성 위치**만 명시:

| 요소 | 원본 spec | 이 spec 적용 |
|------|-----------|--------------|
| Thought bubble (접이식) | `agent-humanizer-design` §4.1 | 메시지 상단, 기본 접힘 |
| Status line (pulse-dot + 동사 phrase) | `agent-humanizer-design` §5.2 | 생각 바로 아래 live |
| Citation chips `[1][2]` | `plan-11b` §3 | 본문 하단 별 block |
| 저장 제안 카드 | `plan-11b` §4.3 | citation 아래 |
| 스코프 칩 row | `agent-chat-scope-design` §4.1 | 패널 하단 고정 |
| 모드 뱃지 `BALANCED` | `model-router-design` | agent 메시지 상단 |
| Save suggestion detail (slash 6개) | `plan-11b` §4 | 카드 확장 영역 |

**신규 정의 — 메시지 액션 (호버 시 노출):**
- 복사 — 본문 plain text 클립보드
- 재생성 — 동일 질문을 현재 모드로 다시 실행 (스트리밍 재시작)
- 👍 / 👎 — `message_feedback` insert (sentiment positive/negative)
  - 👎 클릭 시 inline "이유 선택" popover (incorrect / incomplete / irrelevant / other + 자유 텍스트)

### 6.4 입력창 (composer)

**단일 `rounded-xl` 컨테이너:**

```
┌────────────────────────────────────────────────┐
│ + [메시지를 입력하세요...              ] auto ▾ 🎤│
└────────────────────────────────────────────────┘
```

**요소:**
- `textarea rows=1` auto-grow (min 24px, max 200px, 초과 시 스크롤)
- 좌측 `+` — 첨부 팝오버 (파일 업로드 · URL · 현재 탭 선택 주입)
- 우측 툴바:
  - `auto ▾` — 모드 셀렉터 (auto / fast / balanced / accurate / research). auto는 `model-router-design` 라우팅.
  - **마이크 ↔ 전송 토글**: textarea 비어있으면 🎤 (녹음 시작), 텍스트 있으면 원형 검정 `↑` send.

**키 바인딩:**
- Enter → 전송
- Shift+Enter → 줄바꿈
- 빈 상태 `↓` 화살표 → 직전 메시지 편집(대화 재작성)

OS 감지: macOS 표기 `⌘`, Windows/Linux 표기 `Ctrl`.

**접근성:**
- `aria-label` 전체 부여
- 녹음 중일 때 화면리더 announce ("녹음 중, 다시 누르면 중지")

### 6.5 스코프 칩 row

`agent-chat-scope-design` §4 그대로 적용. 이 spec 신규 결정:

**탭 kind별 기본 칩:**

| 탭 kind | 기본 칩 |
|---------|---------|
| `note` | `[📄 페이지] [📂 프로젝트]` |
| `project` | `[📂 프로젝트]` |
| `dashboard` | `[🏠 워크스페이스]` |
| `research_hub` | `[🏠 워크스페이스]` |
| `research_run` | `[🔬 이 리서치]` |
| `import` | `[📂 프로젝트]` |
| `ws_settings` | (칩 없음, 일반 질문 모드) |

사용자가 수동 변경하면 per-thread 상태로 기억(`chat_messages.content.scope_chips` 에 serialize).

### 6.6 패널 state 영속화

| 상태 | 범위 | 저장소 |
|------|------|--------|
| 패널 open/closed | user-global | localStorage `oc:panel_open` |
| 패널 너비 | user-global | localStorage `oc:panel_width` |
| 활성 스레드 ID | per-workspace | localStorage `oc:active_thread:<wsId>` |
| 스레드 리스트 펼침 여부 | session only | zustand ephemeral |
| 입력창 draft | per-thread | localStorage `oc:draft:<threadId>` |

---

## 7. 특별 라우트

각 라우트의 탭 모드, 뷰어, 기본 동작:

| 라우트 | `Tab.kind` | 뷰어 컴포넌트 | 기본 동작 |
|--------|-----------|---------------|-----------|
| `/w/<slug>/` | `dashboard` | `DashboardView` | 4 stats + 진행 중 Research + 최근 문서 grid |
| `/w/<slug>/p/<projectId>` | `project` | `ProjectView` | 메타(이름·페이지수·최근활동) + 노트 테이블(필터: 전체/임포트/Research/직접) + 정렬 |
| `/w/<slug>/n/<noteId>` | `note` | `TabModeRouter` | 기본 `mode=plate`, SSE로 `diff/artifact/present` 전환 가능 |
| `/w/<slug>/research` | `research_hub` | `ResearchHubView` | 상태 탭(전체/진행중/승인대기/완료/실패) + run list |
| `/w/<slug>/research/<runId>` | `research_run` | `ResearchRunView` | lifecycle별 화면 — `deep-research-integration-design` §4.2 참조 |
| `/w/<slug>/import` | `import` | `ImportView` | Drive/Notion ZIP 2-step 위자드 |
| `/w/<slug>/settings/*` | `ws_settings` | `WorkspaceSettingsView` | subtabs (멤버 · 초대 · 통합 · 공유 링크 · 휴지통) |

### 7.1 대시보드 뷰 (목업 §/)

```
┌─ 대시보드 ──────────────────────────── [새 프로젝트] ─┐
│  최근 활동 · Deep Research 진행 상황 · 추천           │
├─────────────────────────────────────────────────────┤
│  [문서 47  +3 이번 주]  [Research 2 진행 중]          │
│  [남은 크레딧 ₩12,300]  [BYOK 키 연결됨]              │
├─────────────────────────────────────────────────────┤
│  진행 중인 Deep Research                 [전체 보기 →]│
│  ● AI 인프라 시장 2026 전망      researching  [열기→] │
│  ● 반도체 공급망 2026 Q2       awaiting appr  [열기→] │
├─────────────────────────────────────────────────────┤
│  최근 작업한 문서                                    │
│  [AI 인프라 트렌드] [LLM 추론 최적화] [Persia Making] │
└─────────────────────────────────────────────────────┘
```

### 7.2 프로젝트 뷰

목업 §/project 기준. 상단 액션 3개: `[Deep Research 시작]` `[가져오기]` `[새 문서]`. 테이블 컬럼: 제목 · 유형 · 편집자 · 업데이트. 유형 배지: `직접 작성 / 임포트 / Deep Research`.

### 7.3 노트 에디터

Plan 2A/2B가 소유. 이 spec은 **탭 통합만 명시**:
- `mode=plate` 기본
- 저장 시 `dirty` 플래그 관리(Yjs awareness 기반, Tab store update)
- 스크롤 복원: 탭 복귀 시 `scrollY` 적용

### 7.4 Research 허브

목업 §/research. 탭 라벨: `전체 N / 진행 중 N / 승인 대기 N / 완료 N / 실패·취소 N`. Run 카드에 billing path 배지(`BYOK` / `크레딧`) 및 예상/실제 비용 표시.

### 7.5 Research 상세

`deep-research-integration-design` §4.2 참조. 이 spec에서 추가 결정:
- 탭 제목은 run title + 상태 배지(live 업데이트)
- lifecycle 전환 시 탭 내부 뷰 교체, 탭 자체 close/replace 없음
- 완료 시 결과 문서 자동 생성 → 해당 note 탭 새로 열림 (AI SSE `tab_open`)

### 7.6 임포트

목업 §/import. 2-step wizard:
1. 소스 선택 (Drive / Notion ZIP / 공개 URL)
2. 대상 프로젝트 + 임포트 옵션(PDF 처리 여부, 태그)

진행 중 작업은 `import_jobs` 테이블과 `/api/stream/import-jobs/:id` SSE로 상태 표시.

### 7.7 워크스페이스 admin (탭)

Subtabs:
- 멤버 — 리스트 + 역할 변경 + 초대 버튼
- 초대 — 대기 중인 초대 + 취소
- 통합 — Google Drive · Notion 연결 (user-scoped vs workspace-scoped 구분)
- 공유 링크 — 활성 link 리스트 + 만료
- 휴지통 — 삭제된 페이지 복구(30일)

### 7.8 Command Palette (전역 overlay)

탭이 아님. 전체 화면 위 portal로 렌더. `cmdk` 기반.

- `⌘K` / `⌘P` 진입
- 기본 모드: 노트 검색 + 최근 탭 + 자주 쓰는 액션
- `⌘⇧P`: Action 모드 (모든 명령)
- 스코프 토글: `이 프로젝트` / `이 워크스페이스`
- 검색: Postgres FTS + pg_trgm + 벡터 병렬 (text-search 아키텍처)

### 7.9 알림 드로어 (전역 overlay)

탭이 아님. 우측 slide-over drawer. 사이드바 푸터 🔔 에서 진입.

**그룹:**
- 멘션 (`@username`)
- 코멘트 응답
- Research 완료
- 공유 초대
- 시스템 공지

**실시간:** `/api/stream/notifications` SSE.
**읽음 처리:** 드로어 open 시 자동 mark-as-seen, 개별 클릭 시 mark-as-read.

---

## 8. 계정 레벨 shell (`/settings/*`)

**Shell 바깥 전용 페이지** — 워크스페이스 스위처/사이드바/에이전트 패널 모두 없음. 좌측 sub-nav + 우측 content.

```
┌──── 계정 설정 ─────────────────────────────────┐
│                                                │
│ [← 워크스페이스로]       김성빈               │
├─────────────┬──────────────────────────────────┤
│ 프로필       │                                 │
│ BYOK         │      (선택한 섹션 content)       │
│ 보안         │                                 │
│ 청구·크레딧  │                                 │
│ 로그아웃     │                                 │
└─────────────┴──────────────────────────────────┘
```

| 라우트 | 내용 |
|--------|------|
| `/settings/profile` | 이름 · 아바타 · 언어(ko/en) · 타임존 |
| `/settings/providers` | BYOK 키(Gemini/Ollama endpoint), 테스트 버튼, 사용 통계 |
| `/settings/security` | 비밀번호 변경 · 활성 세션 · 2FA(미래) |
| `/settings/billing` | 구독 상태(Pro/Solo) · PAYG 크레딧 · 거래 내역 · 인보이스 다운로드 |

`[← 워크스페이스로]` 클릭 = 마지막 워크스페이스 URL로 복귀 (`users.last_viewed_workspace_id` 참조).

---

## 9. 워크스페이스 전환 semantics

스위처 드롭다운에서 다른 워크스페이스 선택 시:

```
1. URL replace → /w/<newSlug>/  (대시보드로 이동)

2. 현재 워크스페이스 tab store → localStorage flush (subscription 자동)

3. 새 워크스페이스 tab store 로드:
   a. localStorage `oc:tabs:<newWsId>` 있으면 복원
   b. 없으면 [대시보드] 단일 탭으로 시작

4. 새 워크스페이스 active thread 로드:
   a. localStorage `oc:active_thread:<newWsId>` 있으면 해당 스레드 복원
   b. 없으면 에이전트 패널 빈 상태 (스레드 없음)

5. 사이드바 트리:
   a. 프로젝트 히어로 = localStorage `oc:last_project:<newWsId>` 에서 읽기
      (없으면 첫 프로젝트 alphabetical, 없으면 empty state)
   b. 해당 프로젝트 트리 fetch (React Query cache)
   c. 권한 배칭 1회 호출

6. 사이드바 너비 / 패널 너비 / 패널 open 상태:
   user-global 이라 변동 없음
```

**에지 케이스:**
- 새 워크스페이스에 프로젝트 0개 → 히어로 자리에 `"프로젝트를 만들어 시작하세요"` CTA. 트리 영역은 empty state 일러스트 + `+ 프로젝트 만들기`.
- 멤버 탈퇴된 워크스페이스 진입 시도 → 403, 스위처 목록에서 자동 제거(`GET /api/workspaces/me` 응답 기준).
- Hocuspocus 연결(현재 워크스페이스 note) → 전환 시 close + 새 워크스페이스 first note에 재연결 필요 시 새로 open.

---

## 10. 반응형 layout

| 화면 너비 | 레이아웃 |
|-----------|----------|
| `≥1024px` | 3패널 풀 (사이드바 + 탭 + 에이전트 패널) |
| `768~1023px` | 사이드바 → `Sheet` 오버레이 (우측 버튼 또는 `⌘\`). 에이전트 패널 → `Sheet` 오버레이 (우측 아래 버튼 또는 `⌘J`). 탭 단독 메인. |
| `640~767px` | 위와 동일 + 탭 바 icon-only 축약 (제목 hover 툴팁) |
| `<640px` | 탭 단독. Sheet 진입은 버튼만 (단축키 미노출 UX). Split pane 자동 해제 (활성 탭만 남김, split partner 탭은 그대로 유지하되 독립 탭으로 승격). |

**탭 수 많을 때 좁은 화면:**
- 오버플로우 `···` 드롭다운 항상 유지
- 드래그 근접 엣지 스크롤 → 터치에서는 관성 스크롤로 대체

**Sheet 구현:** `shadcn/ui Sheet` 사용. 포커스 트랩 + ESC 닫기 + 백드롭 클릭 닫기.

**Media query hook:**
```ts
// apps/web/src/components/shell/responsive-breakpoint.tsx
useBreakpoint() → 'xs' | 'sm' | 'md' | 'lg'
// xs < 640, sm 640~767, md 768~1023, lg ≥ 1024
```

---

## 11. 기술 구현 가이드

### 11.1 파일 구조 (`apps/web/src/`)

```
components/
├── shell/                          # 신규 — 전체 셸 프레임
│   ├── app-shell.tsx               #   최상위 layout (3영역)
│   ├── shell-providers.tsx         #   zustand stores + URL sync hook
│   ├── responsive-breakpoint.tsx   #   CSS + Sheet 토글 hooks
│   └── url-tab-sync.ts             #   URL ↔ tab store bidirectional
├── sidebar/                        # 신규
│   ├── sidebar.tsx                 #   컨테이너
│   ├── workspace-switcher.tsx      #   상단 드롭다운
│   ├── global-nav.tsx              #   4 아이콘
│   ├── project-hero.tsx            #   프로젝트 이름 ▾
│   ├── scoped-search.tsx           #   ⌘K 진입 shortcut 박스
│   ├── project-tree.tsx            #   react-arborist 래퍼
│   └── sidebar-footer.tsx          #   유저 + 🔔 + ⚙
├── tab-shell/                      # 일부 있음, 확장
│   ├── tab-shell.tsx               #   탭 바 + TabModeRouter 컨테이너
│   ├── tab-bar.tsx                 #   탭 목록, 드래그, 컨텍스트 메뉴
│   ├── tab-mode-router.tsx         #   mode 별 viewer 디스패치
│   └── viewers/                    #   12 모드 각각
│       ├── plate-viewer.tsx
│       ├── reading-viewer.tsx
│       ├── diff-viewer.tsx
│       ├── artifact-viewer.tsx
│       ├── presentation-viewer.tsx
│       ├── data-viewer.tsx
│       ├── spreadsheet-viewer.tsx
│       ├── whiteboard-viewer.tsx
│       ├── source-viewer.tsx
│       ├── canvas-viewer.tsx
│       ├── mindmap-viewer.tsx
│       └── flashcard-viewer.tsx
├── agent-panel/                    # 신규 (기존 chat 컴포넌트 흡수)
│   ├── agent-panel.tsx             #   패널 shell
│   ├── thread-list.tsx             #   ··· 히스토리
│   ├── conversation.tsx            #   메시지 렌더
│   ├── message-bubble.tsx          #   user/agent
│   ├── thought-bubble.tsx          #   접이식 reasoning (humanizer §4.1)
│   ├── status-line.tsx             #   pulse-dot (humanizer §5.2)
│   ├── citation-chips.tsx          #   [1][2] (plan-11b §3)
│   ├── save-suggestion-card.tsx    #   (plan-11b §4.3)
│   ├── message-actions.tsx         #   복사/재생성/👍/👎
│   ├── scope-chips.tsx             #   하단 row (chat-scope §4)
│   └── composer.tsx                #   입력창 (textarea + toolbars)
├── palette/                        # 신규 — ⌘K 전역
│   └── command-palette.tsx
├── notifications/                  # 신규 — 알림 드로어
│   └── notification-drawer.tsx
└── settings/                       # 일부 있음, 확장
    ├── account/                    #   /settings/* (shell 바깥)
    │   ├── account-shell.tsx
    │   ├── profile.tsx
    │   ├── providers.tsx
    │   ├── security.tsx
    │   └── billing.tsx
    └── workspace/                  #   /w/<slug>/settings (shell 안 탭)
        └── workspace-settings-view.tsx

stores/                             # 신규 — zustand (per-domain 분리)
├── tabs-store.ts                   #   per-workspace, localStorage persist
├── threads-store.ts                #   active thread id per-workspace
├── sidebar-store.ts                #   expanded nodes, collapsed state
├── panel-store.ts                  #   agent panel width/open (user-global)
└── palette-store.ts                #   open/query state

lib/
├── workspace-context.tsx           #   current workspace id/slug provider
└── tab-url.ts                      #   Tab → URL / URL → Tab 변환 헬퍼

app/                                # Next.js App Router
├── page.tsx                        #   `/` redirect to last workspace
├── w/[slug]/
│   ├── layout.tsx                  #   AppShell wrapper
│   ├── page.tsx                    #   dashboard tab
│   ├── n/[noteId]/page.tsx         #   note tab
│   ├── p/[projectId]/page.tsx      #   project tab
│   ├── research/page.tsx           #   research hub tab
│   ├── research/[runId]/page.tsx   #   research run tab
│   ├── import/page.tsx             #   import tab
│   └── settings/[[...slug]]/page.tsx # ws admin tab
├── settings/[[...slug]]/page.tsx   #   account shell (shell 바깥)
├── auth/[[...slug]]/page.tsx       #   auth (shell 바깥)
└── onboarding/page.tsx             #   onboarding (shell 바깥)
```

### 11.2 Zustand store 분리 원칙

각 store는 단일 domain + selector 기반 구독. State reset 시점을 명확히:

```ts
// stores/tabs-store.ts
interface TabsState {
  workspaceId: string | null
  tabs: Tab[]
  activeId: string | null
  setWorkspace(id: string): void   // load from localStorage or init
  addTab(tab: Tab): void
  closeTab(id: string): void
  setActive(id: string): void
  // ...
}

// 각 store 독립 persist middleware
persist(
  (set) => ({...}),
  {
    name: 'oc:tabs',
    partialize: (state) => ({ tabs: state.tabs, activeId: state.activeId }),
    // key는 동적으로 `oc:tabs:<workspaceId>`로 세팅 (setWorkspace에서)
  }
)
```

**user-global vs workspace-scoped:**
- `panel-store` 는 user-global (width/open) — key 고정
- 나머지 모두 workspace-scoped — key에 workspaceId 포함

### 11.3 API 엔드포인트 (신규/변경)

**신규:**

| 메서드 | 경로 | 목적 |
|--------|------|------|
| GET | `/api/threads?workspace_id=X` | 스레드 목록 |
| POST | `/api/threads` | 스레드 생성 |
| GET | `/api/threads/:id` | 스레드 메타 |
| GET | `/api/threads/:id/messages` | 메시지 목록 |
| POST | `/api/threads/:id/messages` | 메시지 전송(SSE 응답) |
| PATCH | `/api/threads/:id` | 제목/archived 수정 |
| DELETE | `/api/threads/:id` | soft delete |
| POST | `/api/message-feedback` | 👍/👎 |
| GET | `/api/projects/:projectId/tree?parent_id=X` | Lazy children |
| GET | `/api/projects/:projectId/permissions` | 권한 배칭 |
| GET | `/api/stream/projects/:projectId/tree` | SSE tree events |
| GET | `/api/stream/notifications` | SSE notifications |
| PATCH | `/api/users/me/last-viewed-workspace` | `last_viewed_workspace_id` 저장 (루트 `/` redirect 용, cross-device) |

**변경:**
- `users` 테이블에 `last_viewed_workspace_id uuid NULL` 추가
- 프로젝트 레벨 "last viewed" 는 **클라이언트 localStorage 만** (`oc:last_project:<wsId>`) — cross-device sync 는 v1 미지원 (§14)

### 11.4 SSE 채널 인벤토리 (전체 앱)

| 채널 | 스코프 | 이벤트 | 소비자 |
|------|--------|--------|--------|
| `/api/stream/projects/:id/tree` | project | page.created/renamed/moved/deleted/restored | sidebar tree |
| `/api/stream/notes/:id` (Hocuspocus) | note | Yjs awareness + updates | 에디터 |
| `/api/threads/:id/messages` (POST) | thread | agent response stream | agent panel |
| `/api/research/runs/:id/stream` | research run | lifecycle events | research run view |
| `/api/stream/notifications` | user | mention/comment/research_complete/invite | 알림 드로어 |
| `/api/stream/import-jobs/:id` | import job | progress events | import view |

**Yjs awareness는 사이드바 · 에이전트 패널에 연결 금지** (§4.10 landmine).

### 11.5 DB 마이그레이션 (Phase 4 시작 시)

```sql
-- migrations/NNNN_app_shell_redesign.sql

-- 1) 미사용 chat 테이블 drop
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TYPE IF EXISTS conversation_scope;
DROP TYPE IF EXISTS message_role;

-- 2) users 테이블에 last_viewed_workspace_id 컬럼 (루트 redirect, cross-device)
ALTER TABLE users
  ADD COLUMN last_viewed_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
-- 프로젝트 단위는 클라이언트 localStorage만 (v1 범위)

-- 3) chat_* 신규 테이블 + enum
CREATE TYPE message_role AS ENUM ('user', 'agent');

CREATE TABLE chat_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  archived_at   timestamptz
);
CREATE INDEX chat_threads_workspace_id_idx ON chat_threads(workspace_id);
CREATE INDEX chat_threads_user_id_idx ON chat_threads(user_id);
CREATE INDEX chat_threads_updated_at_idx ON chat_threads(workspace_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role          message_role NOT NULL,
  content       jsonb NOT NULL,
  mode          text,
  provider      text,
  token_usage   jsonb,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX chat_messages_thread_id_created_idx
  ON chat_messages(thread_id, created_at);

CREATE TABLE message_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sentiment    text NOT NULL CHECK (sentiment IN ('positive', 'negative')),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX message_feedback_message_id_idx ON message_feedback(message_id);

-- 4) pages 트리 모델 (ADR 009 결정 후 추가)
-- Option A: ltree
--   ALTER TABLE pages ADD COLUMN path ltree;
--   CREATE INDEX pages_path_gist ON pages USING GIST(path);
-- Option B: closure table
--   CREATE TABLE page_closure (
--     ancestor_id uuid REFERENCES pages(id) ON DELETE CASCADE,
--     descendant_id uuid REFERENCES pages(id) ON DELETE CASCADE,
--     depth int NOT NULL,
--     PRIMARY KEY (ancestor_id, descendant_id)
--   );
```

### 11.6 Testing 전략

- **Unit (Vitest)**: stores 각각의 reducer, `tab-url.ts` 변환, URL sync hook.
- **Integration (Vitest + MSW)**: thread API + message feedback API 계약.
- **E2E (Playwright)**:
  - Shell: 새 계정 → 온보딩 → workspace 진입 → 3영역 렌더 확인.
  - Routing: 딥링크로 노트 진입, 탭 열림 확인; 브라우저 back으로 이전 탭.
  - Workspace switch: 스위처 사용 → 탭 스택/스레드 교체 verify.
  - Sidebar: 5K 페이지 seed → 렌더 시간 측정 + 드래그-드롭 + inline rename.
  - Tab: 탭 close → 활성 전환 + URL 동기화; preview → normal 승격.
  - Agent: 새 스레드 → 메시지 전송 → SSE 수신 → 👍/👎.
- **성능 벤치 (CI)**: 5K 페이지 프로젝트 seed fixture + Lighthouse / Chrome perf tracing.

---

## 12. 기존 문서 Supersede 처리

두 문서 맨 위에 헤더 추가 (파일 삭제/이동 없음):

```markdown
> **Status: Superseded (2026-04-23)**
> This document is historical. The authoritative spec is
> [`2026-04-23-app-shell-redesign-design.md`](2026-04-23-app-shell-redesign-design.md).
> Kept for context on original decisions and iteration history.
```

**대상:**
- `docs/superpowers/specs/2026-04-20-tab-system-design.md`
- `docs/architecture/sidebar-design.md`

**보존 (정상 spec 유지, 이 문서가 참조):**
- `agent-humanizer-design.md`
- `agent-chat-scope-design.md`
- `plan-11b-chat-editor-knowledge-loop-design.md`
- `model-router-design.md`
- `deep-research-integration-design.md`
- `docs/architecture/ux-conveniences.md`
- `docs/architecture/text-search.md`
- `docs/architecture/billing-routing.md`

---

## 13. 구현 우선순위 (Plan App Shell Redesign — 2E+2F 통합)

**Plan 이름:** `Plan App Shell Redesign` (Plan 2E + 2F 병합)
**Spec source:** 본 문서
**Predecessor:** Plan 2A (Editor Core, 완료) · Plan 2B (Collab, 완료) · Plan 2D (Chat Renderer — Phase 4에서 흡수)

| Phase | 범위 | 예상 task | 전제 |
|-------|------|-----------|------|
| **1. Shell Frame** | `app-shell.tsx` 3영역 레이아웃, zustand stores 골격, URL ↔ tab sync, `⌘\` / `⌘J` 토글, Sheet 반응형 | 4~5 | — |
| **2. Sidebar** | workspace switcher, global nav, project hero + 스위처, 푸터, react-arborist + dnd-kit 트리, lazy children, SSE stream, 권한 배칭, GUI 체크리스트 전부 | 8~10 | Phase 1, ADR 009 (ltree vs closure) 결정 |
| **3. Tab System** | Tab store (per-workspace localStorage), 탭 바 UI, preview mode, 단축키, TabModeRouter, 4가지 core mode(plate/reading/source/data), overflow | 6~8 | Phase 1. Phase 2와 병렬 가능 |
| **4. Agent Panel Shell** | panel shell, thread-list, conversation 렌더 (Plan 2D 흡수), scope chips, composer, API + DB 마이그레이션 | 5~6 | Phase 1. Plan 2D chat renderer 소스 재사용 |
| **5. Routes & Palette** | dashboard / project / research hub / research run / import / ws settings 뷰, `/settings/*` account shell, cmdk palette, 알림 drawer | 6~7 | Phase 2, 3, 4. Phase D(Research UI)와 맞물림 |

**합계: 29~36 task.**
**Phase 순서:** 1 → (2, 3 병렬) → 4 → 5.
**Phase 4/5 는 Deep Research Phase D 와 동시 진행** — research_run 뷰가 Phase D 소유.

### 13.1 Cutover 전략

- Phase 1~3 동안 기존 앱 라우트(`apps/web/src/app/*`)는 점진 마이그레이션.
- Phase 4 시작 시 기존 `conversations/messages` 테이블 drop 마이그레이션 실행.
- Phase 5 완료 후 `Plan Deep Research Phase D` 연계 PR에서 research_run 뷰 완성.

### 13.2 Plan 간 관계

| Plan | 관계 |
|------|------|
| Plan 2C (notifications + share) | 본 plan §7.9 알림 drawer + §7.7 공유 링크에 통합. 별도 Plan 해소. |
| Plan 2D (chat renderer + block extensions) | 본 plan Phase 4에 chat renderer 흡수. Block extensions는 별도 유지(에디터 영역). |
| Plan 2E (tab shell) | 본 plan으로 대체. |
| Plan 2F (sidebar redesign) | 본 plan으로 대체. |
| Plan 10B (output extensions) | 독립 유지. infographic/data table/knowledge health report는 탭 모드에 추가(§5.3 확장 후보). |
| Plan Deep Research Phase D | Phase 5와 동시 진행. research_run 뷰 소유. |

---

## 14. Open Questions (spec 확정 후 Phase별로 결정)

- [ ] **Tree 백엔드**: `ltree` vs closure table — ADR 009 로 결정. **Phase 2 시작 전 필수.**
- [ ] **Preview tab 승격 트리거**: "편집 시작" 정의 — Plate `onChange` 첫 발화 vs 키입력 any (스크롤 제외). Phase 3 구현 시 결정.
- [ ] **Agent panel 모바일(<640) UX**: Sheet로만 유지 vs 탭 전환식 fullscreen. Phase 1 POC로 검증.
- [ ] **Palette 기본 스코프**: `이 프로젝트` vs `이 워크스페이스` default. 사용자 베타 피드백 후 결정.
- [ ] **Workspace slug 변경**: v1 미지원. 변경 지원 시 redirect 테이블 추가 설계 필요.
- [ ] **Last-viewed project cross-device sync**: v1은 localStorage만. Cross-device 가 요구되면 `user_workspace_state(user_id, workspace_id, last_viewed_project_id)` 테이블 추가.
- [ ] **Thread 공유**: v1 미지원 (프라이빗). 팀 공유 요구 발생 시 `chat_threads.visibility` + permissions 테이블 추가.
- [ ] **Message feedback의 thumbs-down 이유 enum**: 자유 텍스트 vs enum 고정. v1은 enum(`incorrect/incomplete/irrelevant/other`) + 자유 `reason text` 보조.

---

## 15. Changelog

- **2026-04-23** — v0.1 Draft. Brainstorm 결정 11개 반영(Q1~Q11). 기존 tab-system-design.md + sidebar-design.md 흡수. DB 마이그레이션 `conversations/messages` drop 후 `chat_threads/chat_messages/message_feedback` 신설. Plan 2E+2F 통합 Plan으로 승격. Phase 1~5 구조 확정.
