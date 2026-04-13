# LLM Anti-Patterns

Claude가 반복적으로 틀리는 것들. 구현 전 반드시 확인.

---

## Gemini 모델 ID

| 틀린 것 | 올바른 것 |
|--------|---------|
| `gemini-2.0-flash` | `gemini-3-flash-preview` |
| `gemini-2.0-flash-exp` | `gemini-3-flash-preview` |
| `gemini-1.5-pro` | `gemini-3.1-pro-preview` |
| `gemini-3.0-flash` | `gemini-3-flash-preview` |
| `text-embedding-004` | `gemini-embedding-2-preview` |
| `gemini-2.5-flash-tts` | `gemini-2.5-flash-preview-tts` |
| `gemini-2.5-pro-tts` | `gemini-2.5-pro-preview-tts` |
| `gemini-2.5-flash-live` | `gemini-3.1-flash-live-preview` |

**Gemini 문서는 항상 로컬 참조:** `references/Gemini_API_docs/`

---

## Next.js 16

| 틀린 것 | 올바른 것 |
|--------|---------|
| `middleware.ts` | `proxy.ts` |

- Next.js 16에서 `middleware.ts`는 deprecated — `proxy.ts` 사용
- `NextRequest` → `NextResponse` 구조는 동일
- `config.matcher` 필수 (정적 에셋 포함 전체 실행 방지)

```ts
// proxy.ts (Next.js 16)
export function proxy(request: NextRequest) {
  // 기존 middleware 로직 그대로 사용 가능
}
export const config = { matcher: ["/api/:path*", "/(app)/:path*"] };
```

---

## Vector Dimension

| 틀린 것 | 올바른 것 |
|--------|---------|
| `VECTOR(3072)` 하드코딩 | `VECTOR_DIM` env 변수 |
| `vector3072` 커스텀 타입 | `const VECTOR_DIM = parseInt(process.env.VECTOR_DIM ?? "3072")` |

Provider별 기본값: Gemini=3072, OpenAI=1536, Ollama(nomic)=768

---

## LLM Provider

| 틀린 것 | 올바른 것 |
|--------|---------|
| `from worker.gemini.client import GeminiClient` | `from llm import get_provider` |
| `GeminiClient(api_key=...)` 직접 생성 | `get_provider()` 팩토리 사용 |
| `EMBED_MODEL = "gemini-embedding-2-preview"` 하드코딩 | `os.environ["EMBED_MODEL"]` |

---

## 라이브러리 참조

| 상황 | 참조 방법 |
|------|---------|
| Gemini API (google-genai) | `references/Gemini_API_docs/` 로컬 문서 |
| 그 외 모든 라이브러리 | context7 MCP 사용 |

**Gemini API는 절대 학습 데이터에 의존하지 말 것** — 모델명/메서드명이 자주 바뀜.
