# OpenCairn - System Design Spec v2

> AI knowledge base for learning, research, and work.
>
> "What Karpathy described, as a product"

> **2026-04-14~20 업데이트**: 본 원본은 2026-04-09 작성. 이후 주요 변경:
> - 2026-04-14: gVisor/apps/sandbox 폐기 → Pyodide/iframe (ADR-006). 12 에이전트 (Visualization 추가). Toss Payments (원화).
> - 2026-04-15: OpenAI provider 제거. Gemini+Ollama 2개만.
> - 2026-04-18: Workspace 3계층 (Workspace→Project→Page). Notion급 협업 (코멘트/@mention/알림/공개링크/게스트).
> - 2026-04-19: 가격 개편. Pro ₩4,900 + PAYG (₩5,000 선불, 만료X, $1=₩1,650). BYOK ₩2,900 (본인 Gemini 키, 단일 사용자 호스팅).
> - 2026-04-20: Agent Chat Scope (Page/Project/Workspace 3계층, L1-L4 메모리, Strict/Expand RAG, Pin). Agent Runtime Standard (@tool, AgentEvent, Agent ABC, Hook 3계층, Trajectory). 결제 레일은 사업자등록 후 결정 — BLOCKED.
>
> 상세: CLAUDE.md, collaboration-model.md, billing-model.md, agent-chat-scope-design.md, agent-runtime-standard-design.md.

---

## 1. Product Vision

NotebookLM + Notion + Cursor를 합친 **개인·팀 지식 OS**.

협업 측면에서는 Notion을 대체하면서 AI 지식 엔진이 추가된 포지션. 규제 산업·대학·연구소 대상 셀프호스팅 옵션으로 진입 장벽이 다른 경쟁자 부재. 상세 협업 설계는 [collaboration-model.md](../../architecture/collaboration-model.md).

- **자료 -> 지식화**: 자료(PDF, 영상, 오디오, 이미지, URL)를 올으면 AI가 위키를 컴파일
- **노트 작성 + 연결**: Notion 스타일 블록 에디터로 직접 노트 작성, 위키링크로 연결
- **AI 파워로 탐색**: 개인 지식에 대한 심층 리서치, Graph RAG Q&A
- **학습 시스템**: 플래시카드, 간격 반복, 소크라테스식 문답, 오디오 팟캐스트
- **캔버스**: 인터랙티브 React/HTML 렌더링 (Claude Artifacts 스타일)
- **코드 실행**: 샌드박스에서 코드 실행, 과제 채점
- **딥 리서치**: Gemini Deep Research API + 위키 자동 통합
- **지식 인터뷰**: 특정 노트/개념을 에이전트로 취급해 직접 대화 — "이 논문 저자 관점에서 대답해줘" (NotebookLM에도 없는 기능)
- **시나리오 시뮬레이션**: "내 지식베이스 기준으로 이 가설 적용하면?" — 지식 그래프 위에서 What-if 시나리오 실행
- **도메인 온톨로지 자동 설계**: 프로젝트 생성 시 LLM이 도메인 맞춤 엔티티 스키마 설계 → LightRAG KG 품질 향상
- **지식 진화 타임라인**: wiki_logs 기반으로 지식 그래프가 어떻게 성장했는지 시각화
- **SaaS**: 랜딩페이지, 블로그, 빌링 포함

### 타겟 페르소나 (3단계 확장)

| 단계 | Primary | 핵심 니즈 | 주요 기능 | 관문 |
|------|---------|----------|----------|------|
| **v0.1** | 대학원생 / 리서처 | 논문 정리, Q&A, 학습 | Compiler, Research, Socratic, Deep Research, KG 5뷰 | 개인 도구로 신뢰 획득 |
| **v0.2** | 연구실 / 소규모 팀 (3~15명) | 집단 지식 관리, 공동 편집 | + Workspace, 멤버·권한, 코멘트, @mention, 알림, Presence | 팀 도입 "grass-roots" |
| **v0.3** | 규제 산업 엔터프라이즈 (금융·의료·공공·대학) | 컴플라이언스, 데이터 주권, Notion 대체 | + SSO (SAML/OIDC), 감사 로그, Guest, 공개 링크, Ollama 완전 로컬 | 공식 도입·유료 계약 |

v0.1에서 이미 협업 기반 (Workspace 데이터 모델, 역할, 기본 권한, 실시간 편집)은 갖추고 시작함. v0.2 이상은 UI/기능 확장. 구조 변경은 v0.1에 박아둠.

---

## 2. Architecture Overview

```
Browser (Workspace-scoped)
  |
  v
Next.js 16 (Frontend)
  |  - 랜딩페이지, 블로그 (SSG, SEO)
  |  - 앱 대시보드 (CSR, API 호출만)
  |  - URL 구조: /app/w/<workspace>/p/<project>/notes/<note>
  |  - Server Action 없음, DB 접근 없음
  |
  | REST API  +  WebSocket (Hocuspocus, Yjs CRDT)
  v
Hono (Backend API, TypeScript)
  |
  |--- PostgreSQL + pgvector (DB)
  |--- Temporal (Durable Workflow Orchestration)
  |--- Redis (Cache + Session)
  |--- Cloudflare R2 / MinIO (File Storage, S3 compatible)
  |--- Toss Payments (Billing, Korea)
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
  |--- opendataloader-pdf (PDF 텍스트, Java 11+)
  |--- pymupdf (스캔 PDF 감지)
  |--- markitdown (Office: DOCX/PPTX/XLSX)
  |--- unoserver + H2Orestart (문서→PDF 뷰어 변환, HWP/HWPX 지원)
  |--- faster-whisper (로컬 STT fallback)
  |--- LightRAG (RAG + Knowledge Graph 자동 구축)
  |--- LLM provider 멀티모달 (Gemini: gemini-3-flash-preview)
  |
  v (S3 API)
Cloudflare R2 / MinIO

Browser (Code Execution)
  |--- Pyodide (WASM Python)
  |--- <iframe sandbox="allow-scripts"> + esm.sh (JS/HTML/React)
```

### Core Principles

- **Next.js는 UI + 마케팅** -- SSG(랜딩/블로그), CSR(앱). Server Action 없음
- **Hono가 모든 비즈니스 로직의 게이트웨이** -- 인증, CRUD, 파일 프로세싱, 워크플로우 트리거
- **무거운 AI 처리는 전부 Python Worker** -- 에이전트, 위키 생성, 이벤트 실행
- **Temporal로 에이전트 워크플로우 오케스트레이션** -- 영구적 실행, 자동 복구, 타임아웃, 동시성 제어. 12개 에이전트 간 충돌 방지
- **Gemini 네이티브 기능 최대한 활용** -- TTS, Deep Research, 검색 그라운딩, 캐싱을 직접 구축하지 않음
- **브라우저 샌드박스** -- AI 생성 코드는 Pyodide (WASM) / `<iframe sandbox>`로 클라이언트에서 실행. 서버는 코드를 한 줄도 실행하지 않는다. 근거는 [ADR-006](../../architecture/adr/006-pyodide-iframe-sandbox.md)
- **Workspace가 격리 경계** -- 모든 데이터·에이전트·검색·Yjs 문서·알림은 workspace 스코프로 제한. 개인 워크스페이스와 회사 워크스페이스 데이터는 절대 섞이지 않는다. 상세: [collaboration-model.md](../../architecture/collaboration-model.md)
- **권한은 데이터 레이어에서** -- `canRead(user, resource)` / `canWrite(user, resource)` 헬퍼를 모든 쿼리가 경유. Hocuspocus WebSocket도 연결 시 auth hook으로 권한 검증.
- **환경변수만 바꾸면 셀프호스팅 <-> 클라우드 전환**

### URL 구조

```
opencairn.com/                            -> 랜딩 (SSG)
opencairn.com/blog                         -> 블로그 (MDX + SSG)
opencairn.com/docs                         -> 문서 (SSG)
opencairn.com/pricing                      -> 가격 (SSG)
opencairn.com/login                        -> 인증
opencairn.com/app                          -> 워크스페이스 선택 (CSR)
opencairn.com/app/w/<workspace>            -> workspace 대시보드 (프로젝트 목록, 활동 피드)
opencairn.com/app/w/<workspace>/members    -> 멤버 / 초대 관리
opencairn.com/app/w/<workspace>/p/<proj>   -> 프로젝트 (CSR)
opencairn.com/app/w/<workspace>/p/<proj>/notes/<note>  -> 노트·위키 페이지
opencairn.com/s/<token>                   -> 공개 공유 링크 (비로그인 접근)
opencairn.com/invite/<token>              -> 초대 수락
```

---

## 3. Tech Stack

### Frontend

| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js (App Router) | 16.x | SSG(랜딩/블로그) + CSR(앱) |
| React | 19.x | UI |
| Plate | 49.x | 블록 에디터 (LaTeX MathKit, 위키링크, 슬래시 커맨드, AIPlugin) |
| @platejs/yjs + Hocuspocus Provider | latest | 실시간 협업 (CRDT, 멀티디바이스 동시편집) |
| shadcn/ui | latest | UI 컴포넌트 |
| Tailwind CSS | 4.x | 스타일링 (CSS-first config) |
| TanStack Query | latest | API 상태 관리 |
| next-intl | latest | 다국어 (en default, ko secondary) |
| Cytoscape.js + react-cytoscapejs | latest | 지식 그래프 5뷰 (Graph/Mindmap/Cards/Canvas/Timeline), cose-bilkent/dagre/fcose 레이아웃 |
| Excalidraw 또는 react-zoom-pan-pinch | latest | Canvas 뷰 (무한 캔버스, 자유 배치) |
| KaTeX | latest | LaTeX 렌더링 |
| Mermaid | latest | 다이어그램 렌더링 |
| MDX | latest | 블로그 콘텐츠 |
| Pyodide (WASM) | latest | 브라우저 내 Python 실행 (Canvas 샌드박스) |
| Browser-native PDF viewer | current browser | PDF 뷰어 (내장 검색/줌/페이지 탐색, 앱은 보안 래퍼 + 열기/다운로드/새로고침 chrome 제공) |

### Backend API

| 기술 | 버전 | 용도 |
|------|------|------|
| Hono | 4.x | HTTP API 서버 |
| Drizzle ORM | 0.45.x | DB 접근 (PostgreSQL) |
| Better Auth | latest | 인증/세션 (OAuth, Magic Link, Passkeys) |
| Toss Payments | latest | 빌링 (Free/Pro/BYOK, 한국 시장) |
| Resend (+SMTP fallback) | latest | 이메일 (가입 인증, 알림) |
| Hocuspocus Server | latest | Yjs 협업 서버 (PostgreSQL 영속화, Better Auth 인증 연동) |
| Sentry (optional) | latest | 에러/로깅 (셀프호스트는 GlitchTip 대안) |
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
| packages/llm (custom adapter) | Gemini/Ollama 추상화 (get_provider 팩토리), transcribe()/ocr()/analyze_image()/think()/tts() graceful degradation. OpenAI는 2026-04-15 결정으로 제거됨 (multi-llm-provider-design 참조) |
| google-genai | Gemini API SDK (production provider) |
| opendataloader-pdf | PDF 텍스트 추출 (Java 11+, 벤치마크 0.907, fast mode 0.015s/page) |
| pymupdf | PDF 스캔 감지 (텍스트 레이어 유무 확인, 무료 즉각) |
| markitdown[docx,pptx,xlsx,xls] | Office 문서 텍스트 추출 (MS oss) |
| unoserver + H2Orestart | 문서→PDF 변환 (뷰어용). LibreOffice 상시 서버, HWP/HWPX 지원 |
| faster-whisper | 로컬 STT (Ollama 모드에서 오디오 전사, WHISPER_MODEL env) |
| trafilatura | 웹 URL 스크래핑 (정적 HTML) |
| crawl4ai | JS 렌더링 사이트 스크래핑 (선택적, Playwright 기반) |
| yt-dlp | YouTube/영상 다운로드 fallback |
| lightrag-hku | RAG + 지식 그래프 자동 구축 (엔티티/관계 추출, 벡터+그래프 하이브리드 검색) |
| psycopg | PostgreSQL 접근 |
| redis (py) | Redis 캐시 접근 |
| boto3 | Cloudflare R2/S3 파일 접근 |

### Gemini API 네이티브 모델 분업 매핑 전략

오픈카이른 (OpenCairn)은 비용 효율성과 성능을 극대화하기 위해 각 에이전트의 워크로드 특성에 맞춰 최적화된 최신 모델을 할당합니다.

| 에이전트/기능 | 할당 모델 (Model) | 선택 이유 및 설명 |
|------|-----------|--------|
| **Brain (추론 코어)** | `Gemini 3.1 Pro` | 고도의 지능이 요구되는 **Synthesis(통합)** 및 복합 추론 |
| **Worker (가성비/캐시)** | `Gemini 3.1 Flash-Lite` | 1M+ 토큰 캐싱을 활용하는 **Research(Q&A)**, **Compiler**, **Socratic(학습)** |
| **Visualization (5뷰)** | `Gemini 3.1 Flash-Lite` | 지식 그래프를 5뷰(Graph/Mindmap/Cards/Canvas/Timeline)로 배치·레이아웃하는 구조화 출력 에이전트 |
| **Deep Research** | `Gemini Deep Research` | 심층적 조사를 자율적으로 계획/실행하는 전담 에이전트 |
| **Narrator (팟캐스트)** | `Gemini 2.5 Pro TTS` | 위키 텍스트를 고품질 멀티 화자 음성 오디오북/팟캐스트로 생성 |
| **Voice Q&A (실시간, v0.2)** | `Gemini 3.1 Flash Live` | 지연 시간에 민감한 A2A 라이브 음성 채팅. v0.1 범위 밖 |
| **RAG / 멀티 임베딩** | `Gemini Embedding 2` | 텍스트, 이미지, 비디오, 오디오를 하나의 임베딩 공간에 매핑하는 하이브리드 RAG |
| **Canvas (생성형 시각화)** | `Nano Banana Pro` | 위키 내용 기반의 고해상도 인포그래픽, 4K 시각적 레이아웃 생성 |

> **Hunter 에이전트**: 초기 설계 시 Computer-Use 모델 기반 자료 수집 에이전트를 검토했으나, v0.1에서는 **Curator Agent (Google Search Grounding)** 로 대체하고 Hunter는 v0.2로 이관한다. Curator가 지식 갭 감지 + Gemini Search Grounding + 추천 생성을 전담하며, 대화형 스크래핑은 불필요하다고 판단.

### Infrastructure

| 서비스 | 이미지 | 용도 |
|--------|--------|------|
| postgres | pgvector/pgvector:pg16 | DB + 벡터 인덱스 + BM25 |
| temporal | temporalio/auto-setup | 워크플로우 오케스트레이션 (영구적 실행) |
| redis | redis:7-alpine | 세션/캐시 |
| hocuspocus | ghcr.io/tiptap/hocuspocus | Yjs 협업 서버 (PostgreSQL extension으로 영속화) |
| cloudflare-r2 / minio | cloudflare r2 또는 호환 | 파일 저장소 (S3 호환) |
| web | apps/web Dockerfile | Next.js 16 (standalone) |
| api | apps/api Dockerfile | Hono 4 백엔드 API |
| worker | apps/worker Dockerfile | Python AI Worker (Python 3.12 + Java 11 + unoserver + H2Orestart + faster-whisper, x86_64/aarch64 멀티아치) |
| ollama (optional) | ollama/ollama | 완전 로컬 LLM (LLM_PROVIDER=ollama 시 활성화, profiles 기반) |

**~~sandbox 서비스 제거됨 (2026-04-14):** 코드 실행이 전부 브라우저 내부(Pyodide + iframe sandbox)로 이동. gVisor, Docker 샌드박스, Vite 빌더 전부 폐기.*

총 8~9개 서비스 (Ollama 옵션 포함). `docker-compose up -d` 한 방.

**호스팅 전략:**
- **호스팅 환경 미정** — Oracle Cloud, Hetzner, AWS, Fly.io 등 후보. Production 결정은 Plan 후반에서 베이스라인 부하 측정 후 선택.
- **Docker 이미지 요구사항**: 전체 스택은 **x86_64 + linux/arm64 멀티아치 빌드** 필수 (`docker buildx`)
- **자원 가이드**: 단일 사용자 셀프호스트 기준 최소 4 vCPU + 8GB RAM, 권장 8 vCPU + 16GB RAM (Temporal + LightRAG + Worker가 주요 자원 소비)

---

## 4. Monorepo Structure

```
opencairn/
  apps/
    web/            -- Next.js 16 (SSG 랜딩/블로그 + CSR 앱, Pyodide/iframe 샌드박스 클라이언트 사이드 포함)
    api/            -- Hono (Backend API, TypeScript)
    worker/         -- Python (AI Agents, LangGraph, Temporal activities)
    hocuspocus/     -- Yjs 협업 서버 (Node.js, Better Auth 연동)

  packages/
    db/             -- Drizzle ORM schema + migrations
    llm/            -- Python LLM provider adapters (Gemini/Ollama, get_provider 팩토리 — OpenAI는 2026-04-15 제거)
    ui/             -- shadcn/ui shared components
    config/         -- ESLint, TypeScript shared config
    shared/         -- Shared types (Zod 스키마, API 계약)

  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  LICENSE           -- AGPLv3
  README.md
```

---

## 5. Data Model

> **협업 계층 상세**: 다음은 핵심 개요. workspace_members, workspace_invites, project_permissions, page_permissions, comments, comment_mentions, notifications, notification_preferences, activity_events, public_share_links 등 협업 전담 테이블 전체 스키마는 [collaboration-model.md §2](../../architecture/collaboration-model.md)에 정리됨.

### Core Tables

```
users                                           -- Better Auth가 관리. id는 text 타입
  id              TEXT PK
  email           TEXT UNIQUE
  name            TEXT
  password_hash   TEXT
  llm_provider    ENUM (gemini, ollama) DEFAULT 'gemini'  -- openai는 2026-04-15 제거
  llm_api_key     TEXT NULLABLE (AES-256-GCM encrypted, BYOK Gemini 모드에서 사용)
  ollama_base_url TEXT NULLABLE (완전 로컬 모드에서만)
  whisper_model   TEXT NULLABLE (tiny|base|small|medium|large-v3)
  created_at      TIMESTAMP

workspaces                                      -- 격리 경계 (collaboration-model 참조)
  id              UUID PK
  slug            TEXT UNIQUE                   -- URL용 (예: "acme-corp")
  name            TEXT
  owner_id        TEXT FK -> users
  plan_type       ENUM (free, pro, enterprise)  -- 요금제는 workspace-level
  created_at      TIMESTAMP

workspace_members                               -- 멤버십 + 역할
  workspace_id    UUID FK -> workspaces
  user_id         TEXT FK -> users
  role            ENUM (owner, admin, member, guest)
  joined_at       TIMESTAMP
  PRIMARY KEY (workspace_id, user_id)

projects
  id              UUID PK
  workspace_id    UUID FK -> workspaces        -- ★ user_id 대신 workspace_id
  name            TEXT
  description     TEXT
  created_by      TEXT FK -> users             -- 생성자 기록용 (권한 계산 안 함)
  default_role    ENUM (editor, viewer) DEFAULT 'editor'  -- workspace member가 이 프로젝트에 가지는 기본 역할
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

- **사용자 플랜이 아니라 Workspace 플랜**: 같은 사용자가 개인 Free 워크스페이스 + 회사 Enterprise 워크스페이스에 동시 소속 가능.
- **Better Auth users.id는 text** (uuid 아님). 모든 FK에서 text 타입 사용 (Drizzle schema에서 자주 실수하는 지점).

### Notes & Wiki

```
notes
  id              UUID PK
  workspace_id    UUID FK -> workspaces (denormalized, 권한·검색 쿼리 속도용)
  project_id      UUID FK -> projects
  folder_id       UUID FK -> folders NULLABLE
  title           TEXT
  content         JSONB (Plate block format)
  content_text    TEXT (plain text for BM25)
  content_tsv     TSVECTOR (generated, BM25 index)
  embedding       VECTOR(VECTOR_DIM) (default 3072, 권장 운영값 1536 — storage-planning 참조)
  type            ENUM (note, wiki, source)
  source_type     ENUM (manual, pdf, audio, video, image, youtube, web) NULLABLE
  source_file_key TEXT NULLABLE (S3/R2 object key)
  is_auto         BOOLEAN (AI가 생성했으면 true, 사용자 수동 편집 시 false로 전환)
  inherit_parent  BOOLEAN DEFAULT true (false면 페이지 권한 상속 끊음 — Notion 방식)
  created_by      TEXT FK -> users                -- 초기 생성자 (AI면 agent 이름)
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

### Activity Events (wiki_logs의 확장)

2026-04-18 협업 도입 시 `wiki_logs`를 `activity_events`로 리네이밍·확장. 위키 편집 뿐만 아니라 코멘트, 공유, 권한 변경 등 workspace 내 **모든 활동**을 기록. 상세 스키마는 [collaboration-model.md §2.5](../../architecture/collaboration-model.md).

```
activity_events
  id              UUID PK
  workspace_id    UUID FK -> workspaces        (스코프)
  actor_id        TEXT (user_id 또는 agent 이름)
  actor_type      ENUM (user, agent)
  verb            ENUM (created, updated, deleted, commented, invited, joined,
                        role_changed, shared_public, wiki_merged, 등)
  object_type     ENUM (note, project, workspace, comment, invite, link)
  object_id       TEXT
  diff            JSONB NULLABLE
  reason          TEXT NULLABLE (AI가 왜 그랬는지)
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

12개 에이전트 (v0.1 전체). Temporal이 에이전트 간 워크플로우 오케스트레이션을 담당하고, 각 에이전트 내부 로직은 LangGraph로 구현.

> **2026-04-14 명단 확정**: Compiler / Librarian / Research / Connector / Socratic / Temporal / Synthesis / Curator / Narrator / Deep Research / Code / Visualization = 12개.
> **Visualization Agent**가 5뷰 피봇과 함께 v0.1에 추가되었고 (이전 설계의 "11개"에서 +1), 초기 설계의 **Hunter Agent**는 v0.2로 이관 (Curator의 Search Grounding이 v0.1 기능을 커버).
> 다른 문서에서 "11개 에이전트"라고 기술된 부분은 순차적으로 업데이트되고 있음 (CLAUDE.md, prd, agent-behavior-spec 등).

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
  2. 코드 생성 (Python or React/JS/HTML) — 서버는 문자열만 반환
  3. 브라우저가 실행:
     - Python: Pyodide (WASM) — numpy/pandas/matplotlib 등
     - React/JS/HTML: <iframe sandbox="allow-scripts"> + esm.sh
  4. stdout/에러를 postMessage로 Agent에게 피드백
  5. 필요 시 self-healing 반복 (max 3 iteration)
  6. 결과 분석 + 시각화 (차트/표)
  7. 코딩 과제 출제 + 채점 (학습용 모드)
  8. 결과물을 위키에 저장 가능
```

(ADR-006의 브라우저 샌드박스 정책 적용)

### 6.12 Visualization Agent

지식 그래프를 5뷰(Graph/Mindmap/Cards/Canvas/Timeline)로 배치/레이아웃.

```
Trigger: 사용자가 뷰 전환 / 필터 변경 시
Flow:
  1. concepts + concept_edges 로드 (프로젝트 또는 전체)
  2. 선택된 뷰에 맞게 레이아웃 계산:
     - Graph: cose-bilkent force-directed
     - Mindmap: dagre 계층형
     - Cards: grid + 메타데이터 sorting
     - Canvas: 사용자 저장된 좌표 or 자동 초기 배치
     - Timeline: wiki_logs 기준 시간축 투영
  3. Gemini Flash-Lite로 뷰별 최적 파라미터 추천 (구조화 출력)
  4. Cytoscape.js JSON 스펙 반환 → 프론트 렌더링
Scope: 읽기 전용, 위키 수정 없음
```

### Agent Categorization

**자율형 (사용자 요청 없이 자동 실행):**
- Librarian, Temporal, Synthesis, Curator

**반응형 (사용자 요청에 응답):**
- Compiler (자료 프로세싱), Research, Socratic, Connector, Narrator, Deep Research, Code, Visualization

---

## 7. Ingest Pipeline

### Hybrid Approach: 로컬 파싱 + Gemini Multimodal

구조적 파싱은 로컬, 시각적 이해는 AI. 2026-04-14 피봇으로 파싱 스택 전환 완료.

```
파일 업로드 (Hono API)
  -> Cloudflare R2/MinIO에 원본 저장
  -> Temporal IngestWorkflow 시작 (Redis Streams 아님 — ADR-002 참조)
  -> Python Worker가 Activity 실행
    -> [1] 포맷별 파싱
         * PDF: pymupdf로 스캔 감지 → opendataloader-pdf (디지털) or provider.ocr() (스캔)
         * Office(DOCX/PPTX/XLSX/XLS): markitdown으로 텍스트, unoserver로 뷰어용 PDF
         * HWP/HWPX: unoserver + H2Orestart → PDF → opendataloader-pdf
         * 오디오/영상: provider.transcribe() (Gemini multimodal or faster-whisper)
         * 이미지: provider.generate(image=) (Gemini Vision / Ollama llava)
         * YouTube: Gemini YouTube URL 직접 or yt-dlp fallback
         * 웹 URL: trafilatura (정적) / crawl4ai (JS 렌더링, 선택적)
    -> [2] 복잡한 레이아웃 감지 시 Gemini 멀티모달 enhance
    -> [3] notes 테이블에 source 노트 생성, pgvector 임베딩 저장
    -> [4] Compiler Agent 트리거 -> 위키 컴파일
```

### Supported Sources (v0.1)

| 소스 | 1차 파서 | 2차 보강 (Gemini) |
|------|---------|-------------------|
| PDF (디지털) | opendataloader-pdf | 다이어그램/차트 복잡 페이지 |
| PDF (스캔) | pymupdf 감지 → provider.ocr() | — |
| DOCX/PPTX/XLSX/XLS | markitdown (텍스트) + unoserver (뷰어 PDF) | — |
| HWP/HWPX | unoserver + H2Orestart → PDF | opendataloader-pdf 재파싱 |
| 오디오 | provider.transcribe() (Gemini / faster-whisper) | — |
| 영상 | ffmpeg → provider.transcribe() | — |
| 이미지 | provider.generate(image=) (Gemini Vision / llava) | — |
| YouTube | Gemini YouTube URL or yt-dlp + provider.transcribe() | — |
| 웹 URL | trafilatura (정적 HTML) | — |
| 웹 URL (JS 렌더) | crawl4ai (선택적, Playwright 기반) | — |

### Requirements

- Java 11+ (opendataloader-pdf — Dockerfile은 LTS 호환성을 위해 openjdk-21 사용)
- ffmpeg (영상/오디오 처리)
- LibreOffice (unoserver 런타임)
- H2Orestart 확장 (unoserver 컨테이너에 설치 — HWP/HWPX 지원)
- GPU 선택사항 (faster-whisper large-v3에서 유리, 없으면 CPU로 medium까지)

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

### Visualization — 5뷰 체계 (2026-04-14)

Cytoscape.js + react-cytoscapejs 기반. 단일 데이터(concepts + concept_edges)를 5개 관점으로 재구성한다. 구현은 Plan 5 참조.

| 뷰 | 레이아웃 | 용도 |
|----|---------|------|
| **Graph** | cose-bilkent (force-directed) | 전체 개념 네트워크 탐색, 클러스터 시각화 |
| **Mindmap** | dagre 계층형 | 중심 개념 기준 방사형 확장, 하위 개념 정리 |
| **Cards** | grid 배치 + 메타데이터 | 개념을 카드로 훑기, 검색·필터 1순위 |
| **Canvas** | 사용자 자유 배치 (Excalidraw 류) | 학습 세션용 워크스페이스, 드래그 앤 드롭 |
| **Timeline** | wiki_logs 기반 시간축 | 지식이 어떻게 진화했는지 추적, 복습 시점 |

공통 인터랙션:
- 노드 클릭 → 해당 위키 페이지 열기
- 엣지 추가/삭제 → Hono API → DB 업데이트
- 필터: 관계 유형별, 프로젝트별, 검색 범위
- 줌/팬/노드 드래그
- Visualization Agent가 뷰 전환 시 최적 레이아웃을 추천 (Gemini Flash-Lite 구조화 출력)

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

## 10. Canvas & Sandbox (브라우저 실행, 2026-04-14)

### Canvas (Interactive Artifacts)

Claude Artifacts / Gemini Canvas 스타일. 정적 HTML이 아님. **인터랙티브 React/HTML을 브라우저 내부에서 실행**. 서버는 코드 문자열만 생성하고 실행은 전부 클라이언트가 담당한다. ADR 근거는 [ADR-006](../../architecture/adr/006-pyodide-iframe-sandbox.md).

```
Code Agent (Python worker)
    -> LLM이 코드 문자열 생성 (Python or React/JS/HTML)
    -> API가 코드 + 언어 메타데이터를 프론트에 SSE 스트리밍
    -> 프론트 (Next.js)
        * Python: Pyodide (WASM) 런타임에 주입
        * React/JS/HTML: Blob URL + <iframe sandbox="allow-scripts"> + esm.sh
    -> stdout, 오류, 상태 변화를 postMessage로 Agent에게 피드백
    -> Agent가 필요 시 self-healing 반복 (max N=3 iteration)
```

| 유형 | 구현 |
|------|------|
| Mermaid 다이어그램 | 프론트 네이티브 렌더링 (별도 샌드박스 불필요) |
| LaTeX 수식 | KaTeX 프론트 네이티브 렌더링 |
| 인터랙티브 차트 | React 컴포넌트 문자열 → iframe (esm.sh CDN) |
| 슬라이드 | React 프레젠테이션 컴포넌트 → iframe |
| 실시간 위젯 | React → iframe |
| 데이터 분석 | Pyodide + matplotlib/plotly (결과 PNG/Interactive Plotly JSON) |
| 코드 실행 결과 | Pyodide stdout/stderr + 생성된 파일 (BrowserFS in-memory) |
| 인포그래픽 | React → iframe |
| 마인드맵 / Cards / Timeline / Canvas | Cytoscape 5뷰 (Plan 5) — 별도 컴포넌트 |

### Sandbox 기술 세부

**Python (Pyodide)**
- numpy/pandas/matplotlib/scipy/sympy 기본 포함 (~10MB 최초 다운로드, 이후 브라우저 캐시)
- `micropip.install()`로 추가 패키지 (pure-Python 또는 Pyodide 빌드된 wheel만)
- `pyodide.setStdin()`에 pre-injected 배열로 코테(BOJ/Codeforces) 패턴 지원
- **지원 안 됨**: 블로킹 `input()` 대화형 REPL, 네이티브 C 확장(torch 등)
- 실행 한도: Agent가 설정한 EXECUTION_TIMEOUT_MS (기본 10s), 무한루프는 Web Worker terminate

**JS/HTML/React (iframe)**
- `<iframe sandbox="allow-scripts">` — `allow-same-origin` 동시 부여 절대 금지 (MDN 경고)
- Blob URL로 HTML 주입 (esm.sh CDN으로 React/라이브러리 동적 import)
- 부모 페이지 쿠키/localStorage/origin 접근 차단
- 양방향 통신은 `postMessage` + origin 검증
- 빌드 서버 불필요 (esm.sh가 런타임 번들링)

**보안 경계**
- 위협 모델: "본인 에이전트가 본인 브라우저에서 본인 코드 실행" — multi-tenant 탈출 방어 불필요
- 브라우저 SOP + iframe sandbox 속성 + CSP 전역 정책으로 충분
- 상세: [security-model.md](../../architecture/security-model.md)

**서버 역할**
- Code Agent (Python worker): 코드 생성만, 실행 안 함
- `POST /api/code/run` (generate only) — `source`, `language` 문자열 반환
- `apps/sandbox` / `services/sandbox` / Docker gVisor는 모두 제거됨

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

> **2026-04-19 전면 개편**: 기존 "Pro ₩X 미정 / BYOK ₩Y 미정" 구조는 폐기. 아래 3단 요금제가 캐논이며, 상세는 [billing-model.md](../../architecture/billing-model.md). 결제 레일(PG)은 사업자등록 후 결정이므로 Plan 9의 결제 연동 task는 **BLOCKED** 상태 — 그 전에는 provider-agnostic core (크레딧 잔액·차감·환율 고정·BYOK 키 암호화)만 구현.

### Plans (v0.1 캐논)

| 플랜 | 월 구독료 | AI 비용 | 대상 | 핵심 제약 |
|------|----------|--------|------|----------|
| **Free** | ₩0 | OpenCairn 부담 (하드 쿼터) | 평가용 개인 | 프로젝트 10 / Q&A 50 / 스토리지 100MB |
| **Pro** | **₩4,900 + PAYG** | 선불 크레딧 차감 | 정식 개인·팀 | 최소 ₩5,000 선불, 만료 없음, `$1 = ₩1,650` 고정 환율로 차감 |
| **BYOK** | **₩2,900** (서버 임대비) | 본인 Gemini API 키 | 솔로 사용자 | 단일 사용자 호스팅, **팀/협업 기능 제외**, 토큰 비용 본인 부담 |
| Self-host | ₩0 | 본인 부담 | OSS 유저 | AGPLv3, `BILLING_ENABLED=false` 기본 무제한 |
| Enterprise | 별도 협의 | 별도 협의 | v0.3 규제 산업 | SSO/감사 로그/온프레미스 |

- **PAYG 크레딧**: 사용자가 ₩5,000 이상 선불 충전 → `usage_records`의 토큰 비용만큼 잔액 차감. 만료 없음, 환불 규정은 billing-model.md.
- **BYOK ≠ Self-host**: BYOK는 OpenCairn이 운영하는 서버의 단일 사용자 계정을 임대하는 모델 (Pro의 팀 기능·공유 제외). Self-host는 사용자가 직접 Docker를 띄우는 별개 트랙.
- **PG 미확정**: Toss Payments가 후보지만 사업자등록·계약 전까지 결제 레일 미연동. 잔액·차감·환율·BYOK 키 암호화 등 결제-무관 코어는 먼저 구현.
- **VAT 별도**, 부가세는 billing-model.md의 산정 규칙을 따름.
- 셀프호스팅 시 빌링 비활성화 (`BILLING_ENABLED=false`, 기본값 무제한).

---

## 14. Auth & Authorization

### 14.1 Authentication

- 멀티유저 (개별 계정 로그인)
- Better Auth (Hono 연동) — 이메일/비밀번호 + Magic Link (v0.1). OAuth(Google/GitHub)는 v0.2.
- 세션 쿠키 기반 (`better_auth.session_token`, HttpOnly + Secure + SameSite=Lax)
- 세션 store는 PostgreSQL + Redis 캐시
- SAML/OIDC SSO는 v0.3 Enterprise

### 14.2 Authorization (권한)

**핵심 원칙:**
- 모든 read/write 쿼리는 데이터 레이어에서 권한 검증 (`canRead` / `canWrite` 헬퍼). API 미들웨어만으로 부족 — 내부 호출·에이전트·웹훅도 경유.
- 3계층 권한: Workspace → Project → Page. 상위에서 하위로 상속, 하위에서 명시적 override 가능.
- Hocuspocus WebSocket 연결 시 auth hook으로 워크스페이스 멤버십 + 페이지 권한 검증.

**역할 체계:**

| 계층 | 역할 | 요약 |
|------|------|------|
| Workspace | owner, admin, member, guest | 조직 전체 권한 |
| Project | editor, viewer | workspace 역할 위의 override |
| Page | editor, viewer, none | project 역할 위의 override (Notion 방식) |

상세 resolve 알고리즘 + 구현 패턴: [collaboration-model.md §3 / §11](../../architecture/collaboration-model.md)

---

## 15. Organization

### 15.1 Hierarchy (3계층)

```
User
  └── WorkspaceMembership (M:N via workspace_members)
Workspace (격리 경계)
  ├── Members (owner / admin / member / guest)
  ├── Invites (pending)
  └── Project (Notion "top-level page" 수준)
        ├── ProjectPermission (역할 override)
        ├── Folders (중첩 가능)
        │     └── Notes (= 페이지)
        │           └── PagePermission (역할 override)
        ├── Tags
        │     └── Notes (M:N)
        └── Conversations
```

### 15.2 격리·연결 규칙

- **Workspace 간**: 절대 격리. 에이전트·검색·KG·Yjs 문서 전부 워크스페이스 스코프.
- **Workspace 내 Project 간**: 기본 격리 but Connector Agent가 연결 제안 (사용자 승인 후 link 생성).
- **글로벌 Q&A scope**: 같은 workspace 안에서만 전체 프로젝트 검색. 다른 workspace 접근 불가.

### 15.3 Workspace 전환 UX

- 상단 좌측 workspace switcher 드롭다운 (Slack 스타일)
- 각 workspace별 별도 사이드바, 별도 활동 피드, 별도 알림
- URL이 `/app/w/<workspace>/...`로 시작 — workspace id가 컨텍스트

상세: [collaboration-model.md](../../architecture/collaboration-model.md)

---

## 16. Docker Compose

### Services (7~8개 — sandbox 서비스 폐기, Ollama는 옵션)

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

  minio:
    # Dev 환경 S3 호환 스토리지. Production은 Cloudflare R2 등으로 교체.
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin

  hocuspocus:
    image: ghcr.io/tiptap/hocuspocus:latest
    # Yjs 협업 서버 — Better Auth 인증 연동, PostgreSQL 영속화
    depends_on: [postgres]
    ports: ["1234:1234"]

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    depends_on: [api]
    ports: ["3000:3000"]

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    depends_on: [postgres, redis, minio, temporal]
    ports: ["4000:4000"]

  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    # Python 3.12 + Java 21 + unoserver + H2Orestart + faster-whisper
    depends_on: [postgres, redis, minio, temporal]

  # sandbox 서비스는 2026-04-14 피봇으로 폐기됨 (ADR-006)
  # 코드 실행은 전부 브라우저 (Pyodide + iframe). Docker sandbox 없음.

  ollama:
    # Optional — LLM_PROVIDER=ollama 시 활성화
    image: ollama/ollama:latest
    profiles: ["ollama"]
    volumes: [ollama_data:/root/.ollama]
    ports: ["11434:11434"]

volumes:
  pgdata:
  redisdata:
  miniodata:
  ollama_data:
```

### Environment Variables

```env
# Required
LLM_PROVIDER=gemini              # gemini | ollama (openai는 2026-04-15 제거)
LLM_API_KEY=your-gemini-api-key
LLM_MODEL=gemini-3-flash-preview
EMBED_MODEL=gemini-embedding-2-preview
VECTOR_DIM=3072                  # Gemini 3072 / Ollama nomic 768 / 운영 truncate 1536

# DB
DATABASE_URL=postgresql://opencairn:changeme@postgres:5432/opencairn

# Redis
REDIS_URL=redis://redis:6379

# Storage (S3 compatible)
S3_ENDPOINT=http://minio:9000    # Production: https://<accountid>.r2.cloudflarestorage.com
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=opencairn

# Billing (optional)
BILLING_ENABLED=false
TOSS_SECRET_KEY=
TOSS_WEBHOOK_SECRET=
TOSS_CLIENT_KEY=

# Auth
BETTER_AUTH_SECRET=random-secret-here

# Temporal
TEMPORAL_ADDRESS=temporal:7233
TEMPORAL_NAMESPACE=default

# Internal API (worker → API callbacks)
INTERNAL_API_URL=http://api:4000
INTERNAL_API_SECRET=change-me-in-production
```

### Quick Start (셀프호스팅)

```bash
git clone https://github.com/opencairn/opencairn.git
cd opencairn
cp .env.example .env
# .env에 LLM_API_KEY(Gemini)를 설정 — Ollama만 쓰려면 LLM_PROVIDER=ollama
docker-compose up -d
# Ollama 로컬 LLM까지 원하면:
docker-compose --profile ollama up -d
# http://localhost:3000
```

### Production

```bash
# Single-node 운영 (최소: 8 vCPU / 16GB RAM / aarch64 or x86_64)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

관리형으로 교체 가능:
- PostgreSQL → Neon, Supabase, RDS
- Redis → Upstash, ElastiCache
- S3 → Cloudflare R2, Backblaze B2
- Temporal → Temporal Cloud (셀프호스트 유지 권장)

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
- [x] 캔버스 (인터랙티브 React/HTML, 브라우저 Pyodide + iframe sandbox)
- [x] Tool Template System (퀴즈, 슬라이드, 마인드맵 등)
- [x] 비동기 작업 실행 (브라우저 꺼도 진행, 각 스텝 DB 저장)
- [x] 빌링 (Free/Pro/BYOK, Toss Payments)
- [x] Visualization Agent (Cytoscape 5뷰 — Graph/Mindmap/Cards/Canvas/Timeline)
- [x] Docker Compose 원클릭 배포
- [x] **협업 기반 (Workspace + Permissions + Hocuspocus + Presence + Comments + @mention + Notifications + Activity feed)** — Notion 대체 포지션의 테이블 스테이크

### v0.2+

- 모바일 앱
- OAuth (Google, GitHub)
- 워크스페이스 **그룹** (팀 단위 권한) — v0.1은 user 개인 권한만
- 공개 링크 (암호·만료)
- Guest 고급 기능 (디렉토리 · 온보딩 플로우)
- 플러그인 시스템
- CLI 도구
- Gemini Live API (실시간 음성 Q&A)
- **Hunter Agent** (Computer-Use 기반 자료 수집, v0.1은 Curator + Search Grounding으로 커버)
- Webhook 아웃바운드 (Slack/Discord 알림)
- 파인튜닝 (지식 -> 모델 가중치)

### v0.3 (Enterprise)

- SSO (SAML / OIDC)
- 감사 로그 export (SOC2, ISO27001 준비)
- 고급 권한 (IP 화이트리스트, session 타임아웃 정책)
- Ollama 완전 로컬 프리셋 (규제 산업용 "데이터 외부 송신 없음" 배포 가이드)
- 다중 PSP 지원 (글로벌 확장 시 Stripe 등)
- 엔터프라이즈 상용 라이선스 (AGPLv3 대신)
