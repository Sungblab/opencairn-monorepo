# OpenCairn - Product Requirements Document (PRD)

> Version: 0.1
> Date: 2026-04-09
> Status: Draft

---

## 1. Executive Summary

### Problem

지식 노동자들은 매일 자료를 소비하지만, 소비한 자료가 체계적으로 정리되지 않는다.

- PDF, 논문, 영상, 회의록이 파일시스템 어딘가에 흩어져 찾기 어려움
- 노트들이 서로 연결되지 않아 고립된 정보가 됨
- "그거 어디서 봤는지.." 찾는 시간이 반복됨
- 학습한 내용을 복습하지 않아 망각됨
- 서로 다른 분야의 지식을 연결하는 것이 시간과 노력의 한계

### Solution

OpenCairn은 자료를 올리면 AI가 자동으로 위키를 구축하고, 연결하고, 학습까지 도와주는 **개인 지식 OS**다.

> "Using LLMs to build personal knowledge bases" — Andrej Karpathy
>
> OpenCairn does exactly that, as a product.

### Key Differentiator

| 기존 도구 | 한계 | OpenCairn |
|-----------|------|-----------|
| Notion | 수동 정리, AI는 보조 | AI가 위키를 자동 구축/업데이트 |
| NotebookLM | 구글 종속, 셀프호스팅 불가, 기능 제한 | 오픈소스, 셀프호스팅, 11개 에이전트 |
| Obsidian | 로컬 마크다운, AI 자동 플러그인 부재 | 네이티브 AI, 자동 위키 컴파일 |
| ChatGPT/Claude | 세션 기반, 지식 축적 불가 | 대화 결과가 위키로 누적, 지식이 영속됨 |
| MiroFish/시뮬레이션 도구 | 외부 세계 예측 전용, 개인 지식과 무관 | 내 지식베이스로 시나리오 시뮬레이션 + 지식 인터뷰 |

**독보적 차별화 기능 (타 서비스 없음):**
- **지식 인터뷰**: 특정 노트/개념을 에이전트로 취급해 직접 대화. "이 논문 저자 관점에서 반박해줘"
- **시나리오 시뮬레이션**: 내 지식 그래프 위에서 What-if 실험. "케인즈 이론을 2008 금융위기에 적용하면?"
- **도메인 온톨로지 자동 설계**: 프로젝트 도메인에 맞는 KG 스키마 자동 생성으로 지식 연결 품질 극대화
- **지식 진화 타임라인**: 내 지식이 언제 어떻게 성장했는지 시각화

---

## 2. Target Users & Personas

### P1: 대학원생 / 연구자 (Primary)

**이름**: 김연구 (28세, 박사과정)
**상황**: 논문 50편을 읽었는데 관계가 머릿속에서 정리 안 됨
**Pain Point**:
- 논문 PDF를 읽고 노트는 쓰지만 논문 간 연결이 안 됨
- "그 논문에서 뭐라고 했더라?" 매번 다시 찾음
- 시험 준비할 때 핵심 개념 추출이 너무 힘듦
**Job to be Done**:
"논문을 올리면 자동으로 정리하고, 개념 간 관계가 보이고 시험 대비까지 도와주는 도구가 필요해"

**Success Criteria**:
- 논문 PDF 업로드 후 5분 내 위키 페이지 자동 생성
- 지식 그래프에서 논문 간 관계 시각화 확인
- 플래시카드로 핵심 개념 복습

---

### P2: 직장인 (Secondary)

**이름**: 박직원 (33세, 프로젝트 매니저)
**상황**: 회의록, 경쟁사 리서치, 기획 문서가 여기저기 흩어져 있음
**Pain Point**:
- 회의록이 Notion 어딘가에 묻혀 무엇을 다시 못 찾음
- 신입에게 배경 정보마다 같은 설명 반복
- 경쟁사 분석이 있는데 6개월 뒤 다시 해야 함
**Job to be Done**:
"회의록과 문서를 올리면 단 하나의 위키가 자동 관리되고 질문하면 즉시 답이 나오는 도구"

**Success Criteria**:
- 회의록 업로드 -> 결정사항/액션아이템이 자동 추출
- "지난 분기 A 기능 관련 결정 사항이 뭐였지?" 질문에 출처와 함께 답변
- 신입에게 위키 + 오디오 버전 공유로 온보딩 효율화
---

### P3: 학생 / 수험생 (Secondary)

**이름**: 이학생 (22세, 컴공 4학년)
**상황**: 기말고사 2주 전, 강의자료 정리가 안 됨
**Pain Point**:
- 슬라이드 50장, PDF 교재, 유튜브 강의를 각각 따로 봄
- 중요한 부분이 어디에 있는지 모름
- 시험에 뭐가 나올지 감이 안 잡힘

**Job to be Done**:
"강의자료를 올리면 핵심 정리해주고, 퀴즈 내주고, 시험 예측해주는 도구"

**Success Criteria**:
- 슬라이드 + PDF 업로드 -> 개념별 위키 자동 생성
- AI 모의시험 -> 실제 시험과 70%+ 유사도
- 플래시카드 간격 반복으로 암기 효율 향상

---

### P4: 개발자 (Tertiary)

**이름**: 최개발 (30세, 백엔드 개발자)
**상황**: 새 프레임워크 학습 + 기술 문서 정리
**Pain Point**:
- 공식 문서, 블로그, 유튜브 튜토리얼을 보지만 체계적으로 안 쌓임
- 6개월 전에 해결한 문제를 또 검색함

**Job to be Done**:
"기술 자료를 올리면 나만의 개인 기술 위키가 생기고, 코드 문제 해결에 활용"

**Success Criteria**:
- 기술 블로그/문서 URL 인제스트 -> 기술 위키 자동 구축
- 코드 관련 질문에 위키 기반 답변 + 코드 실행

---

## 3. User Stories & Requirements

### 3.1 자료 인제스트

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| IN-01 | 사용자로서, PDF를 업로드하면 자동으로 내용이 파싱되고 위키에 통합된다 | P0 | PDF 업로드 -> 5분 내 source 노트 생성 + Compiler Agent 처리됨 |
| IN-02 | 사용자로서, YouTube URL을 붙여넣으면 영상 내용이 텍스트로 변환된다 | P0 | YouTube URL 입력 -> STT -> source 노트 생성 |
| IN-03 | 사용자로서, 오디오 파일을 업로드하면 텍스트로 변환된다 | P0 | mp3/wav 업로드 -> faster-whisper STT -> source 노트 |
| IN-04 | 사용자로서, 이미지를 업로드하면 AI가 내용을 분석한다 | P0 | 이미지 업로드 -> Gemini Vision -> 설명 + OCR |
| IN-05 | 사용자로서, 웹 URL을 입력하면 본문이 추출된다 | P0 | URL 입력 -> trafilatura 파싱 -> source 노트 |
| IN-06 | 사용자로서, 동영상 파일을 업로드하면 간단히 처리된다 | P1 | 동영상 -> ffmpeg 오디오 추출 -> STT |
| IN-07 | 사용자로서, 인제스트 진행 상황을 실시간으로 볼 수 있다 | P1 | WebSocket/SSE로 "파싱 중.. 위키 생성 중.." 표시 |
| IN-08 | 사용자로서, 브라우저를 닫아도 인제스트가 계속 진행된다 | P0 | 재접속 후에도 완료된 결과 확인 |

### 3.2 노트 에디터
| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| ED-01 | 사용자로서, Notion 같은 블록 에디터로 노트를 작성한다 | P0 | Plate 에디터, 블록 드래그앤드롭, 슬래시 커맨드 |
| ED-02 | 사용자로서, [[위키링크]] 문법으로 노트를 연결한다 | P0 | [[ 입력 시 자동완성, 클릭 시 해당 노트로 이동 |
| ED-03 | 사용자로서, LaTeX 수식을 인라인/블록으로 작성한다 | P0 | Plate MathKit + KaTeX 렌더링 |
| ED-04 | 사용자로서, 코드 블록에 구문 강조가 적용된다 | P0 | 언어별 syntax highlighting |
| ED-05 | 사용자로서, 슬래시 커맨드로 블록 타입을 빠르게 변경한다 | P0 | / 입력 -> 블록 타입 선택 메뉴 |

### 3.3 위키 자동화 (Compiler Agent)

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| WK-01 | 사용자로서, 자료를 올리면 AI가 자동으로 위키 페이지를 생성한다 | P0 | 인제스트 완료 -> 개념 추출 -> 위키 페이지 생성 |
| WK-02 | 사용자로서, 새 자료가 기존 위키와 관련 있으면 자동으로 연결된다 | P0 | 기존 위키 검색 -> 양방향 링크 생성 |
| WK-03 | 사용자로서, 기존 위키와 충돌하는 내용이 있으면 알림을 받는다 | P0 | 모순 감지 -> 사용자에게 알림 + 양쪽 기록 |
| WK-04 | 사용자로서, AI가 생성한 위키를 직접 편집할 수 있다 | P0 | is_auto=true인 위키를 에디터로 수정 가능 |
| WK-06 | 사용자로서, 새 노트를 AI가 제안한 수정사항을 보고 PR 형태로 제안받으면 승인/거절할 수 있다 | P0 | Diff 뷰어 기반 제안/승인 UI |
| WK-05 | 사용자로서, 위키 변경 히스토리를 볼 수 있다 | P1 | wiki_logs 기반 변경 이력 UI |

### 3.4 Q&A (Research Agent)

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| QA-01 | 사용자로서, 내 위키에 대해 질문하면 출처와 함께 답변을 받는다 | P0 | 하이브리드 검색(벡터+BM25+그래프) -> 답변 + 출처 링크 |
| QA-02 | 사용자로서, 프로젝트 범위 또는 전체 범위로 검색할 수 있다 | P0 | scope 선택: project / global |
| QA-03 | 사용자로서, 대화 히스토리가 저장된다 | P0 | conversations + messages 테이블 |
| QA-04 | 사용자로서, Q&A 결과가 인터랙티브한 차트로 렌더링될 수 있다 | P1 | 캔버스로 인터랙티브 렌더링 |
| QA-05 | 사용자로서, Q&A에서 발견된 위키 오류가 위키에 반영된다 | P1 | 위키 업류 (Research Agent -> Compiler) |

### 3.5 지식 그래프 (Multi-View)
| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| KG-01 | 사용자로서, 내 지식의 개념 관계를 그래프로 시각화한다 | P0 | Cytoscape.js fcose, 줌/패닝/드래그, 자동 클러스터링 |
| KG-02 | 사용자로서, 그래프에서 노드를 클릭하면 해당 위키 페이지가 열린다 | P0 | 노드 클릭 -> 사이드패널 또는 페이지 이동 |
| KG-03 | 사용자로서, 그래프에서 직접 연결을 추가/삭제할 수 있다 | P1 | 엣지 추가/삭제 -> API -> DB 업데이트 |
| KG-04 | 사용자로서, 관계 타입별로 그래프를 필터링할 수 있다 | P1 | 필터 UI: is-a, part-of, causes, related-to |
| KG-05 | 사용자로서, 주제 노드를 선택해 마인드맵 뷰로 전환할 수 있다 | P0 | Visualization Agent가 루트/깊이 결정, cytoscape-dagre 방사형 |
| KG-06 | 사용자로서, 무한 캔버스에서 노드를 자유 배치하고 화살표를 그릴 수 있다 | P1 | Obsidian Canvas 스타일, Agent 자동 배치 옵션 |
| KG-07 | 사용자로서, 타임라인 뷰로 개념을 시간순으로 볼 수 있다 | P1 | Temporal Agent가 날짜 추출, 가로 시간축 |
| KG-08 | 사용자로서, 지식 카드 그리드로 복습한다 | P1 | shadcn Card, 그룹화/정렬, SM-2 연동 |
| KG-09 | 사용자로서, 이해도 overlay로 약한 영역을 식별한다 | P1 | 노드 색상 그라데이션 (red=약함, green=강함) |
| KG-10 | 사용자로서, Curator 에이전트가 고아/약한 연결을 제안한다 | P2 | 주기적 알림, 제안 수락/거절 UI |
| KG-11 | 사용자로서, 그래프 부분을 선택해 에세이를 생성한다 | P1 | Synthesis Agent 호출, 선택된 concept 기반 글 생성 |
| KG-12 | 사용자로서, 두 개념 사이 경로와 유사 개념을 찾을 수 있다 | P2 | Cytoscape Dijkstra + 벡터 유사도 검색 |
| KG-13 | 사용자로서, 현재 노트에 링크된 백링크를 사이드 패널에서 본다 | P0 | Obsidian 스타일 backlinks panel |
| KG-14 | 사용자로서, 인제스트/편집이 그래프에 즉시 반영된다 | P0 | Yjs + Hocuspocus 실시간 sync |

### 3.6 학습

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| LN-01 | 사용자로서, 위키 기반 퀴즈를 풀 수 있다 | P0 | Socratic Agent -> 객관식/OX/단답형 |
| LN-02 | 사용자로서, 자동 생성된 플래시카드로 복습한다 | P0 | SM-2 알고리즘 간격 반복 |
| LN-03 | 사용자로서, AI에게 개념을 설명하면 이해도를 채점받는다 | P1 | teach_back 플로우 |
| LN-04 | 사용자로서, 모의시험을 볼 수 있다 | P1 | mock_exam 플로우, 서술형/객관식/계산형 혼합 |
| LN-05 | 사용자로서, 복습 시점을 알림으로 받는다 | P2 | 에빙하우스 망각 곡선 기반 알림 |
| LN-06 | 사용자로서, 개념별 이해도 점수를 볼 수 있다 | P1 | understanding_scores 기반 대시보드 |

### 3.7 오디오 / 팟캐스트

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| AU-01 | 사용자로서, 위키 내용을 2인 대화 오디오로 생성한다 | P1 | Gemini MultiSpeakerVoiceConfig -> 오디오 파일 |
| AU-02 | 사용자로서, 생성된 오디오를 앱 안에서 재생한다 | P1 | 오디오 플레이어 UI |
| AU-03 | 사용자로서, 오디오를 다운로드할 수 있다 | P2 | Cloudflare R2에서 파일 다운로드 |

### 3.8 캔버스 / 코드

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| CV-01 | 사용자로서, AI 답변에 인터랙티브 차트/다이어그램이 포함된다 | P1 | Sandbox -> React -> iframe |
| CV-02 | 사용자로서, 코드를 작성하고 실행 결과를 본다 | P1 | Sandbox에서 Python/JS 실행 |
| CV-03 | 사용자로서, 슬라이드를 자동 생성할 수 있다 | P1 | slides 플로우 -> Sandbox -> iframe |
| CV-04 | 사용자로서, 수학(Manim)/과학/기획 등 애니메이션/시각화 도구를 활용할 수 있다 | P1 | 시각화 캔버스 플로우 -> Sandbox -> iframe |

### 3.9 딥 리서치
| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| DR-01 | 사용자로서, 주제를 입력하면 웹까지 확장된 심층 리포트를 받는다 | P1 | Gemini Deep Research API -> 리포트 생성 |
| DR-02 | 사용자로서, 리서치가 백그라운드로 진행되고 완료 시 알림을 받는다 | P1 | 비동기 실행, 재접속 후 결과 확인 |
| DR-03 | 사용자로서, 리서치 결과가 자동으로 위키에 통합된다 | P1 | 리포트 -> Compiler -> 위키 |

### 3.13 자율 수집 (Hunter Agent)

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| HT-01 | 사용자로서, 에이전트에게 특정 주제 수집(브라우징)을 지시할 수 있다 | P1 | 자율 브라우징(Playwright)을 통한 문서 다운로드 및 인제스트 |
| HT-02 | 사용자로서, 특정 웹사이트를 주기적으로 크롤링하도록 스케줄링할 수 있다 | P2 | 크론 스케줄링 기반 루틴 -> 자동 컴파일 및 위키 병합 |

### 3.10 조직 / 프로젝트

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| ORG-01 | 사용자로서, 프로젝트를 생성하여 지식을 격리한다 | P0 | 프로젝트 CRUD |
| ORG-02 | 사용자로서, 프로젝트 안에서 폴더로 노트를 분류한다 | P0 | 폴더 CRUD, 중첩 가능 |
| ORG-03 | 사용자로서, 태그로 노트를 분류한다 | P1 | 태그 CRUD, M:N 관계 |
| ORG-04 | 사용자로서, 프로젝트 간 연결을 AI에 의해 제안받는다 | P2 | Connector Agent |

### 3.11 인증 / 빌링

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| AUTH-01 | 사용자로서, 이메일/비밀번호로 회원가입 및 로그인한다 | P0 | Better Auth |
| AUTH-02 | 사용자로서, Free/Pro/BYOK 플랜을 선택한다 | P0 | Stripe Checkout |
| AUTH-03 | 사용자로서, 내 Gemini API 키를 등록하면 AI 비용을 면제받는다 | P0 | BYOK: 암호화 저장, 요청 시 복호화 |
| AUTH-04 | 사용자로서, 사용량(인제스트, Q&A 횟수)을 확인한다 | P1 | usage_records 기반 대시보드 |

### 3.12 마케팅 페이지
| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|---------------------|
| MKT-01 | 방문자로서, 랜딩페이지에서 제품을 이해한다 | P0 | SSG, hero + feature 섹션 + 데모 GIF |
| MKT-02 | 방문자로서, 가격 페이지를 본다 | P0 | Free/Pro/BYOK 비교표 |
| MKT-03 | 방문자로서, 블로그에서 제품 업데이트와 지식 관련 글을 읽는다 | P1 | MDX 블로그, SSG |
| MKT-04 | 방문자로서, 문서에서 셀프호스팅 가이드를 본다 | P1 | docs 섹션 |

---

## 4. Information Architecture

```
opencairn.com/
├── Landing Page (public)
│   ├── Hero
│   ├── Features
│   ├── How it Works
│   ├── Pricing
│   └── CTA -> Sign Up
├── /blog (public)
│   └── MDX posts
├── /docs (public)
│   ├── Getting Started
│   ├── Self-Hosting Guide
│   └── API Reference
├── /login, /signup (public)
└── /app (authenticated)
    ├── /app/dashboard
    │   ├── Recent Projects
    │   ├── 복습 알림
    │   └── 진행 중인 작업
    ├── /app/project/:id
    │   ├── Sidebar
    │   │   ├── 폴더 트리
    │   │   ├── 태그 목록
    │   │   └── 최근 노트
    │   ├── Editor (메인 영역)
    │   ├── Knowledge Graph (탭)
    │   ├── Chat (사이드패널 or 탭)
    │   └── Tools (슬래시 커맨드 or 메뉴)
    │       ├── 퀴즈
    │       ├── 플래시카드
    │       ├── 모의시험
    │       ├── 슬라이드
    │       ├── 팟캐스트
    │       ├── 딥 리서치
    │       └── ...
    ├── /app/flashcards (간격 반복 세션)
    ├── /app/settings
    │   ├── Profile
    │   ├── API Keys (BYOK)
    │   ├── Billing
    │   └── Usage
    └── /app/jobs (진행 중인 백그라운드 작업)
```

---

## 5. Non-Functional Requirements

### 성능

| 지표 | 목표 |
|------|------|
| 에디터 입력 지연 | < 50ms |
| 페이지 로드 (CSR) | < 2s |
| Q&A 첫 토큰 | < 3s |
| PDF 인제스트 (10페이지) | < 3분 |
| 위키 컴파일 (인제스트 후) | < 5분 |
| 지식 그래프 렌더링 (1000 노드) | < 1s |
| 검색 답변 (하이브리드) | < 500ms |

### 확장성
| 지표 | v0.1 목표 |
|------|----------|
| 동시 사용자 | 100명 |
| 프로젝트 per 사용자 | 무제한 |
| 노트 per 프로젝트 | 10,000+ |
| 개념 per 프로젝트 | 50,000+ |
| 파일 스토리지 per 사용자 | 10GB (Pro) |

### 보안

- 사용자 데이터 격리 (프로젝트 단위)
- Gemini API 키 암호화 저장 (AES-256)
- HTTPS only (프로덕션)
- CORS 제한 (API)
- 셀프호스팅: 사용자가 데이터를 100% 소유

### 가용성

- SaaS: 99.5% uptime 목표
- 셀프호스팅: Docker 기반, 사용자 책임

---

## 6. Success Metrics

### North Star Metric

**Weekly Active Wiki Pages** — AI가 자동 생성/업데이트한 위키 페이지 수
(사용자가 자료를 올리고 있고, AI가 정상 작동한다는 증거)

### Primary Metrics

| Metric | 정의 | 목표 (launch +3개월) |
|--------|------|---------------------|
| WAU | 주간 활성 사용자 | 500 |
| Ingest/User/Week | 사용자별 주간 인제스트 횟수 | 5+ |
| Q&A/User/Week | 사용자별 주간 Q&A 횟수 | 10+ |
| Wiki Pages/User | 사용자별 위키 페이지 수 | 50+ |
| Retention (W4) | 4주 리텐션 | 30% |

### Secondary Metrics

| Metric | 정의 |
|--------|------|
| Time to First Wiki | 가입 -> 첫 위키 자동 생성까지 시간 |
| Flashcard Review Rate | 플래시카드 복습 완료율 |
| Audio Plays | 오디오 버전 재생 수 |
| Conversion (Free -> Pro) | 무료 -> 유료 전환율 |
| BYOK Rate | BYOK 사용자 비율 |
| GitHub Stars | 오픈소스 관심도 |

---

## 7. Competitive Landscape

```
                    AI 자동화 없음
                         |
                         |
         OpenCairn ---+  |
                      |  |
  NotebookLM ----+    |  |
                 |    |  |
                 |    |  |
   범용 --------+----+--+-------- 학습 특화
                 |    |  |
   Obsidian -+   |    |  |  +--- Anki
             |   |    |  |  |
   Notion ---+   |    |  |  +--- Quizlet
                 |    |  |
                         |
                    AI 자동화 강함
```

| 경쟁사 | 강점 | 약점 | OpenCairn 차별점 |
|--------|------|------|-----------------|
| NotebookLM | 오디오 버전, 구글 생태계 | 닫힌 플랫폼, 제한된 기능 | 오픈소스, 셀프호스팅, 11개 에이전트 |
| Notion AI | 익숙한 UI, 팀 작업 | AI가 보조 역할, 자동 위키 없음 | AI가 위키를 자동 구축/업데이트 |
| Obsidian | 로컬 마크다운, 플러그인 생태계 | AI 네이티브 아님, 플러그인 조합 필요 | 네이티브 AI, 통합 경험 |
| Anki | 간격 반복의 정석 | 자료 정리/연결 기능 없음 | 지식 관리 + 학습이 하나로 통합 |
| Mem.ai | AI 자동 분류 | 위키 자동 생성 없음, 비쌈 | 위키 컴파일, 지식 그래프, 오픈소스 |

---

## 8. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Gemini API 비용 초과 | 높음 | 중간 | Context Caching 적극 활용, BYOK 모델, 사용량 제한 |
| v0.1 스코프가 너무 큼 | 높음 | 높음 | 에이전트 우선순위: Compiler+Research 먼저, 나머지는 이후 진행 |
| PDF 파싱 품질 불일치 | 중간 | 중간 | opendataloader + Gemini 하이브리드로 보완 |
| 셀프호스팅 복잡성 | 중간 | 중간 | docker-compose 원클릭, 상세한 문서 |
| Gemini API 변경/중단 | 높음 | 낮음 | 프로바이더 인터페이스 추상화 (이후 확장 가능하도록) |
| 위키 자동 생성 품질 | 높음 | 중간 | Thinking Mode 활용, 피드백 루프, Librarian 품질 관리 |

---

## 9. Out of Scope (v0.1)

명시적으로 v0.1에 포함하지 않는 것:

- 모바일 앱
- 실시간 협업 편집
- OAuth (Google, GitHub)
- 플러그인 시스템
- CLI 도구
- 데스크톱 앱
- 다국어 지원 (i18n)
- Gemini 외 AI 프로바이더
- 파인튜닝

---

## 10. Release Plan

### Phase 1: Foundation (2주)

- 모노레포 초기화 (Next.js 16 + Hono + Python)
- DB 스키마 (Drizzle)
- 인증 (Better Auth)
- 기본 프로젝트/폴더/노트 CRUD
- Plate 에디터 통합 (LaTeX, 위키링크)
- Docker Compose

### Phase 2: AI Core (2주)

- 인제스트 파이프라인 (opendataloader + Gemini 하이브리드)
- Compiler Agent (위키 자동 생성)
- Research Agent (Graph RAG Q&A)
- 지식 그래프 시각화
- 비동기 작업 실행

### Phase 3: Learning & Content (1주)

- Socratic Agent + 플래시카드
- Tool Template System
- Narrator Agent (Gemini TTS)
- 캔버스 (Sandbox)

### Phase 4: Polish & Launch (1주)

- 랜딩페이지 + 블로그
- 빌링 (Stripe)
- 나머지 에이전트 (Librarian, Connector, Temporal, Synthesis, Curator, Deep Research, Code)
- 문서
- v0.1 공개

---

## 11. Open Questions

| 질문 | 상태 | 영향도 |
|------|------|--------|
| 프로젝트 이름 최종 확정 | OpenCairn 확정 | 없음 (도메인, GitHub org) |
| Pro 플랜 가격 | 미정 | 중간 |
| BYOK 플랜 가격 | 미정 | 중간 |
| GitHub org 이름 | 프로젝트 이름 확정 후 | 중간 |
| 도메인 | 프로젝트 이름 확정 후 | 중간 |
| 이메일 알림 (SMTP) | 검토 필요 | 낮음 |
