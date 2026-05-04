# Gemini Provider Surface Audit

This page records the public, durable Gemini provider surface. It is not a raw
review log; private implementation history stays outside the public docs.

## Current Calls

| Surface | Current implementation | Product status |
| --- | --- | --- |
| Chat generation | `packages/llm/src/llm/gemini.py` uses `google.genai` `models.generate_content`; `apps/api/src/lib/llm/gemini.ts` uses `generateContentStream` for API chat. | Shipped for worker agents and API chat. |
| Tool calling | Worker tool loops use Gemini function declarations and return function responses with the SDK message parts. | Shipped in worker runtime. |
| Embeddings | `packages/llm` calls `models.embed_content`; API chat calls `models.embedContent` for query embeddings. Default model is `gemini-embedding-001`. | Shipped for text embeddings. |
| Batch embeddings | Provider and worker workflow plumbing exist through `embed_many()` and `BatchEmbedWorkflow`. | Not default-on; it only runs when the caller injects the batch callback, the relevant `BATCH_EMBED_*_ENABLED` flag is true, input count is at or above `BATCH_EMBED_MIN_ITEMS`, and the provider supports batch embedding. |
| Context cache / CAG | `GeminiProvider.cache_context()` and `cached_context_id` pass-through exist. | Provider plumbing only. No default product flow currently builds or refreshes project caches for Research/Socratic queries. |
| Deep Research Interactions | Deep Research starts Gemini Interactions in background mode, streams the interaction via `stream_interaction()`, and maps raw `content.delta` events into stored product artifacts. | Shipped for Gemini Deep Research only. |

## Important Boundaries

- Gemini Embedding 2 / multimodal embeddings are not the default product path.
  The shipped default remains `gemini-embedding-001`; multimodal model switching
  is an operator choice and does not imply Batch API support.
- Batch embedding support is implemented infrastructure, not a statement that
  all embeddings use the Gemini Batch API by default.
- Context caching is implemented as provider plumbing. Public product surfaces
  must not claim project-level CAG is active until a concrete API/worker flow
  creates, invalidates, and uses caches.
- Deep Research stream storage uses product artifact kinds:
  `thought_summary`, `text_delta`, `image`, and `citation`. Gemini transport
  events such as `content.delta` are not stored directly.

## Verification Pointers

- Gemini provider: `packages/llm/src/llm/gemini.py`
- API Gemini chat provider: `apps/api/src/lib/llm/gemini.ts`
- Deep Research worker stream adapter:
  `apps/worker/src/worker/activities/deep_research/execute_research.py`
- Deep Research API artifact schema: `apps/api/src/routes/internal.ts`
- User-facing rendering: `apps/web/src/components/research/ResearchProgress.tsx`
