# Multi-LLM Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ 2026-04-15 업데이트:** OpenAI provider는 제거됨. v0.1 지원 provider는 **Gemini (production)** + **Ollama (로컬/BYOK)** 2개. 결정 배경은 `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md` 상단 업데이트 노트 참조.

> **⚠️ 2026-04-20 업데이트 — Tool Declaration 메서드 추가:** Plan 12 (Agent Runtime) 통합을 위해 `LLMProvider`에 `build_tool_declarations(tools: list) -> list[dict]` 메서드 추가. Default는 `NotImplementedError` raise, Gemini/Ollama provider만 구현 (Gemini FunctionDeclaration 포맷 / Ollama `{type: "function", function: {...}}` 포맷). 구현부는 `runtime.tool_declarations`를 **lazy import** (함수 내부) — `packages/llm`이 `runtime`에 모듈 로드 타임 의존하지 않도록 순환 방지. 상세: Plan 12 Task 5.

**Goal:** `packages/llm/` Python 패키지를 신설해 Gemini/Ollama를 단일 인터페이스로 추상화하고, DB 스키마에 `user_preferences`와 동적 `VECTOR_DIM`을 추가하며, Docker Compose에 Ollama 셀프호스트 지원을 추가한다.

**Architecture:** `LLMProvider` abstract class를 `packages/llm/base.py`에 정의한다. `GeminiProvider`는 Gemini premium features(Thinking, Context Caching, Search Grounding, TTS)를 구현하고, `OllamaProvider`는 `generate`/`embed`만 구현한다. premium feature 메서드는 base에서 `None`을 반환하므로 agent 코드는 `if result:` 한 줄로 fallback 처리한다. `factory.py`가 `LLM_PROVIDER` env를 읽어 provider 인스턴스를 반환한다. DB의 `vector()` 차원은 `VECTOR_DIM` env에서 결정된다.

**Tech Stack:** Python 3.12, uv, google-genai SDK, httpx(Ollama), Drizzle ORM, docker-compose profiles

---

## File Structure

```
packages/llm/                         -- 신규 Python 패키지
  pyproject.toml                      -- 패키지 메타데이터 + 의존성
  src/llm/
    __init__.py                       -- public exports
    base.py                           -- LLMProvider ABC + 데이터 모델
    gemini.py                         -- GeminiProvider (premium features)
    ollama.py                         -- OllamaProvider (local)
    factory.py                        -- get_provider(config) → LLMProvider
  tests/
    conftest.py                       -- 공유 fixtures
    test_base.py                      -- 데이터 모델 검증
    test_gemini.py                    -- GeminiProvider (mock google-genai)
    test_ollama.py                    -- OllamaProvider (mock httpx)
    test_factory.py                   -- factory env 파싱

packages/db/src/schema/
  user-preferences.ts                 -- 신규: LLM 설정 테이블
  custom-types.ts                     -- 수정: VECTOR_DIM env 지원

docker-compose.yml                    -- 수정: Ollama service + profiles
.env.example                          -- 수정: LLM_PROVIDER, VECTOR_DIM 등
.gitignore                            -- 수정: docker-compose.prod.yml, .env.prod
```

---

### Task 1: packages/llm 디렉토리 초기화

**Files:**
- Create: `packages/llm/pyproject.toml`
- Create: `packages/llm/src/llm/__init__.py`
- Create: `packages/llm/tests/conftest.py`

- [x] **Step 1: 디렉토리 생성**

```bash
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm/src/llm
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm/tests
```

- [x] **Step 2: `pyproject.toml` 작성**

```toml
[project]
name = "opencairn-llm"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "google-genai>=1.0.0",
    "httpx>=0.27.0",
    "pydantic>=2.7.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
    "pytest-mock>=3.14.0",
    "respx>=0.21.0",
    "ruff>=0.4.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/llm"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

Save to `packages/llm/pyproject.toml`.

- [x] **Step 3: `src/llm/__init__.py` 작성**

```python
from .base import LLMProvider, EmbedInput, ThinkingResult, SearchResult, ProviderConfig
from .factory import get_provider

__all__ = [
    "LLMProvider",
    "EmbedInput",
    "ThinkingResult",
    "SearchResult",
    "ProviderConfig",
    "get_provider",
]
```

Save to `packages/llm/src/llm/__init__.py`.

- [x] **Step 4: `tests/conftest.py` 작성**

```python
import pytest
from llm.base import ProviderConfig


@pytest.fixture
def gemini_config() -> ProviderConfig:
    return ProviderConfig(
        provider="gemini",
        api_key="test-gemini-key",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-2-preview",
    )


@pytest.fixture
def ollama_config() -> ProviderConfig:
    return ProviderConfig(
        provider="ollama",
        api_key=None,
        model="llama3",
        embed_model="nomic-embed-text",
        base_url="http://localhost:11434",
    )
```

Save to `packages/llm/tests/conftest.py`.

- [x] **Step 5: uv 설치 확인 및 의존성 설치**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv sync --extra dev
```

Expected: `packages/llm/.venv/` 생성, 의존성 설치 완료.

- [x] **Step 6: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add packages/llm/
git commit -m "chore(infra): initialize packages/llm Python package"
```

---

### Task 2: base.py — 데이터 모델 + LLMProvider ABC

**Files:**
- Create: `packages/llm/src/llm/base.py`
- Create: `packages/llm/tests/test_base.py`

- [x] **Step 1: 테스트 작성**

```python
# packages/llm/tests/test_base.py
import pytest
from llm.base import (
    ProviderConfig,
    EmbedInput,
    ThinkingResult,
    SearchResult,
    LLMProvider,
)


def test_provider_config_gemini():
    config = ProviderConfig(
        provider="gemini",
        api_key="key",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-2-preview",
    )
    assert config.provider == "gemini"
    assert config.base_url is None


def test_provider_config_ollama_requires_base_url():
    config = ProviderConfig(
        provider="ollama",
        api_key=None,
        model="llama3",
        embed_model="nomic-embed-text",
        base_url="http://localhost:11434",
    )
    assert config.base_url == "http://localhost:11434"


def test_embed_input_text_only():
    inp = EmbedInput(text="hello world")
    assert inp.text == "hello world"
    assert inp.image_bytes is None


def test_thinking_result():
    result = ThinkingResult(thinking="step 1...", final_answer="answer")
    assert result.final_answer == "answer"


def test_search_result():
    result = SearchResult(
        answer="Paris",
        sources=[{"title": "Wiki", "url": "https://en.wikipedia.org"}],
    )
    assert result.answer == "Paris"
    assert len(result.sources) == 1


class ConcreteProvider(LLMProvider):
    async def generate(self, messages, **kwargs):
        return "ok"

    async def embed(self, inputs):
        return [[0.1] * 3]


@pytest.mark.asyncio
async def test_base_defaults_return_none():
    p = ConcreteProvider(
        ProviderConfig(provider="ollama", api_key=None, model="llama3", embed_model="nomic-embed-text")
    )
    assert await p.cache_context("content") is None
    assert await p.think("prompt") is None
    assert await p.ground_search("query") is None
    assert await p.tts("text") is None
    assert await p.transcribe(b"audio") is None
```

Save to `packages/llm/tests/test_base.py`.

- [x] **Step 2: 테스트 실패 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest tests/test_base.py -v
```

Expected: `ModuleNotFoundError: No module named 'llm.base'`

- [x] **Step 3: `base.py` 구현**

```python
# packages/llm/src/llm/base.py
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ProviderConfig:
    provider: str           # "gemini" | "openai" | "ollama"
    api_key: str | None
    model: str              # 메인 생성 모델
    embed_model: str        # 임베딩 모델
    tts_model: str | None = None
    base_url: str | None = None   # Ollama 엔드포인트
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmbedInput:
    text: str | None = None
    image_bytes: bytes | None = None   # PNG/JPEG
    audio_bytes: bytes | None = None   # MP3/WAV
    pdf_bytes: bytes | None = None
    task: str = "retrieval_document"   # Gemini task instruction


@dataclass
class ThinkingResult:
    thinking: str
    final_answer: str


@dataclass
class SearchResult:
    answer: str
    sources: list[dict[str, str]]


class LLMProvider(ABC):
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    # ── 필수 ──────────────────────────────────────────────────────────────
    @abstractmethod
    async def generate(self, messages: list[dict], **kwargs) -> str: ...

    @abstractmethod
    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]: ...

    # ── Gemini 전용 — 기본 None 반환 ──────────────────────────────────────
    async def cache_context(self, content: str) -> str | None:
        return None

    async def think(self, prompt: str) -> ThinkingResult | None:
        return None

    async def ground_search(self, query: str) -> SearchResult | None:
        return None

    async def tts(self, text: str, model: str | None = None) -> bytes | None:
        return None

    async def transcribe(self, audio: bytes) -> str | None:
        # Gemini: gemini-3-flash-preview에 오디오 + transcribe 프롬프트 전송
        # non-Gemini: None
        return None
```

Save to `packages/llm/src/llm/base.py`.

- [x] **Step 4: 테스트 통과 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest tests/test_base.py -v
```

Expected: 6 passed

- [x] **Step 5: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add packages/llm/src/llm/base.py packages/llm/tests/test_base.py
git commit -m "feat(infra): add LLMProvider ABC and data models"
```

---

### Task 3: GeminiProvider

**Files:**
- Create: `packages/llm/src/llm/gemini.py`
- Create: `packages/llm/tests/test_gemini.py`

- [x] **Step 1: 테스트 작성**

```python
# packages/llm/tests/test_gemini.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from llm.gemini import GeminiProvider
from llm.base import ProviderConfig, EmbedInput


@pytest.fixture
def provider(gemini_config):
    return GeminiProvider(gemini_config)


@pytest.mark.asyncio
async def test_generate_returns_text(provider):
    mock_response = MagicMock()
    mock_response.text = "Hello, world!"
    with patch.object(provider._client.models, "generate_content", return_value=mock_response):
        result = await provider.generate([{"role": "user", "content": "hi"}])
    assert result == "Hello, world!"


@pytest.mark.asyncio
async def test_embed_text_only(provider):
    mock_response = MagicMock()
    mock_response.embeddings = [MagicMock(values=[0.1, 0.2, 0.3])]
    with patch.object(provider._client.models, "embed_content", return_value=mock_response):
        result = await provider.embed([EmbedInput(text="hello")])
    assert result == [[0.1, 0.2, 0.3]]


@pytest.mark.asyncio
async def test_think_returns_thinking_result(provider):
    mock_response = MagicMock()
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].content.parts = [
        MagicMock(thought=True, text="step 1"),
        MagicMock(thought=False, text="final answer"),
    ]
    with patch.object(provider._client.models, "generate_content", return_value=mock_response):
        result = await provider.think("what is 2+2?")
    assert result is not None
    assert result.final_answer == "final answer"
    assert result.thinking == "step 1"


@pytest.mark.asyncio
async def test_tts_returns_bytes(provider):
    mock_response = MagicMock()
    mock_response.audio = b"audio-bytes"
    with patch.object(provider._client.models, "generate_content", return_value=mock_response):
        result = await provider.tts("Hello")
    assert result == b"audio-bytes"


@pytest.mark.asyncio
async def test_transcribe_returns_text(provider):
    mock_response = MagicMock()
    mock_response.text = "transcribed text"
    with patch.object(provider._client.models, "generate_content", return_value=mock_response):
        result = await provider.transcribe(b"audio-data")
    assert result == "transcribed text"
```

Save to `packages/llm/tests/test_gemini.py`.

- [x] **Step 2: 테스트 실패 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest tests/test_gemini.py -v
```

Expected: `ModuleNotFoundError: No module named 'llm.gemini'`

- [x] **Step 3: `gemini.py` 구현**

```python
# packages/llm/src/llm/gemini.py
from __future__ import annotations
import base64
from google import genai
from google.genai import types
from .base import LLMProvider, ProviderConfig, EmbedInput, ThinkingResult, SearchResult

GEMINI_MODELS = {
    "pro": "gemini-3.1-pro-preview",
    "flash": "gemini-3-flash-preview",
    "flash_lite": "gemini-3.1-flash-lite-preview",
    # Historical: plan was written pre-ADR-007 (2026-04-21). Current default is
    # `gemini-embedding-001` (text, MRL 768d). `gemini-embedding-2-preview` is
    # kept as a multimodal fallback — reinstate when Batch API lands for it.
    "embed": "gemini-embedding-001",
    "embed_multimodal": "gemini-embedding-2-preview",
    "tts_flash": "gemini-2.5-flash-preview-tts",
    "tts_pro": "gemini-2.5-pro-preview-tts",
    "live": "gemini-3.1-flash-live-preview",
}


class GeminiProvider(LLMProvider):
    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._client = genai.Client(api_key=config.api_key)

    async def generate(self, messages: list[dict], **kwargs) -> str:
        contents = [
            types.Content(
                role=m["role"],
                parts=[types.Part(text=m["content"])],
            )
            for m in messages
        ]
        response = self._client.models.generate_content(
            model=self.config.model,
            contents=contents,
            **kwargs,
        )
        return response.text

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        parts = []
        for inp in inputs:
            if inp.text:
                parts.append(types.Part(text=inp.text))
            if inp.image_bytes:
                parts.append(types.Part(inline_data=types.Blob(
                    mime_type="image/jpeg", data=inp.image_bytes
                )))
            if inp.audio_bytes:
                parts.append(types.Part(inline_data=types.Blob(
                    mime_type="audio/mp3", data=inp.audio_bytes
                )))
            if inp.pdf_bytes:
                parts.append(types.Part(inline_data=types.Blob(
                    mime_type="application/pdf", data=inp.pdf_bytes
                )))

        response = self._client.models.embed_content(
            model=self.config.embed_model,
            contents=parts,
            config=types.EmbedContentConfig(task_type=inputs[0].task if inputs else "retrieval_document"),
        )
        return [list(e.values) for e in response.embeddings]

    async def cache_context(self, content: str) -> str | None:
        cached = self._client.caches.create(
            model=self.config.model,
            contents=[types.Content(role="user", parts=[types.Part(text=content)])],
        )
        return cached.name  # cache resource name

    async def think(self, prompt: str) -> ThinkingResult | None:
        response = self._client.models.generate_content(
            model=self.config.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(include_thoughts=True)
            ),
        )
        thinking_parts = []
        answer_parts = []
        for part in response.candidates[0].content.parts:
            if getattr(part, "thought", False):
                thinking_parts.append(part.text)
            else:
                answer_parts.append(part.text)
        return ThinkingResult(
            thinking="\n".join(thinking_parts),
            final_answer="\n".join(answer_parts),
        )

    async def ground_search(self, query: str) -> SearchResult | None:
        response = self._client.models.generate_content(
            model=self.config.model,
            contents=query,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())]
            ),
        )
        sources = []
        if response.candidates[0].grounding_metadata:
            for chunk in response.candidates[0].grounding_metadata.grounding_chunks:
                sources.append({
                    "title": chunk.web.title if chunk.web else "",
                    "url": chunk.web.uri if chunk.web else "",
                })
        return SearchResult(answer=response.text, sources=sources)

    async def tts(self, text: str, model: str | None = None) -> bytes | None:
        tts_model = model or self.config.tts_model or GEMINI_MODELS["tts_flash"]
        response = self._client.models.generate_content(
            model=tts_model,
            contents=text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
                    )
                ),
            ),
        )
        return response.audio

    async def transcribe(self, audio: bytes) -> str | None:
        response = self._client.models.generate_content(
            model=self.config.model,
            contents=[
                types.Part(inline_data=types.Blob(mime_type="audio/mp3", data=audio)),
                types.Part(text="Transcribe this audio accurately. Return only the transcript text."),
            ],
        )
        return response.text
```

Save to `packages/llm/src/llm/gemini.py`.

- [x] **Step 4: 테스트 통과 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest tests/test_gemini.py -v
```

Expected: 5 passed

- [x] **Step 5: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini.py
git commit -m "feat(infra): add GeminiProvider with premium features"
```

---

### Task 4: OllamaProvider

**Files:**
- Create: `packages/llm/src/llm/ollama.py`
- Create: `packages/llm/tests/test_ollama.py`

- [x] **Step 1: 테스트 작성**

```python
# packages/llm/tests/test_ollama.py
import pytest
import respx
import httpx
import json
from llm.ollama import OllamaProvider
from llm.base import EmbedInput


@pytest.fixture
def provider(ollama_config):
    return OllamaProvider(ollama_config)


@pytest.mark.asyncio
async def test_generate_returns_text(provider):
    with respx.mock:
        respx.post("http://localhost:11434/api/chat").mock(
            return_value=httpx.Response(
                200,
                json={"message": {"role": "assistant", "content": "Hello from Ollama"}},
            )
        )
        result = await provider.generate([{"role": "user", "content": "hi"}])
    assert result == "Hello from Ollama"


@pytest.mark.asyncio
async def test_embed_returns_vectors(provider):
    with respx.mock:
        respx.post("http://localhost:11434/api/embed").mock(
            return_value=httpx.Response(
                200,
                json={"embeddings": [[0.1, 0.2, 0.3]]},
            )
        )
        result = await provider.embed([EmbedInput(text="hello")])
    assert result == [[0.1, 0.2, 0.3]]


@pytest.mark.asyncio
async def test_premium_features_return_none(provider):
    assert await provider.think("prompt") is None
    assert await provider.tts("text") is None
    assert await provider.transcribe(b"audio") is None
    assert await provider.cache_context("content") is None
    assert await provider.ground_search("query") is None
```

Save to `packages/llm/tests/test_ollama.py`.

- [x] **Step 2: 테스트 실패 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest tests/test_ollama.py -v
```

Expected: `ModuleNotFoundError: No module named 'llm.ollama'`

- [x] **Step 3: `ollama.py` 구현**

```python
# packages/llm/src/llm/ollama.py
from __future__ import annotations
import httpx
from .base import LLMProvider, ProviderConfig, EmbedInput

OLLAMA_DEFAULT_URL = "http://localhost:11434"


class OllamaProvider(LLMProvider):
    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._base = (config.base_url or OLLAMA_DEFAULT_URL).rstrip("/")

    async def generate(self, messages: list[dict], **kwargs) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base}/api/chat",
                json={"model": self.config.model, "messages": messages, "stream": False},
                timeout=120,
            )
            response.raise_for_status()
            return response.json()["message"]["content"]

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        texts = [inp.text or "" for inp in inputs]
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base}/api/embed",
                json={"model": self.config.embed_model, "input": texts},
                timeout=60,
            )
            response.raise_for_status()
            return response.json()["embeddings"]
```

Save to `packages/llm/src/llm/ollama.py`.

- [x] **Step 4: 테스트 통과 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest tests/test_ollama.py -v
```

Expected: 3 passed

- [x] **Step 5: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add packages/llm/src/llm/ollama.py packages/llm/tests/test_ollama.py
git commit -m "feat(infra): add OllamaProvider for fully local deployment"
```

---

### Task 5: factory.py

**Files:**
- Create: `packages/llm/src/llm/factory.py`
- Create: `packages/llm/tests/test_factory.py`

- [x] **Step 1: 테스트 작성**

```python
# packages/llm/tests/test_factory.py
import pytest
from llm.factory import get_provider
from llm.base import ProviderConfig
from llm.gemini import GeminiProvider
from llm.ollama import OllamaProvider


def test_get_provider_gemini():
    config = ProviderConfig(
        provider="gemini", api_key="key",
        model="gemini-3-flash-preview", embed_model="gemini-embedding-2-preview"
    )
    provider = get_provider(config)
    assert isinstance(provider, GeminiProvider)


def test_get_provider_ollama():
    config = ProviderConfig(
        provider="ollama", api_key=None,
        model="llama3", embed_model="nomic-embed-text",
        base_url="http://localhost:11434"
    )
    provider = get_provider(config)
    assert isinstance(provider, OllamaProvider)


def test_get_provider_unknown_raises():
    config = ProviderConfig(
        provider="unknown", api_key=None,
        model="x", embed_model="x"
    )
    with pytest.raises(ValueError, match="Unknown provider: unknown"):
        get_provider(config)


def test_get_provider_openai_raises():
    # OpenAI is intentionally unsupported (2026-04-15 decision)
    config = ProviderConfig(
        provider="openai", api_key="key",
        model="gpt-4o", embed_model="text-embedding-3-small"
    )
    with pytest.raises(ValueError, match="Unknown provider: openai"):
        get_provider(config)


def test_get_provider_from_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3")
    monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    provider = get_provider()
    assert isinstance(provider, OllamaProvider)
```

Save to `packages/llm/tests/test_factory.py`.

- [x] **Step 2: 테스트 실패 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest tests/test_factory.py -v
```

Expected: `ModuleNotFoundError: No module named 'llm.factory'`

- [x] **Step 3: `factory.py` 구현**

```python
# packages/llm/src/llm/factory.py
from __future__ import annotations
import os
from .base import LLMProvider, ProviderConfig
from .gemini import GeminiProvider
from .ollama import OllamaProvider


def get_provider(config: ProviderConfig | None = None) -> LLMProvider:
    if config is None:
        config = ProviderConfig(
            provider=os.environ["LLM_PROVIDER"],
            api_key=os.getenv("LLM_API_KEY"),
            model=os.environ["LLM_MODEL"],
            embed_model=os.environ["EMBED_MODEL"],
            tts_model=os.getenv("TTS_MODEL"),
            base_url=os.getenv("OLLAMA_BASE_URL"),
        )
    match config.provider:
        case "gemini":
            return GeminiProvider(config)
        case "ollama":
            return OllamaProvider(config)
        case _:
            raise ValueError(f"Unknown provider: {config.provider}")
```

Save to `packages/llm/src/llm/factory.py`.

- [x] **Step 4: 전체 테스트 통과 확인**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/llm
uv run pytest -v
```

Expected: 17 passed

- [x] **Step 5: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add packages/llm/src/llm/factory.py packages/llm/tests/test_factory.py
git commit -m "feat(infra): add provider factory with env-based config"
```

---

### Task 6: packages/db — user_preferences 테이블 + VECTOR_DIM

**Files:**
- Create: `packages/db/src/schema/user-preferences.ts`
- Modify: `packages/db/src/schema/custom-types.ts`
- Modify: `packages/db/src/schema/index.ts` (또는 `packages/db/src/index.ts`)

> **Note:** `packages/db`가 아직 초기화되지 않은 경우 Plan 1 완료 후 실행한다.

- [x] **Step 1: `user-preferences.ts` 작성**

```typescript
// packages/db/src/schema/user-preferences.ts
import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userPreferences = pgTable("user_preferences", {
  // Better Auth users.id는 text 타입 — uuid() 사용 시 FK 타입 불일치 (M-3 수정)
  userId:       text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  llmProvider:  text("llm_provider").notNull().default("gemini"),   // "gemini" | "ollama" (openai는 2026-04-15 제거)
  llmModel:     text("llm_model").notNull().default("gemini-3-flash-preview"),
  embedModel:   text("embed_model").notNull().default("gemini-embedding-2-preview"),
  ttsModel:     text("tts_model"),
  ollamaBaseUrl: text("ollama_base_url"),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type UserPreferencesInsert = typeof userPreferences.$inferInsert;
```

Save to `packages/db/src/schema/user-preferences.ts`.

- [x] **Step 2: `custom-types.ts`에 VECTOR_DIM 지원 추가**

기존 `custom-types.ts`에서 vector 차원을 하드코딩한 부분을 env 기반으로 변경한다.

```typescript
// packages/db/src/schema/custom-types.ts
// 기존 코드에 아래 추가 (또는 수정)
import { customType } from "drizzle-orm/pg-core";

const VECTOR_DIM = parseInt(process.env.VECTOR_DIM ?? "3072", 10);

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${VECTOR_DIM})`;
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
```

- [x] **Step 3: 마이그레이션 생성**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm db:generate
```

Expected: `drizzle/` 폴더에 새 migration SQL 파일 생성 (user_preferences 테이블).

- [x] **Step 4: Commit**

```bash
git add packages/db/src/schema/user-preferences.ts packages/db/src/schema/custom-types.ts drizzle/
git commit -m "feat(db): add user_preferences table and dynamic VECTOR_DIM"
```

---

### Task 7: Docker Compose + 환경 변수

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore`

- [x] **Step 1: `docker-compose.yml`에 Ollama 서비스 추가**

기존 `docker-compose.yml`에 다음 서비스를 추가한다:

```yaml
  ollama:
    image: ollama/ollama:latest
    profiles: ["ollama"]
    volumes:
      - ollama_data:/root/.ollama
    ports:
      - "11434:11434"
    restart: unless-stopped

volumes:
  ollama_data:
```

- [x] **Step 2: `.env.example`에 LLM 관련 변수 추가**

기존 `.env.example` 파일에 다음 섹션을 추가한다:

```bash
# ── LLM Provider ───────────────────────────────────────────────────────────
# "gemini" | "ollama"  (OpenAI는 2026-04-15 제거)
LLM_PROVIDER=gemini

# Gemini (production)
LLM_API_KEY=your-gemini-api-key
LLM_MODEL=gemini-3-flash-preview
EMBED_MODEL=gemini-embedding-2-preview
TTS_MODEL=gemini-2.5-flash-preview-tts

# Ollama 완전 로컬 (LLM_PROVIDER=ollama 시)
# LLM_MODEL=llama3
# EMBED_MODEL=nomic-embed-text
# OLLAMA_BASE_URL=http://ollama:11434

# ── Vector Dimension ────────────────────────────────────────────────────────
# Gemini 3072 (native) | Matryoshka truncate → 1536 (storage 절감 권장)
# Ollama nomic-embed-text: 768
# 권장 운영값: VECTOR_DIM=1536 (storage-planning.md 참조)
VECTOR_DIM=3072
```

- [x] **Step 3: `.gitignore`에 private 파일 추가**

```
# Private production config
docker-compose.prod.yml
.env.prod
.env.local
```

- [x] **Step 4: Ollama 셀프호스트 시작 검증**

```bash
# LLM_PROVIDER=ollama 설정 후
docker compose --profile ollama up -d ollama
docker compose ps
```

Expected: `ollama` 컨테이너 running, port 11434 바인딩.

- [x] **Step 5: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add docker-compose.yml .env.example .gitignore
git commit -m "feat(infra): add Ollama docker profile and LLM env vars"
```

---

## 완료 기준

- [x] `uv run pytest` — 17 tests passed (`packages/llm/`, OpenAI 제거 후)
- [x] `GeminiProvider`, `OllamaProvider` 모두 `LLMProvider` 인터페이스 구현
- [x] `get_provider("openai", ...)` — ValueError 발생 (의도적 비지원)
- [x] `get_provider()` — env 없이 config로도, env로도 동작
- [x] `docker compose --profile ollama up` — Ollama 컨테이너 정상 기동
- [x] `VECTOR_DIM` env 변경 시 Drizzle 마이그레이션이 다른 차원의 vector column 생성
- [x] `.gitignore`에 `docker-compose.prod.yml`, `.env.prod` 포함

---

### Task 8: Tool Declaration Methods (Plan 12 cross-reference, deferred)

> **Added 2026-04-20 by Plan 12 Task 16.** This task is *deferred to Plan 12 Task 5* — it documents that `packages/llm` providers will gain a `build_tool_declarations` method when Plan 12 lands. No work happens in this plan.

**Files (when implemented in Plan 12 Task 5):**
- Modify: `packages/llm/src/llm/base.py`
- Modify: `packages/llm/src/llm/gemini.py`
- Modify: `packages/llm/src/llm/ollama.py`

Add `build_tool_declarations(tools: list) -> list[dict]` method to `LLMProvider`. Default raises `NotImplementedError`; Gemini and Ollama implement via `runtime.tool_declarations` (lazy import to avoid circular dependency between `packages/llm` and `apps/worker/src/runtime`). See Plan 12 Task 5 for the schema builder details.
