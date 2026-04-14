# Gemini API Docs — 로컬 인덱스

> Google의 Gemini API 공식 문서 42편을 Socratiq 개발 맥락에 맞게 분류한 로컬 참조.
> 모든 파일은 Google 원문(AI Studio 또는 ai.google.dev) 복사본.

---

## 🎯 Socratiq 에이전트별 필독 문서

각 에이전트 구현 전, 아래 문서를 먼저 숙지할 것.

| 에이전트 | 필독 문서 | 부가 |
|---|---|---|
| **Meta-Orchestrator** | `00-meta/Models.md`, `01-generation/Structured outputs.md`, `04-tools/Function calling with the Gemini API.md` | `00-meta/Gemini Developer API pricing.md` (모델 티어링 비용 판단) |
| **Socratic Tutor** | `01-generation/Prompt design strategies.md`, `01-generation/Gemini thinking.md`, `01-generation/Structured outputs.md` | `01-generation/Thought Signatures.md` (4-Level 힌트 추론) |
| **Ingest** | `02-multimodal/Image understanding.md`, `02-multimodal/Document understanding.md`, `03-files-caching/Files API.md`, `03-files-caching/File input methods.md` | `01-generation/Structured outputs.md` (OCR 결과 Pydantic 변환) |
| **Misconception Detector** | `01-generation/Gemini thinking.md`, `01-generation/Structured outputs.md`, `01-generation/Prompt design strategies.md` | — |
| **Visualizer** | `02-multimodal/Nano Banana image generation.md` | — |
| **Memory** | `06-embeddings/Embeddings.md`, `01-generation/Long context.md`, `03-files-caching/Context caching.md` | `03-files-caching/Caching.md` (API ref) |
| **Teacher Insight** | `08-batch/Batch API.md`, `01-generation/Structured outputs.md` | — |

---

## ⭐ Tier 1 (전 팀원 필독)

Socratiq 전체 규칙과 직결된 문서.

- **`01-generation/Structured outputs.md`** — CLAUDE.md 규칙 #3 "Structured Output 필수"의 근거. Pydantic v2 스키마 강제 패턴.
- **`00-meta/Models.md`** — `GeminiModel` enum 정의 근거. Flash-Lite / Flash / Pro 기능·한계 비교.
- **`00-meta/Gemini API libraries.md`** — `google-genai` SDK 설치·인증·기본 호출 패턴.
- **`01-generation/Prompt design strategies.md`** — 7 에이전트 공통 프롬프트 작성 가이드라인.

---

## 📂 폴더 구조

### `00-meta/` — 메타·기반 (9개)
SDK, 모델, 버전, 가격 등 API 자체에 대한 정보.

| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Gemini API.md | Guide | Gemini API 전체 개요 |
| Gemini 3 Developer Guide.md | Guide | Gemini 3 세대 신기능 |
| Gemini API libraries.md | Guide | 공식 SDK (Python/JS) |
| API versions explained.md | Guide | v1 / v1beta / v1alpha 차이 |
| Models.md | Guide | 전 모델 스펙·한계 |
| Gemini Developer API pricing.md | Guide | 토큰당 가격 |
| Gemini API optimization and inference.md | Guide | 속도·비용 최적화 |
| Gemini API reference.md | API Ref | 전체 API 레퍼런스 진입점 |
| All methods.md | API Ref | 모든 메서드 목록 |

### `01-generation/` — 콘텐츠 생성 (7개)
텍스트·구조화 출력·thinking·long context 등 생성 관련 전부.

| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Generating content.md | API Ref | `generateContent` 메서드 |
| Text generation.md | Guide | 텍스트 생성 기본기 |
| Structured outputs.md | Guide | **Pydantic / JSON Schema 강제** ⭐ |
| Prompt design strategies.md | Guide | 프롬프트 작성법 ⭐ |
| Long context.md | Guide | 1M 토큰 context window 활용 |
| Gemini thinking.md | Guide | thinking mode (Pro 모델) |
| Thought Signatures.md | Guide | 추론 과정 검증 |

### `02-multimodal/` — 멀티모달 (4개)
이미지·문서 이해, 이미지·음성 생성.

| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Image understanding.md | Guide | 이미지 입력 · OCR · VQA ⭐ Ingest |
| Document understanding.md | Guide | PDF 네이티브 이해 ⭐ Ingest |
| Nano Banana image generation.md | Guide | Gemini 2.5 Flash Image (Visualizer) |
| Text-to-speech generation (TTS).md | Guide | Gemini TTS |

### `03-files-caching/` — 파일·캐싱·토큰 (7개)
파일 업로드, 컨텍스트 캐싱, 토큰 카운팅.

| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Files API.md | Guide | Files API 개요 |
| File input methods.md | Guide | 인라인 vs 업로드 선택 기준 |
| Using files.md | API Ref | `media.upload` 등 |
| Context caching.md | Guide | 캐싱 개념·사용법 ⭐ Memory |
| Caching.md | API Ref | `cachedContents` 메서드 |
| Understand and count tokens.md | Guide | 토큰 개념·계산법 |
| Counting tokens.md | API Ref | `countTokens` 메서드 |

### `04-tools/` — 도구·함수 호출 (8개)
Function calling, built-in tools, File Search.

| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Using Tools with Gemini API.md | Guide | Tools 전체 개념 |
| Function calling with the Gemini API.md | Guide | 커스텀 함수 호출 ⭐ Meta-Orchestrator |
| Combine built-in tools and function calling.md | Guide | 혼합 사용 |
| Code execution.md | Guide | Python 실행 tool |
| URL context.md | Guide | URL 읽기 tool |
| File Search.md | Guide | 매니지드 RAG |
| File Search Stores.md | API Ref | `fileSearchStores` 메서드 |
| Documents.md | API Ref | `fileSearchStores.documents` |

### `05-agents/` — 에이전트 (2개)
Gemini 팀의 agent 빌딩 가이드.

| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Agents Overview.md | Guide | Gemini agent 빌딩 패턴 |
| Gemini Deep Research Agent.md | Guide | Deep Research 참조 구현 |

### `06-embeddings/` — 임베딩 (1개)
| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Embeddings.md | Guide + API Ref | `gemini-embedding-001` · 768d 벡터 ⭐ Memory |

### `07-live/` — 실시간 (3개)
WebSocket 기반 Live API (향후 V2 기능 후보).

| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Live API - WebSockets API reference.md | API Ref | 실시간 멀티모달 |
| Live Music API - WebSockets API reference.md | API Ref | 음악 생성 |
| Interactions API.md | API Ref | 인터랙션 API |

### `08-batch/` — 배치 (1개)
| 파일 | 타입 | 핵심 내용 |
|---|---|---|
| Batch API.md | Guide + API Ref | 50% 할인 · Teacher Insight 리포트 생성 |

---

## 📖 문서 타입 구분

- **Guide** — 개념 설명, 코드 예시 중심. 학습용.
- **API Ref** — 메서드 시그니처, 파라미터 스펙 중심. 참조용.

같은 주제여도 둘 다 있으면 **Guide 먼저** 읽고 **API Ref로 검증**.

---

## 🔗 원본 링크

모든 문서의 원본은 [ai.google.dev/gemini-api/docs](https://ai.google.dev/gemini-api/docs) 참조.
로컬 사본은 **학습·참조 전용**. 최신 spec은 공식 사이트가 진실의 원천.

---

## 갱신 정책

- Gemini API는 자주 업데이트됨 → **문서 갱신 시 이 인덱스도 동기화** 필수.
- 새 문서 추가 시: 해당 폴더에 넣고 이 README의 표·매핑에 추가.
- 문서 제거 시: 이 README에서도 삭제.
