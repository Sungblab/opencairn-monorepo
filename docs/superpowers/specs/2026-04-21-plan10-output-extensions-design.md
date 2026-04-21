# Plan 10 Output Extensions: Infographic, Data Table, Knowledge Health Report

**Date:** 2026-04-21
**Status:** Approved
**Extends:** `docs/superpowers/plans/2026-04-15-plan-10-document-skills.md`

## Overview

Plan 10 (Document Skills)에 3개의 새 출력 포맷을 추가한다. Infographic과 Data Table은 기존 template skill 패턴을 따르고, Knowledge Health Report는 KG 상태를 DB에서 직접 집계해 생성하는 전용 엔드포인트로 구현한다.

NotebookLM 대비 OpenCairn 고유 차별점:
- Knowledge Health Report는 Curator/Temporal 에이전트 결과 + SM-2 이해도 점수를 활용해 "지식 상태 진단"을 제공 — 외부 서비스에서 복제 불가능한 기능.
- Infographic/Data Table은 단순 문서 요약이 아니라 KG concept graph를 소재로 생성.

---

## 1. Infographic

### 목적
KG 개념 + 노트에서 시각적 인포그래픽 PDF를 원클릭으로 생성.

### 입력
- `topic`: string — 인포그래픽 주제
- `projectId`: string — KG 컨텍스트 소스

### LLM 출력 스키마 (`infographic.ts`)
```typescript
{
  title: string,
  subtitle: string,
  theme: "blue" | "green" | "ember" | "stone",
  stats: Array<{
    label: string,
    value: string,
    unit?: string
  }>,   // max 4개
  sections: Array<{
    heading: string,
    type: "stat_row" | "key_points" | "comparison",
    items: string[]
  }>,
  footer_note?: string
}
```

### 컴파일 파이프라인
```
Gemini → JSON → infographic-html.ts (HTML 템플릿 렌더) → pdf.ts (Playwright) → R2
```

- `infographic-html.ts`: JSON을 받아 Tailwind 인라인 스타일 HTML로 렌더. theme별 색상 팔레트 적용.
- PDF 컴파일은 기존 `pdf.ts` 재사용 — 추가 의존성 없음.

### 출력물
- PDF 다운로드
- Studio 미리보기: PDF iframe

### 엣지 케이스
- KG 개념 없으면: notes 전문만으로 생성, 미리보기에 "KG 데이터 없음" 경고 배지

---

## 2. Data Table

### 목적
노트/KG에서 구조화된 비교표 또는 데이터 테이블을 추출해 XLSX로 내보내기.

### 입력
- `query`: string — 추출할 데이터 설명 (예: "모든 LLM 모델 비교")
- `projectId`: string

### LLM 출력 스키마 (`data_table.ts`)
```typescript
{
  title: string,
  description: string,
  headers: string[],
  rows: (string | number)[][],
  source_concepts: string[]   // KG 앵커용 concept ID 목록
}
```

- `rows` 최대 50행 제한 (Gemini 프롬프트에 명시).

### 컴파일 파이프라인
```
Gemini → JSON → xlsx.ts (xlsx npm) → R2
```

- `xlsx.ts`: `xlsx` npm 패키지로 JSON → XLSX Buffer. Plan 10 기존 compiler 파일 패턴 동일.

### 출력물
- XLSX 다운로드 (primary)
- HTML 테이블 미리보기 (Studio 인라인)

### 엣지 케이스
- XLSX 컴파일 실패 시: HTML 테이블 fallback 다운로드
- `source_concepts`는 `document_section_sources` 테이블에 KG 앵커로 저장

---

## 3. Knowledge Health Report

### 목적
프로젝트의 KG 상태(고아 개념, 모순, stale 노트, 이해도 점수)를 집계해 진단 보고서와 액션 플랜 PDF를 생성. Plan 6/8 에이전트 결과를 소비하는 최초의 "메타 출력" 기능.

### 입력
- `projectId`: string
- `format`: `"pdf"` | `"docx"` (기본: `"pdf"`)

### DB 집계 (엔드포인트 내부)
```sql
-- 제안 유형별 카운트
SELECT type, COUNT(*) FROM suggestions
  WHERE project_id = ? AND status = 'pending'
  GROUP BY type

-- stale 노트 수
SELECT COUNT(*) FROM stale_alerts
  WHERE note_id IN (SELECT id FROM notes WHERE project_id = ?)
  AND reviewed_at IS NULL

-- 평균 이해도
SELECT AVG(score) FROM understanding_scores
  WHERE user_id = ?
```

### health_score 계산
```
score = 100
  − (orphan_count × 2)
  − (contradiction_count × 5)
  − (stale_count × 1)
  + (avg_understanding_score × 0.3)

clamp(0, 100)
```

### Gemini 생성 구조
집계 수치를 컨텍스트로 주입하고 내러티브를 생성:

```typescript
{
  summary: string,
  health_score: number,   // DB 계산값 그대로
  sections: Array<{
    title: "개념 커버리지" | "지식 품질" | "학습 현황" | "우선 액션",
    findings: string[],
    action_items: string[]
  }>
}
```

### 컴파일 파이프라인
```
DB 집계 → health_score 계산 → Gemini 내러티브 → pdf.ts or docx.ts → R2
```

### 출력물
- PDF 또는 DOCX 다운로드
- `documents` 테이블 insert (`skill_name = 'health_report'`)

### Graceful degrade
| 조건 | 처리 |
|---|---|
| `suggestions` 비어있음 (Plan 8 미완료) | "지식 품질 섹션: 데이터 없음 — Curator Agent 완료 후 활성화" |
| `stale_alerts` 비어있음 (Plan 8 미완료) | 해당 섹션 스킵 |
| `understanding_scores` 비어있음 (Plan 6 미완료) | 학습 현황 섹션 스킵 |
| 3개 테이블 모두 비어있음 | 보고서 생성 거부, 안내 메시지 반환 |

---

## 4. Architecture 변경 범위

### 신규/수정 파일

```
packages/templates/
  src/schemas/infographic.ts          신규
  src/schemas/data_table.ts           신규
  src/schemas/index.ts                수정 (2개 registry 등록)
  templates/infographic.json          신규
  templates/data_table.json           신규

apps/api/src/
  lib/document-compilers/
    xlsx.ts                           신규
    infographic-html.ts               신규
  routes/
    documents.ts                      수정 (infographic/data_table 분기)
    health-report.ts                  신규
  app.ts                              수정 (health-report 라우트 마운트)

apps/web/src/app/(app)/studio/
  components/SkillPicker.tsx          수정 (섹션 구분 + Health Report 카드)
```

### Plan 10 태스크 대응

| Plan 10 Task | 변경 |
|---|---|
| Task 1 (templates) | skill 2개 + schema 2개 추가 |
| Task 4 (compilers + routes) | xlsx.ts + infographic-html.ts + health-report.ts 추가 |
| Task 7 (Studio UI) | SkillPicker 섹션 구분 + Health Report 카드 |
| Task 2, 3, 5, 6, 8, 9 | 변경 없음 |

---

## 5. UI 레이아웃

```
┌─ Document Studio ──────────────────────────────────┐
│                                                    │
│  📄 문서 출력                                       │
│  [LaTeX 논문] [DOCX 보고서] [HTML 슬라이드] ...     │
│                                                    │
│  🎓 학습 자료                                       │
│  [Flashcard] [Quiz] [Cheatsheet] ...               │
│                                                    │
│  ✨ 시각화                                          │
│  [Infographic] [Data Table]                        │
│                                                    │
│  🔍 지식베이스 분석                                  │
│  [Knowledge Health Report]                         │
│  "내 KG 상태를 진단하고 액션 플랜을 생성합니다"       │
│  [PDF 생성] [DOCX 생성]                             │
│                                                    │
└────────────────────────────────────────────────────┘
```

Health Report 카드는 topic 입력 폼 없이 projectId만으로 즉시 실행.

---

## 6. 의존성

| 신규 npm 패키지 | 용도 |
|---|---|
| `xlsx` | Data Table → XLSX 컴파일 |

기존 의존성 재사용: `playwright` (PDF), `docx` (DOCX), `@google/generative-ai`.

Plan 6/8 완료 전에도 Infographic, Data Table은 완전히 동작. Knowledge Health Report는 Plan 6/8 완료 후 점진적으로 풍부해짐.

---

## 7. 구현 순서 (권장)

1. packages/templates 스키마 + JSON 정의 (infographic, data_table)
2. xlsx.ts + infographic-html.ts 컴파일러
3. documents.ts 라우트 분기 추가
4. health-report.ts 엔드포인트
5. SkillPicker UI 업데이트
