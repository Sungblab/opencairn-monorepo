# Multi-LLM Provider Architecture

**Date:** 2026-04-13  
**Status:** Draft

## Overview

OpenCairn은 단일 public 레포(AGPLv3)로 운영된다. Production(hosted service)은 Gemini provider를 사용하고, 셀프호스트 유저는 Ollama(완전 로컬) 또는 OpenAI(BYOK)를 선택할 수 있다. Private으로 관리하는 것은 `.env`와 `docker-compose.prod.yml`뿐이며 코드는 전부 공개된다.

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
├── gemini.py        # Gemini 3.x (production)
├── openai.py        # OpenAI-compatible (BYOK)
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
    async def cache_context(self, content: str) -> str | None:
        return None

    async def think(self, prompt: str) -> ThinkingResult | None:
        return None

    async def ground_search(self, query: str) -> SearchResult | None:
        return None

    async def tts(self, text: str, model: str | None = None) -> bytes | None:
        return None

    async def transcribe(self, audio: bytes) -> str | None:
        return None
```

### factory.py

```python
def get_provider(config: ProviderConfig) -> LLMProvider:
    match config.provider:
        case "gemini":  return GeminiProvider(config)
        case "openai":  return OpenAIProvider(config)
        case "ollama":  return OllamaProvider(config)
        case _: raise ValueError(f"Unknown provider: {config.provider}")
```

## 배포 모드

| 모드 | LLM_PROVIDER | 메인 LLM | Embedding | TTS/STT | 비용 |
|------|-------------|---------|-----------|---------|------|
| Production | `gemini` | Gemini 3.1 Pro / 3 Flash | gemini-embedding-2-preview | Gemini 2.5 Flash/Pro TTS, 3.1 Flash Live | Google Cloud 결제 |
| BYOK | `openai` | gpt-4o 등 | text-embedding-3-small (1536d) | 없음 | API key |
| 완전 로컬 | `ollama` | llama3, qwen 등 | nomic-embed-text (768d) | 없음 | 무료 |

## Gemini 모델 사양

| 용도 | Model ID | 컨텍스트 | 가격 (input/output, 1M tokens) |
|------|----------|---------|-------------------------------|
| 고성능 추론 | `gemini-3.1-pro-preview` | 1M | $2-4 / $12-18 |
| 일반 / 비용 효율 | `gemini-3-flash-preview` | 1M | $0.50 / $3 |
| 경량 / 고빈도 | `gemini-3.1-flash-lite-preview` | 1M | $0.25 / $1.50 |
| Embedding (멀티모달) | `gemini-embedding-2-preview` | 8,192 tokens | 별도 |
| TTS (빠름) | `gemini-2.5-flash-preview-tts` | — | 별도 |
| TTS (고품질) | `gemini-2.5-pro-preview-tts` | — | 별도 |
| STT / Live | `gemini-3.1-flash-live-preview` | — | $0.75(text) $3/min(audio) input |
| 이미지 생성 | `gemini-3.1-flash-image-preview` | 128k | $0.25 input / $60/1M img tokens |

### Gemini Embedding 2 사양

- 입력: 텍스트, 이미지(PNG/JPEG, 최대 6개), 오디오(MP3/WAV, 최대 80초), 동영상(MP4, 최대 80초), PDF(최대 6페이지)
- 출력: 최대 3,072차원 벡터 (MRL — `output_dimensionality`로 축소 가능)
- 최대 입력 토큰: 8,192
- task instruction 지원: `task:search query`, `task:retrieval document` 등으로 임베딩 최적화

## Vector Dimension 전략

Embedding provider마다 차원이 다르므로 `VECTOR_DIM` env로 결정하고 Drizzle 마이그레이션 시 적용한다. 각 배포는 독립적인 DB를 사용하므로 차원이 달라도 무방하다.

```bash
# Production
VECTOR_DIM=3072
EMBEDDING_MODEL=gemini-embedding-2-preview

# BYOK (OpenAI)
VECTOR_DIM=1536
EMBEDDING_MODEL=text-embedding-3-small

# 완전 로컬
VECTOR_DIM=768
EMBEDDING_MODEL=nomic-embed-text
```

```ts
// packages/db/schema.ts (생성 시 env 참조)
const VECTOR_DIM = parseInt(process.env.VECTOR_DIM ?? "3072");
embedding: vector("embedding", { dimensions: VECTOR_DIM })
```

## Gemini Premium Features — Graceful Degradation

| Feature | Gemini | Ollama / OpenAI |
|---------|--------|-----------------|
| Thinking Mode (Compiler, Research agent) | `think()` 사용 — 추론 후 답 | `generate()` fallback |
| Context Caching (긴 문서) | `cache_context()` — 비용↓ 속도↑ | 매번 full context 전송 |
| Search Grounding | `ground_search()` — 실시간 웹 결합 | RAG만 |
| TTS (Narrator agent) | `tts()` — 음성 출력 | 텍스트만 반환 |
| STT / Live | `transcribe()` — 실시간 전사 | 없음 |
| Multimodal Embedding | 이미지/오디오/PDF 임베딩 | 텍스트만 |

Agent 코드 패턴:

```python
# thinking fallback 예시
result = await provider.think(prompt)
response = result.final_answer if result else await provider.generate(prompt)

# TTS fallback 예시
audio = await provider.tts(text)
return {"text": text, "audio": audio}  # audio=None이면 프론트에서 텍스트만 표시
```

## 모델 선택 (설정 페이지)

유저가 설정 페이지에서 provider별 모델을 선택할 수 있다. 선택값은 DB의 `user_preferences` 테이블에 저장한다.

```ts
// user_preferences (packages/db)
{
  llm_provider: "gemini" | "openai" | "ollama",
  llm_model: string,          // e.g. "gemini-3.1-pro-preview"
  tts_model: string | null,   // e.g. "gemini-2.5-pro-tts-preview"
  stt_model: string | null,
  embed_model: string,
  ollama_base_url: string | null,  // 완전 로컬 시 사용
}
```

## Docker 셀프호스트 UX

```bash
git clone https://github.com/opencairn/opencairn
cp .env.example .env
# .env 편집: LLM_PROVIDER=ollama (또는 openai, gemini)
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
| VECTOR_DIM env | provider마다 다른 차원, 각 배포 독립 DB |
| 완전 로컬 지원 | 프라이버시 중시 유저, 비용 없는 진입점 |
| Production config만 private | 코드 전체 공개, 신뢰 확보 |
