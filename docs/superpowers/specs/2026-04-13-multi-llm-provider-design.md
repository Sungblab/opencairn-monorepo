# Multi-LLM Provider Architecture

**Date:** 2026-04-13  
**Updated:** 2026-04-15  
**Status:** Draft

## Overview

OpenCairn은 단일 public 레포(AGPLv3)로 운영된다. Production(hosted service)은 OpenCairn이 Gemini 키를 제공하는 구독 모드다. 사용자는 **BYOK(Bring Your Own Key)**로 자신의 Gemini 키를 들고 올 수 있다. 완전 로컬 사용자는 Ollama를 선택한다. **BYOK Gemini가 추천 모드** — OpenCairn의 프리미엄 기능(CAG, Context Caching, Thinking, Search Grounding, TTS, File Search, 멀티모달 Embedding)이 전부 보존되기 때문.

> **2026-04-15 결정:** OpenAI 프로바이더 제거. Gemini(클라우드) + Ollama(로컬) 이분법으로 단순화. OpenAI는 Gemini보다 기능이 적으면서 비용을 내는 어정쩡한 포지션이었음.

## Repo 전략

```
opencairn-monorepo/          ← public, AGPLv3
├── packages/llm/            ← 신규
├── docker-compose.yml       ← 셀프호스트용 (Ollama 포함)
└── docker-compose.prod.yml  ← production용 (private, gitignore)
```

Production config는 `.env.prod`에만 존재하며 레포에 커밋하지 않는다.

## packages/llm 구조

```
packages/llm/
├── __init__.py
├── base.py          # LLMProvider abstract class
├── gemini.py        # Gemini 3.x (production + BYOK)
├── ollama.py        # 완전 로컬
└── factory.py       # LLM_PROVIDER env → provider 인스턴스 반환
```

### base.py 인터페이스

```python
class LLMProvider(ABC):
    # 필수 — 모든 provider 구현
    @abstractmethod
    async def generate(self, messages: list[dict], **kwargs) -> str: ...

    @abstractmethod
    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]: ...

    # Gemini 전용 — 기본 None 반환 (graceful degradation)
    async def think(self, prompt: str) -> ThinkingResult | None:
        return None

    async def ground_search(self, query: str) -> SearchResult | None:
        return None

    async def tts(self, text: str, model: str | None = None) -> bytes | None:
        return None

    # 파일 전사: 멀티모달 모델에 오디오 + "transcribe" 프롬프트
    # Gemini: generate()+오디오 / Ollama: faster-whisper 로컬 fallback
    async def transcribe(self, audio: bytes) -> str | None:
        return None

    # 스캔 PDF OCR
    # Gemini: Files API (한국어/손글씨 우수) / Ollama: tesseract (인쇄체 전용)
    async def ocr(self, pdf_bytes: bytes) -> str | None:
        return None

    # 이미지 분석 (멀티모달 generate 래퍼)
    # Gemini: Vision 네이티브 / Ollama: llava / moondream
    async def analyze_image(self, image: bytes, prompt: str) -> str | None:
        return None

    # CAG: 유저 위키 코퍼스를 컨텍스트 캐시에 적재
    # Gemini: Explicit Cache (TTL 지정) / Ollama: None (pgvector fallback)
    async def cache_corpus(self, corpus: str, ttl_seconds: int = 600) -> str | None:
        return None

    # Gemini File Search Stores — 호스티드 RAG
    # Gemini: 위키 페이지 업로드 → 자동 청킹/인덱싱 (저장 무료)
    # Ollama: None (pgvector fallback)
    async def file_search_index(self, store_name: str, file_path: str) -> bool:
        return False

    async def file_search_query(self, store_name: str, query: str) -> str | None:
        return None

    # URL 컨텍스트: URL 직접 읽기
    # Gemini: URL Context Tool 네이티브 / Ollama: trafilatura fallback
    async def fetch_url_context(self, urls: list[str], prompt: str) -> str | None:
        return None

    # Deep Research Agent API (Gemini Interactions API)
    # Gemini: agent='deep-research-pro-preview-12-2025', background=True
    # Ollama: None (자체 LangGraph 구현 fallback)
    async def deep_research(self, query: str) -> AsyncIterator[str] | None:
        return None
```

### ⚠️ Thought Signatures (Gemini 3 필수)

Gemini 3 모델은 function calling 시 응답에 `thoughtSignature`를 포함한다. **다음 턴에 반드시 돌려줘야 하며, 누락 시 400 에러.** SDK(`google-genai`) 사용 시 history를 그대로 append하면 자동 처리된다. REST 또는 수동 history 관리 시에는 명시적으로 처리해야 한다.

```python
# GeminiProvider 내부 — history 관리 시 thought_signature 보존 필수
# SDK를 쓰면 response object를 그대로 history에 append → 자동
# 수동 파싱 시:
for part in response.candidates[0].content.parts:
    if hasattr(part, 'thought_signature'):
        # 반드시 다음 request의 history에 포함
        history.append({"role": "model", "parts": [part]})
```

**병렬 function call 시:** 첫 번째 functionCall part에만 signature 붙음.  
**순차 function call 시:** 각 step마다 signature 붙음, 전부 돌려줘야 함.

### factory.py

```python
def get_provider(config: ProviderConfig) -> LLMProvider:
    match config.provider:
        case "gemini":  return GeminiProvider(config)
        case "ollama":  return OllamaProvider(config)
        case _: raise ValueError(f"Unknown provider: {config.provider}")
```

## 배포 모드

**중요 개념:** BYOK(Bring Your Own Key)는 provider 선택이 아니라 **API 키 소유 주체**의 문제다. Production(hosted)은 OpenCairn이 Gemini 키를 제공하는 모드, BYOK는 사용자가 직접 키를 들고 오는 모드.

| 모드 | 키 출처 | LLM_PROVIDER | 메인 LLM | Embedding | TTS/STT | Q&A 검색 | 비용 |
|------|--------|-------------|---------|-----------|---------|---------|------|
| **Hosted (Production)** | OpenCairn 제공 | `gemini` | Gemini 3.1 Pro / 3 Flash | gemini-embedding-2-preview (3072d) | Gemini 네이티브 | CAG (TTL 10분) + File Search fallback | Toss Payments 구독 (한국 원화) |
| **BYOK Gemini** (추천) | 사용자 | `gemini` | Gemini 3.1 Pro / 3 Flash | gemini-embedding-2-preview (3072d) | Gemini 네이티브 | CAG (TTL 무제한) + File Search fallback | 사용자가 Google에 직접 결제 |
| **완전 로컬** | 불필요 | `ollama` | llama3, qwen 등 | nomic-embed-text (768d) | faster-whisper / tesseract | pgvector (위키 페이지 임베딩) | 무료 |

### BYOK Gemini가 추천인 이유

OpenCairn 프리미엄 기능이 **Gemini 전용**이다:
- **CAG (Cache-Augmented Generation)** — 위키 코퍼스 통째로 캐시, 검색 없이 전체 맥락 참조
- **Context Caching** — BYOK 유저는 캐시 TTL 제한 없음, 비용 유저 본인 부담
- **File Search Stores** — Gemini 호스티드 RAG, 저장 무료
- **Search Grounding** — 실시간 웹 + 개인 지식 동시 검색
- **TTS** — Narrator 에이전트 음성 출력
- **Multimodal Embedding** — 이미지/오디오/PDF 포함 임베딩

Ollama로 전환하면 이 기능들이 전부 graceful degrade.

### 키 저장 및 관리

- BYOK 키는 **AES-256 암호화**되어 `users.llm_api_key`에 저장
- 암호화 키는 `ENCRYPTION_KEY` env에서 로드 (서버별 고유)
- 사용자 설정 페이지에서 키 입력/교체/삭제 가능
- API 호출 시 런타임에 복호화해서 `get_provider(user_id)`에 주입

## Q&A / 검색 아키텍처 (CAG-first)

### 핵심 원칙: Q&A 코퍼스 = 위키 페이지

원본 문서 청크가 아닌 **Compiler 에이전트가 정제한 위키 페이지**를 Q&A 검색 대상으로 삼는다.

```
원본 문서 → 파싱 → LightRAG (KG 추출) → Compiler → 위키 페이지
                                                         ↓
                                               Q&A 검색 대상 (CAG / File Search / pgvector)
```

이유:
- 위키는 중복 제거, 맥락 완결된 개념 단위 → 검색 품질 ↑
- 원본 청크 대비 코퍼스 크기 작아짐 → CAG 비용 ↓
- LightRAG의 KG 추출 역할은 유지 (엔티티/관계 → concepts/concept_edges)

### Gemini 유저 검색 전략

```
유저 Q&A 요청
    ↓
위키 코퍼스 토큰 수 확인
    │
    ├── < 200k 토큰  →  CAG (Explicit Context Cache)
    │     - cache_corpus(wiki_text, ttl=600)  # 10분 TTL
    │     - BYOK 유저: TTL 무제한 (본인 비용)
    │     - 장점: 전체 맥락, 관계 추론, 검색 레이턴시 없음
    │
    └── ≥ 200k 토큰  →  File Search Stores
          - file_search_query(store_name, query)
          - 저장 무료, 쿼리 시 임베딩 무료
          - 위키 페이지 단위 인덱싱 (청크 아님)

그래프 탐색 / 백링크 / 유사도 UI  →  항상 pgvector (provider 무관)
Compiler 내부 검색 (위키 생성 시)  →  pgvector (빠른 내부 조회)
```

### Ollama 유저 검색 전략

```
유저 Q&A 요청  →  pgvector (위키 페이지 임베딩, nomic-embed-text)
```

CAG, File Search 미지원. pgvector가 Q&A + 그래프 탐색 전부 담당.

### CAG 비용 전략

| TTL | 500k 토큰 코퍼스 저장 비용 |
|-----|--------------------------|
| 10분 | ~$0.38/세션 |
| 1시간 | ~$2.25/세션 |

- **Hosted (OpenCairn 부담):** TTL 10분, 코퍼스 < 200k 토큰만 CAG 적용
- **BYOK Gemini:** TTL 무제한, 코퍼스 크기 무제한 (유저가 Google에 직접 결제)
- **Implicit Caching:** Gemini 3+ 자동 적용 (1024 토큰 이상), 별도 설정 불필요

## Gemini 최신 기능 통합

### Interactions API (generateContent 대체)

Gemini 3의 신규 통합 API. 상태 관리, 툴 오케스트레이션, 롱러닝 태스크 내장.

```python
# 기존 generate_content 대신 — 에이전트 워크플로우에 사용
interaction = client.interactions.create(
    model="gemini-3-flash-preview",
    input="질문",
    background=True  # 비동기, Temporal activity와 연동
)
```

사용처: Deep Research, 롱러닝 리서치 태스크.

### Gemini Deep Research Agent API

Deep Research 에이전트를 Gemini가 네이티브로 제공. 직접 LangGraph 구현 대신 위임 가능.

```python
interaction = client.interactions.create(
    input=query,
    agent='deep-research-pro-preview-12-2025',
    background=True
)
# → 다단계 웹 검색 + 합성 + 인용 포함 리포트 자동 생성
```

Ollama fallback: 자체 LangGraph + faster-whisper 기반 구현.

### URL Context Tool (Connector 에이전트)

모델이 URL 직접 읽기. trafilatura 대비 JS 렌더링 페이지, PDF URL 등 처리 우수.

```python
response = client.models.generate_content(
    model="gemini-3-flash-preview",
    contents=f"이 URL 분석해줘: {url}",
    config=GenerateContentConfig(tools=[{"url_context": {}}])
)
```

Ollama fallback: trafilatura (정적 HTML) / crawl4ai (JS 렌더링).

### Built-in + Custom Tool 조합 (Research 에이전트, Gemini 3 only)

Google Search(실시간 웹) + 커스텀 함수(내 위키 검색)를 한 generation에서 동시 실행.

```python
tools=[types.Tool(
    google_search=types.ToolGoogleSearch(),      # 실시간 웹
    function_declarations=[search_user_wiki]      # 유저 개인 위키
)]
# → 웹 + 개인 지식베이스를 동시에 참조해서 답변
```

## Gemini 모델 사양

| 용도 | Model ID | 컨텍스트 | 가격 (input/output, 1M tokens) |
|------|----------|---------|-------------------------------|
| 고성능 추론 | `gemini-3.1-pro-preview` | 1M | $2-4 / $12-18 |
| 일반 / 비용 효율 | `gemini-3-flash-preview` | 1M | $0.50 / $3 |
| 경량 / 고빈도 | `gemini-3.1-flash-lite-preview` | 1M | $0.25 / $1.50 |
| Embedding (멀티모달) | `gemini-embedding-2-preview` | 8,192 tokens | 별도 |
| TTS (빠름) | `gemini-2.5-flash-preview-tts` | — | 별도 |
| TTS (고품질) | `gemini-2.5-pro-preview-tts` | — | 별도 |
| 파일 전사 (STT) | `gemini-3-flash-preview` (멀티모달 오디오 입력) | 1M | $0.50(text) $1.00(audio) |
| 실시간 Live | `gemini-3.1-flash-live-preview` | — | $0.75(text) $3/min(audio) input |
| 이미지 생성 | `gemini-3.1-flash-image-preview` | 128k | $0.25 input / $60/1M img tokens |
| Deep Research | `deep-research-pro-preview-12-2025` | — | Pro 기반 |

### Gemini Embedding 2 사양

- 입력: 텍스트, 이미지(PNG/JPEG, 최대 6개), 오디오(MP3/WAV, 최대 80초), 동영상(MP4, 최대 80초), PDF(최대 6페이지)
- 출력: 최대 3,072차원 벡터 (MRL — `output_dimensionality`로 축소 가능)
- 최대 입력 토큰: 8,192
- task instruction 지원: `task:search query`, `task:retrieval document` 등으로 임베딩 최적화

## Vector Dimension 전략

`VECTOR_DIM` env로 결정하고 Drizzle 마이그레이션 시 적용. 각 배포는 독립 DB.

```bash
# Gemini (Hosted + BYOK)
VECTOR_DIM=3072
EMBEDDING_MODEL=gemini-embedding-2-preview

# 완전 로컬 (Ollama)
VECTOR_DIM=768
EMBEDDING_MODEL=nomic-embed-text
```

```ts
// packages/db/schema.ts
const VECTOR_DIM = parseInt(process.env.VECTOR_DIM ?? "3072");
embedding: vector("embedding", { dimensions: VECTOR_DIM })
```

**pgvector 사용처 (provider 무관, 항상 필요):**
- 그래프 탐색 / 백링크 / 유사도 UI
- Compiler 내부 위키 검색 (개념 중복 감지)
- Ollama 유저 Q&A

**File Search Stores 사용처 (Gemini only):**
- 유저 Q&A fallback (코퍼스 ≥ 200k 토큰)
- 저장 무료, 쿼리 시 임베딩 무료

## Gemini Premium Features — Graceful Degradation

| Feature | Gemini | Ollama |
|---------|--------|--------|
| Thinking Mode | `think()` — 추론 후 답 | `generate()` fallback |
| CAG (Context Cache) | `cache_corpus()` — 위키 전체 캐시 | pgvector fallback |
| File Search RAG | `file_search_query()` — 호스티드 RAG | pgvector fallback |
| Search Grounding | `ground_search()` — 실시간 웹 결합 | RAG만 |
| Built-in+Custom Tools | Google Search + 커스텀 함수 동시 | 커스텀 함수만 |
| URL Context Tool | `fetch_url_context()` — URL 직접 읽기 | trafilatura fallback |
| Deep Research API | `deep_research()` — 네이티브 | LangGraph 자체 구현 |
| TTS | `tts()` — 음성 출력 | 텍스트만 반환 |
| STT (오디오 전사) | `transcribe()` — generate()+오디오 | faster-whisper (WHISPER_MODEL env) |
| 영상 시각 이해 | Files API — 오디오+비주얼 동시 | faster-whisper (오디오만, 시각 skip) |
| 스캔 PDF OCR | `ocr()` — Files API (한국어/손글씨) | tesseract (인쇄체만) |
| 이미지 분석 | `analyze_image()` — Vision 네이티브 | llava / moondream |
| YouTube 직접 처리 | YouTube URL 직접 | yt-dlp → faster-whisper |
| Multimodal Embedding | 이미지/오디오/PDF 임베딩 | 텍스트만 |

에이전트 코드 패턴:

```python
# CAG fallback 예시
cache_id = await provider.cache_corpus(wiki_text, ttl_seconds=600)
if cache_id:
    response = await provider.generate(messages, cache_id=cache_id)
else:
    # Ollama: pgvector로 관련 위키 페이지 검색 후 context 주입
    context = await vector_search(query, user_id)
    response = await provider.generate(messages_with_context(context))

# Deep Research fallback 예시
stream = await provider.deep_research(query)
if stream:
    async for chunk in stream:   # Gemini Deep Research API
        yield chunk
else:
    async for chunk in langgraph_research(query):  # 자체 구현
        yield chunk

# TTS fallback 예시
audio = await provider.tts(text)
return {"text": text, "audio": audio}  # audio=None이면 프론트에서 텍스트만 표시
```

## 모델 선택 (설정 페이지)

유저가 설정 페이지에서 provider별 모델을 선택할 수 있다. 선택값은 DB의 `user_preferences` 테이블에 저장한다.

```ts
// user_preferences (packages/db)
{
  llm_provider: "gemini" | "ollama",
  llm_model: string,           // e.g. "gemini-3.1-pro-preview"
  tts_model: string | null,    // e.g. "gemini-2.5-pro-tts-preview"
  stt_model: string | null,
  embed_model: string,
  whisper_model: string | null, // "tiny"|"base"|"small"|"medium"|"large-v3" — Ollama STT
  ollama_base_url: string | null,  // 완전 로컬 시 사용
  cag_ttl_seconds: number,     // CAG TTL (Hosted 기본 600, BYOK 기본 3600)
}
```

## Docker 셀프호스트 UX

```bash
git clone https://github.com/opencairn/opencairn
cp .env.example .env
# .env 편집: LLM_PROVIDER=ollama (또는 gemini + GEMINI_API_KEY)
docker compose up -d
# → http://localhost:3000
```

`docker-compose.yml`에 Ollama 서비스 포함:

```yaml
services:
  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
    profiles: ["ollama"]  # LLM_PROVIDER=ollama 시 자동 활성화
```

## 결정 사항

| 결정 | 이유 |
|------|------|
| 레포 1개 (AGPLv3) | 코드베이스 분기 없이 유지 비용 최소화 |
| Custom adapter (LiteLLM 미사용) | Gemini premium features 보존 |
| OpenAI 프로바이더 제거 | Gemini보다 기능 적으면서 유료, Embedding/TTS 없음, 포지션 애매 |
| Gemini + Ollama 이분법 | 클라우드(풀 기능) vs 로컬(무료/프라이버시) 명확히 분리 |
| Q&A 코퍼스 = 위키 페이지 | 원본 청크보다 정제됨, CAG 코퍼스 크기 ↓, 검색 품질 ↑ |
| CAG-first (Gemini) | 위키 전체 맥락 참조, 관계 추론 가능, 검색 레이턴시 없음 |
| CAG TTL Hosted 10분 / BYOK 무제한 | Hosted 비용 통제, BYOK는 유저 본인 부담 |
| File Search Stores fallback | 코퍼스 ≥ 200k 토큰, 저장 무료, 선형 확장 |
| pgvector 유지 | 그래프/백링크/Ollama Q&A — CAG/File Search로 대체 불가 |
| LightRAG = KG 추출만 | 위키 페이지가 Q&A 코퍼스 → LightRAG 벡터 저장 역할 분리 |
| Interactions API 도입 | Deep Research, 롱러닝 태스크 상태 관리 내장 |
| Deep Research API 위임 | 직접 구현 대비 품질 ↑, Temporal background activity와 연동 |
| Thought Signatures 필수 처리 | Gemini 3 function calling 400 에러 방지 |
| VECTOR_DIM env | provider마다 다른 차원, 각 배포 독립 DB |
| 완전 로컬 지원 | 프라이버시 중시 유저, 비용 없는 진입점 |
| Production config만 private | 코드 전체 공개, 신뢰 확보 |
