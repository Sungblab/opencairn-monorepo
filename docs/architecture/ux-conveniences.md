# UX Conveniences Backlog (exploring — not decisions)

> **Status: exploring** (2026-04-23). 경쟁 서비스에서 모방 가치 있는 **편의 기능**을 tier 로 정리. 각 항목은 **결정 아님** — 착수 시점에 개별 spec/plan 승격.

별도 아키텍처 문서로 분리된 항목:
- 사이드바 → `docs/architecture/sidebar-design.md`
- 전역 텍스트 검색 → `docs/architecture/text-search.md`
- 문서 I/O → `docs/architecture/document-io.md`
- LLM 키 라우팅 → `docs/architecture/billing-routing.md`

본 문서는 **그 외의 편의 기능 백로그**.

---

## Tier S — 차별화 + 비용 대비 효과 최상

### 1. 글로벌 Command Palette (`Cmd+K`)
- Linear / Superhuman / Raycast 급. **검색 + 액션 + AI 호출** 단일 입구
- 현재 Plan 2A의 `Cmd+K` 는 **wiki-link 전용**. 글로벌 버전은 별개 표면
- 기능 예: "어제 작성 페이지" / "프로젝트 X 최근 회의록" / "이 페이지 요약"
- 구현: `cmdk` 라이브러리 + workspace index + action registry
- 텍스트 검색과 구분: Palette는 **페이지명·명령·에이전트 호출**, 본문 검색은 `Cmd+Shift+F`

### 2. Daily Notes
- Roam / Obsidian 유저 유입의 직접 트리거
- 오늘 날짜 페이지 자동 생성, 사이드바 상단 고정
- 템플릿 선택 가능 (회의록 / 학습기록 / 저널)
- 구현 비용 낮음 (하루치). "작은 비용 큰 차별화" 대표 항목

### 3. Smart Compose (Google Docs 스타일 ghost-text)
- 타이핑 멈추면 회색으로 다음 문장 제안, Tab 수락
- **AI-first 노트 포지션의 필수 신호**. 없으면 "AI 붙인 척" 인상
- 구현: Plate decoration + Gemini provider 호출 (현 블록 앞 1–2k 토큰)
- 주의: BYOK 토큰 소비 — `billing-routing.md` Chat 경로 + idle debounce + 쿼터 인지 필수

### 4. 웹 클리퍼 + 이메일 인제스트
- Notion Web Clipper / Evernote "forward to…" 패턴
- **이미 ingest 파이프라인 존재** (Plan 3 + Ingest Expansion 완료) — UI 래퍼만 추가
- 브라우저 확장: Chrome `manifest v3`, 하루치
- 이메일 인제스트: 워크스페이스별 주소 `abc123@in.opencairn.app` + Resend inbound MX 설정

---

## Tier A — 작은 품질 개선, 누적 체감 큼

### 5. 키보드 숏컷 오버레이 (`?`)
- GitHub / Linear / Cron 표준. 문서 안 봐도 됨
- 구현: modal + 주석 기반 shortcut 레지스트리

### 6. 페이지 링크 호버 프리뷰
- Notion 의 페이지 참조 호버 카드
- wiki-link / `@mention` hover → API 1회 → 200×120 카드
- Plan 2B mention 확장으로 구현

### 7. Trash + 30일 복구
- Notion 수준 안전 기대치. 규제 산업 영업 시 질문 항목
- 물리 삭제 지연 + `deleted_at` + 사이드바 "휴지통" 섹션

### 8. 자연어 날짜 파싱
- Todoist `next Friday 3pm` → 실제 날짜
- `/due next thursday` 같은 슬래시 커맨드에
- `chrono-node` 통합

### 9. Focus / Zen 모드
- Craft / Bear 스타일. 사이드바 숨김 + 타이포 확대 + 주변 디졸브
- 글쓰기 유스케이스 확보
- CSS + 단축키 1개

---

## Tier B — 스코프 큼, 전략적

### 10. Chat Branching / 대화 분기
- Claude / ChatGPT 모두 보유. 한 메시지에서 대안 탐색
- Plan 11A 착수 시 설계에 포함

### 11. Prompt Library (팀 공유 프롬프트)
- ChatGPT GPTs / Claude Projects 감성
- 팀 지식 자산화 — Pro 팀 기능 포지셔닝

### 12. 오프라인 PWA
- Service worker + IndexedDB sync. Notion 도 미구현
- **Yjs 가 이미 offline-first** → 의외로 가까움
- 별도 Plan 가치

---

## 현재 제 우선순위 추천

1. **사이드바 재설계** (`sidebar-design.md`) — Plan 2E 전 끼워넣기 검토
2. **글로벌 Command Palette** — 모든 기능의 진입 덮개
3. **Daily Notes** — 유입층 타겟팅 + 최저 비용
4. **Smart Compose** — AI-first 포지셔닝 필수
5. **전역 텍스트 검색** (`text-search.md`) — 기본 기대치

1~5 가 합쳐졌을 때 "Notion 아니어도 되는 이유"를 설명 가능해짐.

---

## 반영 규칙

- 각 항목이 실제 착수되는 시점에 본 문서에서 제거, 해당 항목의 spec/plan 문서로 승격
- 새 아이디어 추가는 이 문서 하단에 Tier 미정으로 적재 후 검토
- Tier 변경은 근거 한 줄 기록
