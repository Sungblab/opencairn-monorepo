# Tab System Design Spec

**Date:** 2026-04-20
**Status:** Draft
**Related:** Plan 2 (Task 21~24), Plan 5 (KG 5뷰), Plan 6 (학습 시스템), Plan 7 (Canvas), Plan 10 (Document Skills)

---

## 1. 설계 철학

**에디터 탭이 PRIMARY, 채팅이 SECONDARY.**

Notion은 에디터가 전부다. Cursor는 파일 탭이 전부고 AI는 우측 패널이다. OpenCairn은 Cursor 모델을 따른다 — 탭이 작업 공간이고 AI 채팅은 그 작업을 돕는 부속이다.

탭은 단순한 "렌더러 컨테이너"가 아니다. 탭은 다음을 포함하는 **작업 단위**다:
- 어떤 콘텐츠를 보고 있는가 (note, artifact, source, ...)
- 어떤 모드로 보고 있는가 (edit, read, diff, present, ...)
- 채팅 패널이 어떤 컨텍스트를 갖는가 (현재 탭의 scope chip)
- AI가 제안한 변경이 pending 상태인가 (diff 대기)

---

## 2. 전체 레이아웃

```
┌─────────────┬────────────────────────────────────────┬──────────────┐
│             │ [Tab Bar]                              │              │
│  Sidebar    │ [📄 Attention...] [⚡ Diagram] [+]     │  AI Chat     │
│  (240px)    ├────────────────────────────────────────┤  Panel       │
│             │                                        │  (360px,     │
│  - Folder   │   Main Content Area                    │  collapsible)│
│    tree     │   (TabModeRouter renders here)         │              │
│  - Recent   │                                        │  Chip row    │
│  - Search   │   [split pane: left | right]           │  + Input     │
│             │                                        │              │
└─────────────┴────────────────────────────────────────┴──────────────┘
```

**3패널 너비 기본값:**
- Sidebar: `240px` (최소 160, 최대 400, 드래그 리사이즈)
- Main: `flex-1` (나머지 전부)
- Chat: `360px` (최소 280, 최대 520, 드래그 리사이즈, `⌘J` 토글)

---

## 3. 탭 관리 모델

### 3.1 데이터 모델 (클라이언트 상태 — 서버 저장 안 함)

탭 상태는 **브라우저 세션 상태**다. 새로고침 시 복원을 위해 `sessionStorage`에 직렬화한다.

```ts
interface Tab {
  id:        string           // 클라이언트 UUID (탭 인스턴스 식별)
  noteId:    string | null    // 연결된 note row (없으면 새 탭)
  mode:      TabMode          // 현재 렌더 모드
  title:     string           // 탭 헤더 표시 텍스트
  pinned:    boolean          // 닫기 버튼 숨김
  dirty:     boolean          // 저장 안 된 변경 있음 (● 표시)
  splitWith: string | null    // split pane 시 파트너 Tab.id
  splitSide: 'left' | 'right' | null
  scrollY:   number           // 탭 복귀 시 스크롤 복원
}

interface TabStore {
  tabs:       Tab[]
  activeId:   string
  history:    string[]        // 최근 활성 탭 ID 스택 (back/forward)
  historyIdx: number
}
```

### 3.2 탭 모드 전체 목록

| 모드 | 아이콘 | 설명 | 저장 형식 |
|------|--------|------|----------|
| `plate` | 📄 | Plate v49 rich-text 에디터 | Plate JSON Value |
| `reading` | 👁 | 집중 읽기 모드 (편집 UI 제거) | — (plate 콘텐츠 그대로) |
| `diff` | ± | AI 수정 제안 accept/reject | diff patch + 원본 |
| `artifact` | ⚡ | AI 생성 HTML/React/SVG (iframe) | HTML 문자열 |
| `presentation` | 🖥 | Reveal.js 슬라이드 풀스크린 | HTML (reveal.js) |
| `data` | {} | JSON 트리 뷰어 + 편집 | JSON 문자열 |
| `spreadsheet` | 🗃 | 스프레드시트 (연구 데이터) | CSV / JSON |
| `whiteboard` | ✏️ | Excalidraw 자유 드로잉 | Excalidraw JSON |
| `source` | 📑 | PDF/문서 뷰어 | R2 URL |
| `canvas` | ▶ | Pyodide WASM 코드 실행 (Plan 7) | Python 코드 |
| `mindmap` | 🕸 | Cytoscape Mindmap 뷰 (Plan 5) | KG node IDs |
| `flashcard` | 🃏 | SM-2 플래시카드 복습 세션 (Plan 6) | deck ID |

### 3.3 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `⌘T` | 새 탭 열기 |
| `⌘W` | 현재 탭 닫기 (pinned면 무시) |
| `⌘Shift T` | 최근 닫은 탭 복원 |
| `⌘1~9` | n번째 탭으로 이동 |
| `⌘←` / `⌘→` | 이전/다음 탭 |
| `⌘Alt ←` / `⌘Alt →` | 탭 이동 (순서 변경) |
| `⌘\` | Split pane 토글 |
| `⌘J` | 채팅 패널 접기/펼치기 |
| `⌘Shift K` | 현재 탭 선택 텍스트를 채팅 컨텍스트로 주입 |
| `⌘P` | Quick Open (노트/탭 검색) |
| `⌘Shift P` | Command Palette |
| `F11` | Presentation 모드 풀스크린 |

### 3.4 탭 바 UI

```
[📄 Attention... ●] [⚡ Diagram v3] [📑 vaswani2017.pdf 📌] [+]  ···
```

- `●` — 저장 안 된 변경 (dirty)
- `📌` — 핀된 탭 (닫기 버튼 없음)
- 탭 우클릭 → 컨텍스트 메뉴: Pin / Duplicate / Close Others / Copy Path
- 탭 드래그 → 순서 변경
- 탭 오버플로우 → `···` 버튼으로 숨겨진 탭 드롭다운

---

## 4. Split Pane

### 4.1 레이아웃

```
┌─────────────────────┬─────────────────────┐
│  [📑 paper.pdf]     │  [📄 Notes]          │
│  source mode        │  plate mode          │
│                     │                      │
│  PDF 보기           │  노트 작성           │
│                     │                      │
└─────────────────────┴─────────────────────┘
         ↑ 드래그 리사이즈 핸들
```

- `⌘\` 또는 탭 우클릭 → "Split Right" / "Split Down"
- 두 탭이 각자 독립적인 탭 바 + 모드를 가짐
- 드래그 핸들로 비율 조정 (기본 50:50)
- 어느 탭이 포커스 받는지 강조 표시 (border-primary)
- Split 닫기: 핸들 더블클릭 또는 "Unsplit" 버튼

### 4.2 Split Pane 활용 예시

| 좌측 | 우측 | 시나리오 |
|------|------|---------|
| `source` (PDF) | `plate` (노트) | 논문 읽으며 정리 |
| `plate` (초안) | `diff` (AI 수정안) | AI 교정 검토 |
| `mindmap` (KG) | `plate` (노트) | 그래프 보며 글쓰기 |
| `artifact` (결과) | `canvas` (코드) | 코드 실행 + 시각화 |

### 4.3 데이터 모델 (Tab 확장)

`Tab.splitWith`로 파트너를 참조. `TabShell`이 `splitWith !== null`인 탭을 감지해 `react-resizable-panels`로 래핑.

```tsx
// apps/web/src/components/tab-shell/tab-shell.tsx
if (activeTab.splitWith) {
  const partner = tabs.find(t => t.id === activeTab.splitWith)
  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={50}><TabModeRouter tab={activeTab} /></Panel>
      <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors" />
      <Panel defaultSize={50}><TabModeRouter tab={partner} /></Panel>
    </PanelGroup>
  )
}
```

---

## 5. Diff View

### 5.1 트리거

AI가 기존 노트를 수정 제안할 때 발동. SSE 스트림에 `diff` 이벤트:

```ts
{
  type: 'diff',
  noteId: string,
  patch: string,      // unified diff 형식
  summary: string,    // "3 paragraphs rewritten, 1 section added"
}
```

클라이언트가 감지 → 해당 note 탭을 `plate` → `diff` 모드로 전환 + 탭 제목에 `[±]` 표시.

### 5.2 UI

```
┌─ Diff View ──────────────────────────────────────────┐
│  AI suggestion: "3 paragraphs rewritten, 1 added"    │
│  [Accept All] [Reject All]                           │
├──────────────────────────────────────────────────────┤
│  - 기존 문장이 여기 있었습니다.              [Accept] │  ← 빨간 배경
│  + AI가 수정한 새 문장이 들어갑니다.         [Reject] │  ← 초록 배경
│                                                      │
│    변경 없는 컨텍스트 문장 (회색)                    │
│                                                      │
│  + 새로 추가된 섹션 제목                    [Accept] │
│  + 새로 추가된 내용                         [Reject] │
└──────────────────────────────────────────────────────┘
```

### 5.3 Accept/Reject 동작

- **Accept (chunk)**: 해당 hunk를 노트에 적용 (Plate value 업데이트)
- **Reject (chunk)**: 해당 hunk 무시, 기존 텍스트 유지
- **Accept All**: 전체 patch 적용 → `plate` 모드로 복귀
- **Reject All**: patch 폐기 → `plate` 모드로 복귀
- 모든 hunk 처리 완료 → 자동으로 `plate` 모드 복귀

### 5.4 기술 구현

```ts
// apps/web/src/lib/diff-engine.ts
import { parsePatch, applyPatch } from 'diff' // npm: diff

export function applyHunk(original: string, patch: string, hunkIndex: number): string {
  const parsed = parsePatch(patch)
  // hunkIndex번째 hunk만 적용, 나머지는 건너뜀
  // ...
}
```

`diff` 라이브러리 사용, Plate Value ↔ plaintext 직렬화는 `plateValueToText` 활용.

---

## 6. 추가 탭 모드 상세

### 6.1 Reading Mode

Plate 콘텐츠를 read-only로 렌더링. 편집 UI(툴바, 슬래시 커맨드, 커서) 전부 제거.

```tsx
// apps/web/src/components/tab-shell/reading-viewer.tsx
// Plate를 readOnly={true}로 마운트 + 타이포그래피 CSS 강화
// 우측 상단: 예상 읽기 시간 ("약 8분")
// 폰트 크기 조절 슬라이더 (14px ~ 20px)
// 집중 모드: 사이드바 + 채팅 패널 자동 숨김
```

`⌘Shift R` 단축키로 `plate` ↔ `reading` 토글.

### 6.2 Spreadsheet Mode

연구 데이터, 실험 결과, 문헌 비교표. Notion Database의 완전한 대체.

**라이브러리**: `@tanstack/react-table` (헤드리스) + 커스텀 셀 편집 UI.
Notion처럼 무거운 라이브러리 대신 경량 구현.

```
| # | 논문 제목          | 연도 | 방법론      | Acc    | 비고      |
|---|--------------------| ----|------------|--------|-----------|
| 1 | Attention is...    | 2017| Transformer| 28.4   | 기준 논문  |
| 2 | BERT               | 2018| MLM+NSP    | 80.5   |            |
| + | 행 추가            |     |             |        |            |
```

- 셀 타입: 텍스트 / 숫자 / 날짜 / 체크박스 / 선택(enum) / 위키링크
- 컬럼 리사이즈, 정렬, 필터
- CSV import/export
- 저장 형식: JSON (`{ columns: [...], rows: [...] }`)

### 6.3 Whiteboard Mode

**라이브러리**: `@excalidraw/excalidraw` (MIT 라이선스, 자체 호스팅 가능)

```tsx
// apps/web/src/components/tab-shell/whiteboard-viewer.tsx
import { Excalidraw } from '@excalidraw/excalidraw'

// Excalidraw 상태를 JSON으로 직렬화해 note.content에 저장
// Yjs 연동: Hocuspocus + ExcalidrawElement 배열을 Yjs Map으로 동기화
// → 실시간 협업 화이트보드
```

Notion의 화이트보드보다 강력 — 실시간 협업, 수식 렌더, 코드 블록 삽입 지원.

### 6.4 Presentation Mode

Plan 10의 `html_slides` (Reveal.js 출력)을 탭에서 직접 실행.

```tsx
// apps/web/src/components/tab-shell/presentation-viewer.tsx
// srcDoc에 Reveal.js CDN + 슬라이드 HTML 주입
// F11 → 풀스크린
// 화살표 키 → 슬라이드 이동 (iframe에 keydown 이벤트 포워딩)
// 우측 상단 미니맵 (Reveal.js 내장 overview 모드)
```

AI가 `study_pack_generator`로 슬라이드 생성 → 자동으로 `presentation` 탭에 열림.

### 6.5 Mindmap Mode

Plan 5 Cytoscape Mindmap 뷰를 탭 모드로 임베드.

```tsx
// apps/web/src/components/tab-shell/mindmap-viewer.tsx
// Cytoscape.js + fcose 레이아웃
// 현재 탭의 noteId 또는 projectId 기준으로 KG 노드 필터
// 노드 클릭 → Split pane으로 해당 노트 열기
// 노드 더블클릭 → 해당 노트 탭으로 이동
```

### 6.6 Flashcard Mode

Plan 6 SM-2 복습을 탭 전체 UI로.

```tsx
// apps/web/src/components/tab-shell/flashcard-viewer.tsx
// 탭 전체가 플래시카드 UI
// 앞면(질문) → 스페이스바/클릭 → 뒷면(답)
// [다시] [어려움] [보통] [쉬움] 버튼 → SM-2 간격 조정
// 세션 진행률 바 (상단)
// 완료 시 → plate 모드로 복귀 제안
```

---

## 7. AI ↔ 탭 상호작용 프로토콜 (완전판)

### 7.1 SSE 이벤트 → 탭 동작 매핑

| SSE 이벤트 | 탭 동작 |
|-----------|--------|
| `artifact` | 새 탭 artifact 모드로 열기 |
| `diff` | 현재 노트 탭을 diff 모드로 전환 |
| `split` | Split pane 자동 구성 |
| `tab_open` | 지정 noteId + mode로 탭 열기 |
| `tab_close` | 지정 탭 닫기 |
| `tab_focus` | 지정 탭으로 포커스 이동 |
| `presentation` | presentation 모드 탭 열기 |

### 7.2 AI 발화 → 탭 동작 예시

| 채팅 발화 | 탭 동작 |
|---------|--------|
| "Transformer 다이어그램 만들어줘" | `artifact` 탭 자동 열림 |
| "이 노트 다듬어줄게" | 현재 탭 → `diff` 모드 |
| "PDF 보면서 노트 쓰자" | Split pane (source \| plate) |
| "슬라이드로 만들어줘" | `presentation` 탭 열림 |
| "플래시카드 복습 시작" | `flashcard` 탭 열림 |
| "이걸 스프레드시트로 정리해줘" | `spreadsheet` 탭 + 데이터 채움 |
| "두 노트 비교해줘" | Split pane (plate \| plate) |

### 7.3 탭 → 채팅 컨텍스트 주입

탭에서 텍스트 선택 후 `⌘ Shift K` → 채팅 입력창에 선택 텍스트가 인용 블록으로 삽입:

```
> [📄 Attention is All You Need] line 42-47:
> "Multi-Head Attention allows the model to jointly attend..."

[이게 무슨 의미야?]
```

Cursor의 `Add to Chat` 기능과 동일.

### 7.4 탭 컨텍스트 → 채팅 스코프 자동 반영

탭이 바뀔 때 채팅 패널의 scope chip이 자동 업데이트:

- `plate` 탭 (noteId) → `📄 [노트 제목]` chip 자동 부착
- `mindmap` 탭 (projectId) → `📂 [프로젝트]` chip 자동 부착
- `artifact` 탭 → `⚡ [아티팩트 제목]` chip 자동 부착

Plan 11A chip UI와 연동.

---

## 8. Quick Open + Command Palette

### 8.1 Quick Open (`⌘P`)

```
┌─ Quick Open ──────────────────────────────┐
│ > attention                               │
│                                           │
│ 📄 Attention is All You Need              │
│ 📄 Self-Attention 설명                    │
│ ⚡ Transformer Diagram v3                  │
│ 📑 vaswani2017.pdf                         │
└───────────────────────────────────────────┘
```

- 노트 제목 + 최근 탭 통합 검색
- `↑↓` 이동, `Enter` 열기, `⌘Enter` Split으로 열기

### 8.2 Command Palette (`⌘ Shift P`)

```
┌─ Command Palette ─────────────────────────┐
│ > split                                   │
│                                           │
│ Tab: Split Right                          │
│ Tab: Split Down                           │
│ Tab: Unsplit                              │
│ View: Toggle Reading Mode                 │
│ View: Enter Presentation                  │
│ AI: Generate Artifact                     │
│ AI: Suggest Edits (Diff)                  │
└───────────────────────────────────────────┘
```

---

## 9. 모바일 / 반응형

| 화면 너비 | 레이아웃 |
|---------|--------|
| `< 640px` | 사이드바 숨김(sheet), 채팅 패널 숨김, 탭 단독 |
| `640~1024px` | 사이드바 접기 가능, 채팅 sheet로 열기 |
| `> 1024px` | 3패널 풀 레이아웃 |
| Split pane | `< 768px`에서 자동 해제 → 단일 패널 |

---

## 10. 구현 우선순위

| Priority | 기능 | Task |
|---------|------|------|
| P0 | TabShell + 탭 관리 (열기/닫기/이동) | Task 21 |
| P0 | plate / artifact / data / source 모드 | Task 21 |
| P0 | 키보드 단축키 기본 세트 | Task 21 |
| P1 | Split Pane | Task 22 |
| P1 | Diff View | Task 23 |
| P1 | Reading Mode | Task 24 |
| P2 | Spreadsheet | Task 24 |
| P2 | Whiteboard (Excalidraw) | Task 24 |
| P2 | Presentation Mode | Task 24 |
| P3 | Mindmap Tab (Plan 5 의존) | Plan 5 이후 |
| P3 | Flashcard Tab (Plan 6 의존) | Plan 6 이후 |
| P3 | Command Palette | Task 24 |
