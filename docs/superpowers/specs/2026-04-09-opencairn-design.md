# OpenCairn - System Design Spec v2

> AI knowledge base for learning, research, and work.
>
> "What Karpathy described, as a product"

---

## 1. Product Vision

NotebookLM + Notion + Cursor를 합친 개인 지식 OS.

- **자료 -> 지식화**: 자료(PDF, 영상, 오디오, 이미지, URL)를 올으면 AI가 위키를 컴파일
- **노트 작성 + 연결**: Notion 스타일 블록 에디터로 직접 노트 작성, 위키링크로 연결
- **AI 파워로 탐색**: 개인 지식에 대한 심층 리서치, Graph RAG Q&A
- **학습 시스템**: 플래시카드, 간격 반복, 소크라테스식 문답, 오디오 팟캐스트
- **캔버스**: 인터랙티브 React/HTML 렌더링 (Claude Artifacts 스타일)
- **코드 실행**: 샌드박스에서 코드 실행, 과제 채점
- **딥 리서치**: Gemini Deep Research API + 위키 자동 통합
- **SaaS**: 랜딩페이지, 블로그, 빌링 포함

### 타겟 페르소나

| 페르소나 | 핵심 니즈 | 주요 기능 |
|----------|----------|----------|
| 학생/수험생 | 시험, 공부, 복습 | Socratic, 플래시카드, 모의시험, 슬라이드 |
| 연구자/직장인 | 자문 정리, 리서치 | Compiler, Deep Research, Synthesis |
| 직장인 | 회의록 정리, 보고서 작성 | 프로젝트, Q&A, 리포트 생성, Narrator |
| 개발자 | 기술 문서 정리, 코딩 | Code Agent, 위키, Deep Research |

---

## 2. Architecture Overview

```
Browser
  |
  v
Next.js 16 (Frontend)
  |  - 랜딩페이지, 블로그 (SSG, SEO)
  |  - 앱 대시보드 (CSR, API 호출만)
  |  - Server Action 없음, DB 접근 없음
  |
  | REST API
  v
Hono (Backend API, TypeScript)
  |
  |--- PostgreSQL + pgvector (DB)
  |--- Temporal (Durable Workflow Orchestration)
  |--- Redis (Cache + Session)
  |--- Cloudflare R2 (File Storage, S3 compatible)
  |--- Stripe (Billing)
  |
  v (Temporal Activities)
Python Worker (AI Processing)
  |
  |--- Gemini API (google-genai SDK)
  |      |--- Deep Research API (interactions.create)
  |      |--- TTS (SpeechConfig, MultiSpeaker)
  |      |--- Google Search Grounding
  |      |--- Context Caching
  |      |--- Thinking Mode
  |--- LangGraph + Pydantic AI
  |--- opendataloader-pdf + Gemini Multimodal (hybrid)
  |--- faster-whisper (STT)
  |
  v (S3 API)
Cloudflare R2

Sandbox (gVisor runtime, isolated code execution + interactive canvas)
```

### Core Principles

- **Next.js는 UI + 마케팅** -- SSG(랜딩/블로그), CSR(앱). Server Action 없음
- **Hono가 모든 비즈니스 로직의 게이트웨이** -- 인증, CRUD, 파일 프로세싱, 워크플로우 트리거
- **무거운 AI 처리는 전부 Python Worker** -- 에이전트, 위키 생성, 이벤트 실행
- **Temporal로 에이전트 워크플로우 오케스트레이션** -- 영구적 실행, 자동 복구, 타임아웃, 동시성 제어. 11개 에이전트 간 충돌 방지
- **Gemini 네이티브 기능 최대한 활용** -- TTS, Deep Research, 검색 그라운딩, 캐싱을 직접 구축하지 않음
- **gVisor 샌드박스** -- AI 생성 코드 실행 시 커널 수준 격리, 컨테이너 탈출 방지
- **환경변수만 바꾸면 셀프호스팅 <-> 클라우드 전환**

### URL 구조

```
opencairn.com/              -> 랜딩 (SSG)
opencairn.com/blog           -> 블로그 (MDX + SSG)
opencairn.com/docs           -> 문서 (SSG)
opencairn.com/pricing        -> 가격 (SSG)
opencairn.com/login          -> 인증
opencairn.com/app/dashboard  -> 앱 (CSR, API 호출만)
opencairn.com/app/project/x  -> 프로젝트 (CSR)
```

---

## 3. Tech Stack

### Frontend

| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js (App Router) | 16.x | SSG(랜딩/블로그) + CSR(앱) |
| React | 19.x | UI |
| Plate | 49.x | 블록 에디터 (LaTeX MathKit, 위키링크, 슬래시 커맨드) |
| shadcn/ui | latest | UI 컴포넌트 |
| Tailwind CSS | 4.x | 스타일링 (CSS-first config) |
| TanStack Query | latest | API 상태 관리 |
| D3.js / Force Graph | latest | 지식 그래프 시각화 (인터랙티브) |
| KaTeX | latest | LaTeX 렌더링 |
| Mermaid | latest | 다이어그램 렌더링 |
| MDX | latest | 블로그 콘텐츠 |

### Backend API

| 기술 | 버전 | 용도 |
|------|------|------|
| Hono | 4.x | HTTP API 서버 |
| Drizzle ORM | 0.45.x | DB 접근 (PostgreSQL) |
| Better Auth | latest | 인증/세션 |
| Stripe | latest | 빌링 (Free/Pro/BYOK) |
| @aws-sdk/client-s3 | latest | Cloudflare R2/S3 파일 스토리지 |
| @temporalio/client | latest | Temporal 워크플로우 트리거 |
| ioredis | latest | Redis 캐시/세션 |
| Zod | latest | 요청/응답 검증 |

### Python Worker

| 기술 | 용도 |
|------|------|
| temporalio | Temporal Worker (워크플로우 + 액티비티 실행) |
| LangGraph | 에이전트 내부 상태 머신 (각 에이전트의 스텝 로직) |
| Pydantic AI | 구조화된 출력 추출, 타입 안전성 |
| google-genai | Gemini API SDK (TTS, Deep Research, Search Grounding, Caching, Thinking) |
| opendataloader-pdf | PDF 구조적 파싱 (OCR, 수식, 표, LaTeX) |
| faster-whisper | 오디오/영상 -> 텍스트 (STT) |
| psycopg | PostgreSQL 접근 |
| redis (py) | Redis 캐시 접근 |
| boto3 | Cloudflare R2/S3 파일 접근 |

### Gemini API 네이티브 모델 분업 매핑 전략

오픈카이른 (OpenCairn)은 비용 효율성과 성능을 극대화하기 위해 각 에이전트의 워크로드 특성에 맞춰 최적화된 최신 모델을 할당합니다.

| 에이전트/기능 | 할당 모델 (Model) | 선택 이유 및 설명 |
|------|-----------|--------|
| **Brain (추론 코어)** | `Gemini 3.1 Pro` | 고도의 지능이 요구되는 **Synthesis(통합)** 및 복합 추론 |
| **Worker (가성비/캐시)** | `Gemini 3.1 Flash-Lite` | 1M+ 토큰 캐싱을 활용하는 **Research(Q&A)**, **Compiler**, **Socratic(학습)** |
| **Hunter (효율 수집)** | `Computer Use 모델` | 화면을 '보고' 클릭/검색하여 전문적인 자료를 효율 다운로드 (Manus 형태) |
| **Deep Research** | `Gemini Deep Research` | 심층적 조사를 자율적으로 계획/실행하는 전담 에이전트 |
| **Narrator (팟캐스트)** | `Gemini 2.5 Pro TTS` | 위키 텍스트를 고품질 멀티 화자 음성 오디오북/팟캐스트로 생성 |
| **Voice Q&A (실시간)** | `Gemini 3.1 Flash Live` | 지연 시간에 민감한 A2A 라이브 음성 채팅 및 인터 워크플로우에 최적 |
| **RAG / 멀티 임베딩** | `Gemini Embedding 2` | 텍스트, 이미지, 비디오, 오디오를 하나의 임베딩 공간에 매핑하는 하이브리드 RAG |
| **Canvas (생성형 시각화)** | `Nano Banana Pro` | 위키 내용 기반의 고해상도 인포그래픽, 4K 시각적 레이아웃 생성 |

### Infrastructure

| 서비스 | 이미지 | 용도 |
|--------|--------|------|
| postgres | pgvector/pgvector:pg16 | DB + 벡터 인덱스 + BM25 |
| temporal | temporalio/auto-setup | 워크플로우 오케스트레이션 (영구적 실행) |
| redis | redis:7-alpine | 세션/캐시 |
| Cloudflare R2 | Cloudflare R2/Cloudflare R2 | 파일 저장소 (S3 호환) |
| web | apps/web Dockerfile | Next.js (standalone) |
| api | apps/api Dockerfile | Hono 백엔드 API |
| worker | apps/worker Dockerfile | Python AI Worker (Temporal Worker) |
| sandbox | apps/sandbox Dockerfile (gVisor) | 코드 실행 + 인터랙티브 캔버스 |

총 8개 서비스. `docker-compose up -d` 한 방.

---

## 4. Monorepo Structure

```
opencairn/
  apps/
    web/            -- Next.js 16 (SSG 랜딩/블로그 + CSR 앱)
    api/            -- Hono (Backend API, TypeScript)
    worker/         -- Python (AI Agents, LangGraph)
    sandbox/        -- Docker Code Runner + Canvas Server

  packages/
    db/             -- Drizzle ORM schema + migrations
    ui/             -- shadcn/ui shared components
    config/         -- ESLint, TypeScript shared config
    shared/         -- Shared types (API contracts, Redis message schemas)

  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  LICENSE           -- AGPLv3
  README.md
```

---

## 5. Data Model

### Core Tables

```
users
  id              UUID PK
  email           TEXT UNIQUE
  name            TEXT
  password_hash   TEXT
  plan            ENUM (free, pro, byok)
  gemini_api_key  TEXT NULLABLE (encrypted, BYOK only)
  created_at      TIMESTAMP

projects
  id              UUID PK
  user_id         UUID FK -> users
  name            TEXT
  description     TEXT
  created_at      TIMESTAMP

folders
  id              UUID PK
  project_id      UUID FK -> projects
  parent_id       UUID FK -> folders NULLABLE (nesting)
  name            TEXT
  position        INT

tags
  id              UUID PK
  project_id      UUID FK -> projects
  name            TEXT
  color           TEXT

note_tags
  note_id         UUID FK -> notes
  tag_id          UUID FK -> tags
```

### Notes & Wiki

```
notes
  id              UUID PK
  project_id      UUID FK -> projects
  folder_id       UUID FK -> folders NULLABLE
  title           TEXT
  content         JSONB (Plate block format)
  content_text    TEXT (plain text for BM25)
  content_tsv     TSVECTOR (generated, BM25 index)
  embedding       VECTOR(3072) (gemini-embedding-2-preview)
  type            ENUM (note, wiki, source)
  source_type     ENUM (manual, pdf, audio, video, image, youtube, web) NULLABLE
  source_file_key TEXT NULLABLE (Cloudflare R2 key)
  is_auto         BOOLEAN (AI가 생성했으면 true)
  created_at      TIMESTAMP
  updated_at      TIMESTAMP

note_links
  id              UUID PK
  source_id       UUID FK -> notes
  target_id       UUID FK -> notes
  context         TEXT (링크가 사용된 문맥)
```

### Knowledge Graph

```
concepts
  id              UUID PK
  project_id      UUID FK -> projects
  name            TEXT
  description     TEXT
  embedding       VECTOR(3072)
  created_at      TIMESTAMP

concept_edges
  id              UUID PK
  source_id       UUID FK -> concepts
  target_id       UUID FK -> concepts
  relation_type   TEXT (e.g. "is-a", "part-of", "causes", "related-to")
  weight          FLOAT
  evidence_note_id UUID FK -> notes NULLABLE (근거 노트)

concept_notes
  concept_id      UUID FK -> concepts
  note_id         UUID FK -> notes
```

### Wiki Logs

```
wiki_logs
  id              UUID PK
  note_id         UUID FK -> notes (wiki page)
  agent           TEXT (compiler, librarian, etc.)
  action          ENUM (create, update, merge, link, unlink)
  diff            JSONB (변경 내용)
  reason          TEXT (AI가 왜 이 변경을 했는지)
  created_at      TIMESTAMP
```

### Learning

```
flashcards
  id              UUID PK
  project_id      UUID FK -> projects
  concept_id      UUID FK -> concepts NULLABLE
  note_id         UUID FK -> notes NULLABLE
  front           TEXT
  back            TEXT
  ease_factor     FLOAT DEFAULT 2.5 (SM-2 algorithm)
  interval_days   INT DEFAULT 1
  next_review     TIMESTAMP
  review_count    INT DEFAULT 0

review_logs
  id              UUID PK
  flashcard_id    UUID FK -> flashcards
  rating          INT (1-5, SM-2)
  reviewed_at     TIMESTAMP

understanding_scores
  id              UUID PK
  user_id         UUID FK -> users
  concept_id      UUID FK -> concepts
  score           FLOAT (0-1)
  last_assessed   TIMESTAMP
```

### Jobs & Billing

```
jobs
  id              UUID PK
  user_id         UUID FK -> users
  project_id      UUID FK -> projects NULLABLE
  type            TEXT (ingest, wiki_compile, research, deep_research, socratic, etc.)
  status          ENUM (queued, running, completed, failed)
  progress        JSONB NULLABLE (단계별 진행 상황, 각 스텝 업데이트)
  input           JSONB
  output          JSONB NULLABLE
  error           TEXT NULLABLE
  created_at      TIMESTAMP
  completed_at    TIMESTAMP NULLABLE

usage_records
  id              UUID PK
  user_id         UUID FK -> users
  action          TEXT (ingest, qa, flashcard, audio, etc.)
  tokens_used     INT
  created_at      TIMESTAMP

conversations
  id              UUID PK
  project_id      UUID FK -> projects
  title           TEXT
  scope           ENUM (project, global)
  created_at      TIMESTAMP

messages
  id              UUID PK
  conversation_id UUID FK -> conversations
  role            ENUM (user, assistant)
  content         TEXT
  sources         JSONB NULLABLE (referenced wiki pages)
  canvas_data     JSONB NULLABLE (interactive artifacts)
  created_at      TIMESTAMP
```

---

## 6. Agent System

11개 에이전트. Temporal이 에이전트 간 워크플로우 오케스트레이션을 담당하고, 각 에이전트 내부 로직은 LangGraph로 구현.

### 워크플로우 아키텍처

```
Hono API 가 Temporal Workflow 시작
                |
    Temporal (결정론적 워크플로우 오케스트레이션)
    ├── 에이전트 실행 순서 관리
    ├── 동시성 제어 (같은 프로젝트 위키를 2개 에이전트가 동시 수정 방지)
    ├── 타임아웃 + 재시도
    ├── 자동 실패 시 마지막 완료 스텝부터 재개
    └── 에이전트 간 목표 충돌 방지 (우선순위 큐)
                |
    Temporal Activity (비결정론적 LLM 호출)
    ├── LangGraph 상태 머신 (에이전트 내부 스텝)
    ├── Gemini API 호출
    └── DB/Storage 접근
```

- **워크플로우 계층**: 결정론적. 어떤 에이전트가 어떤 순서로 실행될지, 타임아웃과 재시도 관리
- **액티비티 계층**: 비결정론적. LLM 호출, 파일 파싱 등 실제 작업. LLM 환각이나 API 오류가 전체 시스템을 붕괴시키지 않음
- **동시성 제어**: 같은 프로젝트의 위키를 수정하는 에이전트를 세마포어로 직렬화

### 6.1 Compiler Agent

자료를 위키로 컴파일하는 핵심 에이전트.

```
Trigger: 새 자료 업로드 후
Flow:
  1. 파싱 (opendataloader로 구조화 + Gemini 멀티모달로 시각 이해)
  2. 청크 + 임베딩 생성 (gemini-embedding-2-preview)
  3. 개념 추출 (Pydantic AI로 구조화)
  4. 기존 위키 검색 (벡터 + BM25 + 그래프)
  5. 판단:
     - 새 개념 -> 위키 페이지 생성
     - 기존 개념 보완 -> 위키 페이지 업데이트
     - 충돌/모순 -> 양쪽 기록 + 사용자에게 알림
  6. 양방향 링크 자동 생성
  7. 지식 그래프 노드/엣지 추가
  8. wiki_logs에 변경 기록
```

### 6.2 Librarian Agent

위키 건강 관리. 주기적으로 전체적인 품질 점검.

```
Trigger: 새 업로드 후 / 정기 스케줄
Flow:
  1. 고아 페이지 탐지 (연결 없는 위키)
  2. 모순 감지 (A 페이지와 B 페이지의 내용 충돌)
  3. 중복 페이지 병합 제안
  4. 공백 보완 제안 (정의 없는 개념 등)
  5. 연결 강화 (내용이 관련인데 링크 없는 페이지 등)
  6. 인덱스 요약 자동 갱신
  7. 학습 약점 분석 (Socratic 결과 기반)
```

### 6.3 Research Agent

심층적 리서치 Q&A.

```
Trigger: 사용자 질문
Flow:
  1. 쿼리 분해 (복합 질문 -> 하위 질문들)
  2. 검색 전략 결정:
     - 벡터 검색 (의미적 유사)
     - BM25 (키워드 정확 매칭)
     - 그래프 탐색 (관련 따라가기)
     - 복합: 결과 통합 (RRF)
  3. 증거 수집 (관련 위키 페이지 읽기)
  4. 추론 + 답변 생성 (출처 링크 포함, Thinking Mode 사용)
  5. 캔버스 렌더링 (필요 시 다이어그램, 차트, 코드)
  6. 위키 개선 (새 사실이 발견 시 위키에 반영)
  7. 학습 경로 생성 (지식 그래프 위상 정렬)
Scope: 프로젝트 범위 또는 글로벌 (사용자 선택)
```

### 6.4 Connector Agent

프로젝트 간 메모리 연결 발견.

```
Trigger: 새 위키 페이지 생성 후 / 주기적
Flow:
  1. 프로젝트 A의 개념 임베딩과 프로젝트 B의 개념 임베딩 비교
  2. 유사성 기준 서로 다른 프로젝트 개념 간 연결 탐지
  3. 관계 유형 분류 (동일 개념, 유사 개념, 상위개념 등)
  4. 사용자에게 제안: "프로젝트 X의 'A'와 프로젝트 Y의 'B'가 연결됨"
  5. 사용자 확인 후 크로스 프로젝트 링크 생성
```

### 6.5 Socratic Agent

이해도 시험 + 학습.

```
Trigger: 사용자 요청 / Librarian의 약점 감지 후
Flow:
  1. 위키 내용 기반 질문 생성 (단순 사실 -> 추론 -> 응용)
  2. 사용자 답변 평가
  3. 오답이면 -> 해설 + 관련 위키 페이지 링크
  4. 이해도 점수 업데이트 (understanding_scores)
  5. 플래시카드 자동 생성 (약한 개념 중심)
  6. 간격 반복 스케줄링 (SM-2 알고리즘)
  7. 복습 알림
```

### 6.6 Temporal Agent

지식 변화 추적.

```
Trigger: 위키 페이지 업데이트 후 / 주기적
Flow:
  1. wiki_logs 분석 -> 개념 수위 변화 추적
  2. "이전에는 X라고 이해했는데, 새 자료 후 Y로 바뀜" 감지
  3. 오래된 지식 감지 (N개월간 업데이트 없음)
  4. 최신 자료 확인 제안
  5. 이해 변화 타임라인 시각적 대시보드 생성
  6. 복습 시점 추천 (에빙하우스 망각 곡선)
```

### 6.7 Synthesis Agent

창발적 연결 생성.

```
Trigger: 주기적 / 사용자 요청
Flow:
  1. 서로 다른 도메인의 개념 임베딩 비교
  2. 구조적 유사성 탐지 (A:B = C:D 패턴)
  3. 통합 생성: "생물학의 면역계 <-> 소프트웨어의 오류 치유"
  4. 사용자에게 제안: "이런 연결을 발견했는데, 흥미롭습니까?"
  5. 확인 후 통합 위키 페이지 생성 (인사이트 기록)
```

### 6.8 Curator Agent

새로운 자료 추천. Gemini Google Search Grounding 사용.

```
Trigger: Librarian의 지식 갭 감지 / 사용자 요청
Flow:
  1. 위키 분석 -> 깊이 부족한 주제 식별
  2. Gemini Search Grounding으로 웹 검색
  3. 관련 자료 랭킹 + 추천
  4. 사용자 확인 후 자동 업로드 -> Compiler가 위키에 통합
```

### 6.9 Narrator Agent

오디오 팟캐스트 생성 (NotebookLM 스타일). Gemini TTS 네이티브 사용.

```
Trigger: 사용자 요청
Flow:
  1. 위키 페이지/프로젝트 선택
  2. 핵심 내용 추출 + 대화식 스크립트 생성
  3. Gemini MultiSpeakerVoiceConfig로 2인 대화 오디오 생성 (API 직접)
  4. 요약 노트 함께 생성
  5. Cloudflare R2에 오디오 파일 저장
```

### 6.10 Deep Research Agent

Gemini Deep Research API 사용. 직접 컨트롤 루프 구축 불필요.

```
Trigger: 사용자 요청
Flow:
  1. 위키에서 기존 지식 수집
  2. Gemini interactions.create(agent='deep-research-pro-preview', background=True)
  3. 폴링으로 진행 상황 추적
  4. 완료 후 결과를 위키 형식으로 변환
  5. 기존 위키와 병합 (Compiler에게 위임)
실행시간: 5-20분 (비동기, 브라우저 꺼도 진행)
```

### 6.11 Code Agent

코드 실행 + 분석 + 과제.

```
Trigger: 사용자 요청 / Research Agent가 코드 실행 필요 시
Flow:
  1. 위키의 기술 지식을 컨텍스트로 사용
  2. 코드 생성 (Python, JS, R 등)
  3. Sandbox에서 실행
  4. 결과 분석 + 시각화
  5. 코딩 과제 출제 + 채점 (학습용 모드)
  6. 데이터 분석 + 차트 생성 (연구용 모드)
  7. 결과물을 위키에 저장 가능
```

### Agent Categorization

**자율형 (사용자 요청 없이 자동 실행):**
- Librarian, Temporal, Synthesis, Curator

**반응형 (사용자 요청에 응답):**
- Compiler (자료 프로세싱), Research, Socratic, Connector, Narrator, Deep Research, Code

---

## 7. Ingest Pipeline

### Hybrid Approach: opendataloader + Gemini Multimodal

구조적 파싱은 로컬, 시각적 이해는 AI.

```
파일 업로드 (Hono API)
  -> Cloudflare R2에 원본 저장
  -> Redis Streams에 ingest job 발행
  -> Python Worker가 대기
    -> [1] opendataloader-pdf로 구조적 파싱
           (텍스트, 수식 -> 표, 코드 -> LaTeX)
    -> [2] 복잡한 페이지 (다이어그램, 차트, 이미지 포함)는
           Gemini Files API로 시각적 분석
    -> [3] 청크된 source 노드 텍스트 생성
    -> Compiler Agent 트리거 -> 위키 컴파일
```

### Supported Sources (v0.1)

| 소스 | 1차 파서 | 2차 보강 (Gemini) |
|------|---------|-------------------|
| PDF | opendataloader-pdf | 다이어그램 차트 이해 |
| 오디오 | faster-whisper (STT) | - |
| 영상 | ffmpeg + faster-whisper | 간단히 |
| 이미지 | - | Gemini Vision (설명 + OCR) |
| YouTube | yt-dlp + faster-whisper | - |
| 웹 URL | trafilatura / readability | - |

### Requirements

- Java 11+ (opendataloader-pdf 의존)
- ffmpeg (영상/오디오 처리)
- GPU 선택사항 (faster-whisper, 없으면 CPU로 동작)

---

## 8. Knowledge Graph

### Storage: PostgreSQL

`concepts` + `concept_edges` 테이블로 구현. 개인 지식 베이스 규모(수만~수십만 노드)에서 충분.

```sql
-- 개념 검색 (벡터 유사도)
SELECT * FROM concepts
WHERE project_id = $1
ORDER BY embedding <=> $2
LIMIT 20;

-- N-hop 탐색 (recursive CTE)
WITH RECURSIVE graph AS (
  SELECT target_id, 1 AS depth
  FROM concept_edges WHERE source_id = $1
  UNION ALL
  SELECT e.target_id, g.depth + 1
  FROM concept_edges e JOIN graph g ON e.source_id = g.target_id
  WHERE g.depth < 3
)
SELECT DISTINCT * FROM graph;
```

### Visualization

- 프론트엔드에서 D3.js force-directed graph로 렌더링
- 노드 클릭 -> 해당 위키 페이지 열기
- 엣지 추가/삭제 -> Hono API -> DB 업데이트
- 필터: 관계 유형별, 프로젝트별, 검색 범위 지정
- 줌 패닝, 노드 드래그

---

## 9. Q&A System (Graph RAG)

### Hybrid Search

3가지 검색을 결합하여 Reciprocal Rank Fusion (RRF)로 최종 랭킹:

1. **Vector Search** -- pgvector + gemini-embedding-2-preview
2. **BM25** -- tsvector, 키워드 정확 매칭
3. **Graph Traversal** -- 개념 그래프 따라가며 관련 노트 수집

### Cost Optimization

- **Gemini Context Caching**: 같은 위키 코퍼스에 반복 질문 시 캐시 활용, 비용 최대 절감
- **Thinking Mode**: 복잡한 질문에만 ThinkingConfig 활성화

### Scope

- **프로젝트 스코프**: 특정 프로젝트 안에서만 검색
- **글로벌 스코프**: 전체 프로젝트에 걸쳐 검색

### Conversations

- 대화 히스토리 저장 (conversations + messages)
- 출처 표시 (어떤 위키 페이지에서 왔는지)
- 캔버스 렌더링 (다이어그램, 차트, 코드 결과)

---

## 10. Canvas & Sandbox

### Canvas (Interactive Artifacts)

Claude Artifacts / Gemini Canvas 스타일. 정적 HTML이 아님. **인터랙티브 React/HTML 실행**.

```
에이전트가 React/HTML 코드 생성
    -> Sandbox 컨테이너가 빌드 + 로컬 서버 실행
    -> 프론트엔드에서 sandboxed iframe으로 렌더링
    -> 사용자가 버튼, 슬라이더, 입력 등 인터랙션 가능
```

| 유형 | 구현 |
|------|------|
| Mermaid 다이어그램 | 프론트 네이티브 렌더링 |
| LaTeX 수식 | KaTeX 프론트 네이티브 렌더링 |
| 인터랙티브 차트 | Sandbox -> React 컴포넌트 -> iframe |
| 슬라이드 | Sandbox -> React 프레젠테이션 -> iframe |
| 실시간 위젯 | Sandbox -> React -> iframe |
| 데이터 분석 | Sandbox -> matplotlib/plotly -> 이미지 또는 인터랙티브 |
| 코드 실행 결과 | Sandbox -> stdout + 파일 |
| 인포그래픽 | Sandbox -> React -> iframe |
| 마인드맵 | Sandbox -> React + D3 -> iframe |

### Sandbox

gVisor(runsc) 런타임 기반 컨테이너에서 코드 실행. 커널 수준 격리로 AI 생성 코드의 컨테이너 탈출 방지.

- **gVisor 런타임** -- 시스템 콜을 게스트 커널이 처리하기 전에 인터셉트 (커널 공유 리스크 제거)
- Python, JavaScript/TypeScript, R 지원
- React 컴포넌트 빌드 + 서빙 (인터랙티브 캔버스용)
- 네트워크: API 서버와만 통신 가능 (외부 차단)
- 시간 제한 (30초 기본, 캔버스 서빙은 세션 동안 유지)
- 메모리 제한 (256MB 기본)
- 결과: stdout + 생성된 파일 (이미지 등) + 서빙 URL (iframe용)
- **SaaS 버전**: 추후 E2B/Firecracker MicroVM으로 업그레이드 가능

---

## 11. Tool Template System

학습/콘텐츠 생성 기능을 일일이 구축하지 않고, **템플릿 기반으로 확장**.

### 구조

```
Tool Template = {
  id: "quiz",
  name: "퀴즈",
  description: "객관식 OX/단답형 문제로 개념 테스트",
  prompt_template: "...",
  output_schema: PydanticModel,
  renderer: "structured" | "canvas",
  scope: ["note", "folder", "project"],
  agent: "socratic" | "research" | "code" | "narrator"
}
```

### 렌더링 방식

| renderer | 동작 |
|----------|------|
| structured | JSON 출력 -> 프론트 네이티브 컴포넌트로 렌더 |
| canvas | React/HTML 생성 -> Sandbox -> iframe |

### 기본 제공 템플릿
**학습 (Socratic Agent)**

| 템플릿 | 설명 | 렌더러 |
|--------|------|--------|
| quiz | 객관식 OX/단답형 퀴즈 | structured |
| flashcard | 앞뒤 카드 뒤기기 | structured |
| fill_blank | 빈칸 채우기 | structured |
| mock_exam | 서술형 객관식 계산형 통합 시험 | structured |
| teach_back | AI에게 설명하면 채점 | structured (대화형) |
| concept_compare | 두 개념 비교표 | structured |
| exam_prep | 빈출 개념 + 예상 문제 | structured |
| exam_predict | 출제 확률 히트맵 | canvas |

**콘텐츠 생성 (Research/Narrator Agent)**

| 템플릿 | 설명 | 렌더러 |
|--------|------|--------|
| summary | 핵심 내용 요약 | structured |
| cheatsheet | A4 한 장 요약 | canvas |
| glossary | 용어 사전 A-Z | structured |
| slides | 프레젠테이션 슬라이드 | canvas |
| mindmap | 계층 구조 시각화 | canvas |
| interactive_html | 인포그래픽, 차트 등 | canvas |
| podcast | 2인 대화 오디오 (Gemini TTS) | audio |
| study_group | 3인 AI 토론 | audio |
| concept_explain | 비유와 예시로 쉽게 설명 | structured |

**분석 (Research/Deep Research Agent)**

| 템플릿 | 설명 | 렌더러 |
|--------|------|--------|
| deep_research | 심층 조사 리포트 (Gemini Deep Research API) | structured + canvas |
| folder_analysis | 폴더 전체 종합 분석 | structured |
| cross_exam | 여러 프로젝트 통합 시험 | structured |

**코드 (Code Agent)**

| 템플릿 | 설명 | 렌더러 |
|--------|------|--------|
| coding_challenge | 코딩 과제 + AI 힌트 | canvas (실행 가능) |
| data_analysis | 데이터 분석 + 차트 (Plotly 등) | canvas |
| math_animation | Manim 기반 2D/3D 수학 및 물리 시각화 | canvas (비디오 렌더링) |
| molecule_3d | PDB 기반 3D 분자 구조 인터랙티브 뷰어 | canvas |
| interactive_timeline| 역사/사건 인포그래픽 슬라이더 렌더링 | canvas |

### 확장

새 템플릿 추가 = JSON 정의 파일 하나 + (structured면 프론트 렌더러 컴포넌트 하나.
canvas 타입은 렌더러 추가 불필요 (Sandbox가 동적 생성).

---

## 12. Async Job Execution

모든 에이전트 작업은 **브라우저 독립적으로 실행**. Temporal의 상태가 영구 보존.

### Flow

```
사용자 요청 (브라우저)
    -> Hono API -> Temporal Workflow 시작 -> 즉시 workflow_id 반환
    -> 브라우저 꺼도 진행됨

Temporal Server
    -> 워크플로우 상태 영구 보존
    -> Python Worker(Temporal Worker)에 Activity 할당

Python Worker
    -> Activity 실행 (LangGraph + Gemini API)
    -> 실패 시 Temporal이 자동 재시도 (마지막 완료 Activity부터)
    -> 완료 후 jobs.status = completed, output 저장
사용자 재접속    -> 완료된 job 결과 확인
```

### 실시간 진행 (브라우저 열려 있을 때)

- WebSocket 또는 SSE로 진행 상황 스트리밍
- Deep Research: "10개 소스 중 7개 분석 완료..."
- Compiler: "위키 페이지 3개 생성, 2개 업데이트 중..."
- 브라우저 꺼도 연결 끊어지지 않고 작업은 계속 진행

### 알림

- 작업 완료 후 앱 내 인앱 알림 배지 표시
- 추후: 이메일 및 푸시 알림

---

## 13. Billing

### Plans

| 플랜 | 가격 | 프로젝트 | Q&A | 오디오 생성 | 스토리지 |
|------|------|---------|-----|-----------|---------|
| Free | $0 | 최대 10개 | 최대 50개 | 최대 3개 | 100MB |
| Pro | 월 $X (미정) | 무제한 | 무제한 | 무제한 | 10GB |
| BYOK | 월 $Y (미정, Pro보다 저렴) | 무제한 | 무제한 | 무제한 | 10GB |

- BYOK 플랜은 자기 Gemini API 키 등록, AI 비용은 본인 부담
- Stripe Checkout으로 구독 관리
- usage_records 테이블로 사용량 추적
- 셀프호스팅 시 빌링 비활성화 (환경변수로 제어, 기본적으로 무제한)

---

## 14. Auth

- 멀티유저 (개별 계정 로그인)
- Better Auth (Hono 연동)
- 세션 기반 (Redis에 세션 저장)
- OAuth 추후 추가 가능 (Google, GitHub)

---

## 15. Organization

### Hierarchy

```
User
  └── Project (격리 단위)
        ├── Folders (중첩 가능)
        │     └── Notes
        ├── Tags
        │     └── Notes (M:N)
        └── Conversations
```

- 프로젝트 간 지식이 기본 격리
- Connector Agent가 프로젝트 간 연결 제안
- 글로벌 Q&A는 전체 프로젝트 검색 가능

---

## 16. Docker Compose

### Services (8개)

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: opencairn
      POSTGRES_USER: opencairn
      POSTGRES_PASSWORD: changeme

  temporal:
    image: temporalio/auto-setup:latest
    depends_on: [postgres]
    ports: ["7233:7233"]
    environment:
      DB: postgresql
      DB_PORT: 5432
      POSTGRES_USER: opencairn
      POSTGRES_PWD: changeme

  redis:
    image: redis:7-alpine
    volumes: [redisdata:/data]

  Cloudflare R2:
    image: Cloudflare R2/Cloudflare R2
    command: server /data --console-address ":9001"
    volumes: [Cloudflare R2data:/data]
    environment:
      Cloudflare R2_ROOT_USER: Cloudflare R2admin
      Cloudflare R2_ROOT_PASSWORD: Cloudflare R2admin

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    depends_on: [api]
    ports: ["3000:3000"]

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    depends_on: [postgres, redis, Cloudflare R2, temporal]
    ports: ["4000:4000"]

  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    depends_on: [postgres, redis, Cloudflare R2, temporal]

  sandbox:
    build: { context: ., dockerfile: apps/sandbox/Dockerfile }
    runtime: runsc  # gVisor runtime for kernel-level isolation
    privileged: false

volumes:
  pgdata:
  redisdata:
  Cloudflare R2data:
```

### Environment Variables

```env
# Required
GEMINI_API_KEY=your-api-key

# DB
DATABASE_URL=postgresql://opencairn:changeme@postgres:5432/opencairn

# Redis
REDIS_URL=redis://redis:6379

# Storage (Cloudflare R2)
S3_ENDPOINT=http://Cloudflare R2:9000
S3_ACCESS_KEY=Cloudflare R2admin
S3_SECRET_KEY=Cloudflare R2admin
S3_BUCKET=opencairn

# Billing (optional)
BILLING_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Auth
AUTH_SECRET=random-secret-here
```

### Quick Start (셀프호스팅)

```bash
git clone https://github.com/opencairn/opencairn.git
cd opencairn
cp .env.example .env
# .env에 GEMINI_API_KEY를 설정
docker-compose up -d
# http://localhost:3000
```

### Production (GCP)

```bash
# GCE VM (e2-standard-4, 4 vCPU, 16GB)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

원하면 커뮤니티 하나하나 관리형으로 교체:
- PostgreSQL -> Cloud SQL
- Redis -> Memorystore
- Cloudflare R2 -> Cloud Storage

---

## 17. License

**AGPLv3 + CLA + 듀얼 라이선싱 준비**

- AGPLv3: 네트워크 사용 시에도 소스 공개 의무 (SaaS 판매를 방지)
- CLA: 기여자 라이선스 의향 (저작권 모기업 귀속)
- 듀얼 라이선싱: CLA에 의해 보유된 저작권으로, 이후 엔터프라이즈 고객에게 AGPL 감염 우려 없는 상용 라이선스 판매 가능
  - 오픈소스 버전: AGPLv3 (커뮤니티, 개인, 소규모 기업)
  - 상용 라이선스: 이후 (엔터프라이즈, 금융, 헬스케어 등 AGPL 제한 조직)

---

## 18. Scope

### v0.1 (첫 공개)

- [x] 랜딩페이지 + 블로그 (Next.js SSG + MDX)
- [x] 멀티유저 인증
- [x] 프로젝트 / 폴더 / 태그 조직
- [x] Plate 블록 에디터 (LaTeX, 위키링크, 슬래시 커맨드)
- [x] 자료 업로드 (opendataloader + Gemini 하이브리드)
- [x] Compiler Agent (자료 -> 위키 자동 컴파일)
- [x] Librarian Agent (위키 건강 관리)
- [x] Research Agent (Graph RAG Q&A)
- [x] Connector Agent (프로젝트 간 메모리 연결)
- [x] Socratic Agent (이해도 시험 + 플래시카드)
- [x] Temporal Agent (지식 변화 추적)
- [x] Synthesis Agent (창발적 연결)
- [x] Curator Agent (새로운 자료 추천, Gemini Search Grounding)
- [x] Narrator Agent (오디오 팟캐스트, Gemini TTS)
- [x] Deep Research Agent (Gemini Deep Research API)
- [x] Code Agent (코드 실행, 과제, 분석)
- [x] 지식 그래프 시각화 (인터랙티브)
- [x] 캔버스 (인터랙티브 React/HTML, Sandbox iframe)
- [x] Tool Template System (퀴즈, 슬라이드, 마인드맵 등)
- [x] 비동기 작업 실행 (브라우저 꺼도 진행, 각 스텝 DB 저장)
- [x] 빌링 (Free/Pro/BYOK, Stripe)
- [x] Docker Compose 원클릭 배포

### v0.2+

- 모바일 앱
- OAuth (Google, GitHub)
- 협업 (실시간 공동 편집)
- 플러그인 시스템
- CLI 도구
- Gemini Live API (실시간 음성 Q&A)
- 파인튜닝 (지식 -> 모델 가중치)
