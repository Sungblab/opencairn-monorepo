---
title: Chat Real LLM Wiring (Tier 1 #1·#2·#3 fix)
status: draft
date: 2026-04-28
related:
  - docs/review/2026-04-28-completion-claims-audit.md
  - docs/superpowers/specs/2026-04-21-plan-11b-chat-editor-bridge-design.md
  - docs/architecture/context-budget.md
supersedes: null
---

# Chat Real LLM Wiring — design

## 0. Why this exists

`docs/review/2026-04-28-completion-claims-audit.md` §1 enumerated three "✅ merged" plans whose user-facing chat surface is a stub:

- **§1.1 — Phase 4 Agent Panel**: `apps/api/src/lib/agent-pipeline.ts:39` returns `(stub agent response to: ...)` over SSE.
- **§1.2 — Plan 11A `/api/chat/message`**: `apps/api/src/routes/chat.ts:376` streams the literal string `(11A placeholder reply)` and computes tokens with `Math.ceil(content.length / 4)`. `ragMode` and `attachedChips` are persisted but read **zero times** during retrieval (`chat.ts:65-66, 184` are write-only sites).
- **§1.3 — Plan 2D save_suggestion**: the only producer is gated behind `process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION === "1"` AND `userMessage.content.includes("/test-save")` (agent-pipeline.ts:46-58). The renderer is real, the producer is fake.

Production has **zero** user-facing paths that invoke a real LLM today. This spec replaces all three stubs in one PR (Plan 11B Phase A, branch `feat/plan-11b-phase-a`, on top of HEAD `a44b810`).

## 1. Goals & non-goals

### In scope

1. Both chat SSE routes call a real Gemini provider end-to-end.
2. Retrieval (RAG) actually consumes `ragMode` and `attachedChips` and returns real `Citation[]`.
3. Token / cost accounting uses provider-reported `usage_metadata` rather than a string-length heuristic.
4. `save_suggestion` events emit when (and only when) the LLM actually emits a suggestion. The env-gated stub is deleted.
5. `agent-pipeline.ts` and `chat.ts /message` keep their existing SSE wire formats — clients (web ChatPanel, agent panel) need zero changes.
6. `pnpm dev` smoke: open agent panel or `/chat`, send a question that requires retrieval, see a real grounded answer with citations and provider-reported tokens.

### Explicitly out of scope (follow-ups, not this PR)

- **Schema unification** of `chat_threads/chat_messages` (Phase 4) and `conversations/conversation_messages` (11A). Both stay as-is — too big and orthogonal to "make LLM real".
- **Ollama support** for chat. The TS path is Gemini-only this PR. Ollama remains in `packages/llm` Python and is unreachable from chat. Tracked: Plan 11B follow-up "TS provider abstraction".
- **Worker-side ResearchAgent re-platforming** flagged by audit §3.2. Worker chat does not exist; chat is always API-direct.
- **Long-context vs hybrid mode router** from `docs/architecture/context-budget.md` §"이중 모드". v1 ships hybrid mode only; long-context (<200k) routing is a follow-up.
- **L3/L4/L2 memory chip retrieval** beyond a no-op. The chips persist (already), but are not read by retrieval until Plan 11B Phase B/C lands the memory store. UI should not regress.
- **Streaming citations as discrete `citation` events.** v1 batches them in the final-state metadata before emitting `done`. The wire format already supports this; backporting per-step citations is in 11B Phase B (`/cite`).
- **BYOK** (per-user keys for chat). Server `GEMINI_API_KEY` only this PR; BYOK extends naturally to `chat-llm.ts` once wired.
- **Cost-optimised prompt caching** (Gemini context cache). Adds a re-platforming concern; defer to a "Plan 11B prompt-cache" follow-up.

## 2. Architecture — C1 hybrid (chat in API, batch in worker)

```
agent-panel UI ─┐                           ┌─ /api/threads/:id/messages   ─┐
                ├─→  POST  ───→  Hono API ──┤                               ├─→  chat-llm.runChat()
chat-scope UI ──┘                           └─ /api/chat/message            ─┘     │
                                                                                   ├─→  chat-retrieval.retrieve()
                                                                                   │     └─ embed query (gemini-embedding-001)
                                                                                   │     └─ pgvector + tsvector RRF (workspace/project/page)
                                                                                   │
                                                                                   └─→  llm/gemini-client.streamGenerate()
                                                                                          └─ SSE chunks: text deltas + final usageMetadata
```

`apps/worker` is untouched. Doc-editor (Plan 11B Phase A T11/T12) keeps its Temporal workflow path. Deep-research, ingest, plan 8 keep theirs. Only chat is API-direct.

### Why API-direct (not worker)

1. **Streaming UX**: `@google/genai` exposes a token-by-token async iterator with `usageMetadata` on the final chunk. The Hono SSE encoder already consumes async iterators (see `threads.ts` and `doc-editor.ts`). One hop, one streaming primitive.
2. **Temporal is batch-shaped**: `await handle.result()` resolves once. To stream tokens through Temporal you'd need either Temporal Updates with a polling client or a Redis pub/sub bridge (live-ingest pattern). Adds two new infra concerns to a feature whose blocker is "the stub returns a string".
3. **`apps/api` already owns business logic** per `CLAUDE.md` and already does cross-table reads (Drizzle + pgvector). Chat retrieval is exactly this shape.
4. **Worker `ResearchAgent` is itself flagged** by audit §3.2 ("legacy regex parsing"). Routing chat through it would inherit a known-bad path.

### Why two LLM clients (Python + new TS)

- Worker keeps `packages/llm` (Python) for: ingest enrichment, doc-editor, deep-research, plan 8 cron agents, agent-runtime v2 Sub-A. None of these stream tokens to the user.
- API gets a **new minimal** TS client (`apps/api/src/lib/llm/gemini.ts`) covering exactly two operations: `embed(text)` and `streamGenerate(messages, opts)`. ~150 LOC, no abstraction layer beyond what chat needs. **Not a port** of `packages/llm`. If we later add Ollama-in-TS or BYOK, this is the file to extend.

The stated cost (two clients) is real. The trade is: keep Python's batch-orchestration LLM code where it earns its keep, and don't bend it through a streaming proxy to satisfy "single client" purity.

## 3. Components

### 3.1 `apps/api/src/lib/llm/gemini.ts` — new

Public surface:

```ts
export type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
export type Usage = { tokensIn: number; tokensOut: number; model: string };

export interface LLMProvider {
  embed(text: string): Promise<number[]>;                     // 768d (ADR-007)
  streamGenerate(opts: {
    messages: ChatMsg[];
    signal?: AbortSignal;
    maxOutputTokens?: number;
    temperature?: number;
  }): AsyncGenerator<{ delta: string } | { usage: Usage }>;
}

export function getGeminiProvider(): LLMProvider;
```

Implementation notes:

- Uses `@google/genai` ≥ 1.0 (`new GoogleGenAI({ apiKey })`).
- `embed` calls `models.embedContent` with `gemini-embedding-001`, taskType `RETRIEVAL_QUERY` for queries, `RETRIEVAL_DOCUMENT` is **not** used here (worker owns document embeds). Returns `outputDimensionality=768` to match ADR-007.
- `streamGenerate` wraps `models.generateContentStream`. Iterator yields `{delta}` per text chunk; on stream end yields **one** `{usage}` from the last response's `usageMetadata`.
- Reads `GEMINI_API_KEY` (fallback to `GOOGLE_API_KEY` for parity with `packages/llm`). Throws explicit `LLMNotConfiguredError` (subclass of `Error` with HTTP-friendly `code = "llm_not_configured"`) if neither is set, so routes can map to a 503 with a useful body.
- Reads `GEMINI_CHAT_MODEL` (default `"gemini-2.5-flash"`). Single env, not per-route.
- `signal` is forwarded to the SDK's abort controller path (`@google/genai` v1 supports it via `requestOptions.signal`). On abort the iterator returns cleanly; the caller's `finally` block runs.
- Tests mock `@google/genai`'s `GoogleGenAI` class (vitest module mock). No live network calls in CI.

### 3.2 `apps/api/src/lib/chat-retrieval.ts` — new

Public surface:

```ts
export type RagMode = "strict" | "expand" | "off";

export type RetrievalScope =
  | { type: "workspace"; workspaceId: string }
  | { type: "project"; workspaceId: string; projectId: string }
  | { type: "page"; workspaceId: string; noteId: string };

export type RetrievalChip =
  | { type: "page"; id: string }
  | { type: "project"; id: string }
  | { type: "workspace"; id: string };

export type RetrievalHit = {
  noteId: string;
  title: string;
  snippet: string;
  score: number;
  blockId?: string;
};

export async function retrieve(opts: {
  workspaceId: string;
  query: string;
  ragMode: RagMode;
  scope: RetrievalScope;          // conversation scope from caller
  chips: RetrievalChip[];         // attachedChips, page/project/workspace only
  signal?: AbortSignal;
}): Promise<RetrievalHit[]>;
```

Behavior:

- `ragMode === "off"` → return `[]` immediately (no embed call). System prompt drops the RAG section.
- `ragMode === "strict"` → `top_k = CHAT_RAG_TOP_K_STRICT` (default 5).
- `ragMode === "expand"` → `top_k = CHAT_RAG_TOP_K_EXPAND` (default 12).
- **Scope resolution order** (chip union takes precedence over conversation scope):
  1. If `chips` is non-empty → union of chip targets defines the project/note id set. Mixed chip types are allowed; we resolve each independently and concat hits.
  2. Otherwise → use `scope`.
- **Workspace scope** boundary is **always** enforced. A chip pointing to a project in a different workspace than `workspaceId` is silently dropped (not 403'd, since the chip table has its own boundary check at write time; this is defense-in-depth).
- **Project scope**: directly call `internal.notes/hybrid-search` semantics (refactored — see 3.3).
- **Page scope**: filter `notes` by `id = noteId`, then re-run vector + tsvector against that single note's chunks. v1 is fine to be a single SQL query without RRF (only a few chunks to rank).
- **Workspace scope**: enumerate projects in workspace, fan out to project-level RRF, then re-merge by RRF across results. v1 keeps `top_k` per-project at `top_k * 2` and final merge to `top_k`. If a workspace has hundreds of projects this is slow; that's an acceptable v1 limit and we cap fan-out at `CHAT_RAG_MAX_PROJECTS=64` to bound the worst case.
- Memory chips (`memory:l3*`, `memory:l4`, `memory:l2`) are **silently ignored** by retrieval in v1. Filter them out before scope resolution; document this in the retrieval module's header comment so the next session doesn't add silent partial-write behavior.
- Returns the merged top-k hits with normalized 0..1 scores.

### 3.3 `apps/api/src/lib/internal-hybrid-search.ts` — refactor

The SQL today only lives inside `routes/internal.ts` as a route handler. Extract the core RRF function so `chat-retrieval.ts` and the existing `/internal/notes/hybrid-search` route both call it without HTTP round-tripping. Route handler becomes a thin Zod-validated wrapper.

This is the only "tidy as you go" included in the spec. It's not a refactor for its own sake — chat retrieval needs the function, and importing through the HTTP route would be silly.

### 3.4 `apps/api/src/lib/chat-llm.ts` — new

Public surface:

```ts
export type ChatChunk =
  | { type: "status"; payload: { phrase: string } }
  | { type: "thought"; payload: { summary: string } }
  | { type: "text"; payload: { delta: string } }
  | { type: "citation"; payload: Citation }
  | { type: "save_suggestion"; payload: { title: string; body_markdown: string } }
  | { type: "usage"; payload: { tokensIn: number; tokensOut: number; model: string } }
  | { type: "done"; payload: Record<string, never> };

export async function* runChat(opts: {
  workspaceId: string;
  scope: RetrievalScope;
  ragMode: RagMode;
  chips: RetrievalChip[];
  history: ChatMsg[];                 // prior turns from the persistent table
  userMessage: string;
  signal?: AbortSignal;
  provider?: LLMProvider;             // injectable for tests
}): AsyncGenerator<ChatChunk>;
```

Pipeline:

1. Yield `status: "관련 문서 훑는 중..."` (Korean status strings already used in agent-pipeline.ts; UI handles i18n via the message catalog separately — out of scope here).
2. Call `retrieve()`. If non-empty, yield one `citation` chunk per hit (so `meta.citations` accumulates in the route).
3. Build prompt:
   - **System**: role + tone + citation format (`[^1]` style, indices match yielded citation order) + save_suggestion guard (see 3.5) + workspace name (lookup once).
   - **RAG block** (skipped when `ragMode==="off"` or hits empty): `<context>\n[1] ${title}\n${snippet}\n...\n</context>`.
   - **History**: the last N turns from `history` (user/assistant pairs). N bounded by `CHAT_MAX_HISTORY_TURNS` (default 12) and the system enforces a hard token budget — if estimated input tokens > `CHAT_MAX_INPUT_TOKENS` (default 32000), drop oldest turns until under budget. Estimation: `Math.ceil(text.length / 3.5)` (rough, only used to bound prompt size, not for billing).
   - **User**: `userMessage`.
4. Yield `thought: "사용자의 질문 분석 중"` (kept for parity with Phase 4 status UI; payload is informational only — we do not run a separate "thinking" pass in v1).
5. Stream `provider.streamGenerate({ messages, signal })`. For each `{delta}` chunk, parse out save-suggestion fences (3.5). Yield `text` deltas in real time.
6. On `{usage}` chunk → yield `usage`.
7. Yield `done`.

Errors:

- `LLMNotConfiguredError` → propagate; the route maps to SSE `error` event with code `"llm_not_configured"` and HTTP 503 if pre-stream.
- Provider errors mid-stream → yield no further chunks; throw, caller's `finally` finalizes the row with status `"failed"`.
- Abort → iterator returns; no error event.

### 3.5 Save-suggestion fence parser

System prompt suffix (verbatim, in Korean to match prevailing UI tone):

> 응답 마지막에, 사용자가 별도 노트로 저장하면 유용한 통찰이 있다면 다음 형식의 fenced 블록을 정확히 한 번 추가하세요. 통찰이 없으면 추가하지 마세요. 헷갈리면 추가하지 않습니다.
>
> ` ```save-suggestion`
> `{"title": "...", "body_markdown": "..."}`
> ` ``` `

Parser implementation (in `chat-llm.ts`):

- Maintain a rolling buffer of emitted text.
- On stream end, scan the **final assembled response** (not per-delta) for `^[\t ]*```save-suggestion\n([\s\S]+?)```` matched once. If matched, JSON.parse the captured group; on parse success and shape validation (`title: string`, `body_markdown: string`, both non-empty, lengths bounded), yield a `save_suggestion` chunk.
- The text deltas already streamed include the fence; the renderer in `apps/web/src/components/chat-renderer/` already strips fenced blocks it doesn't recognise (verified: see `markdown-render.tsx` block whitelist). No client churn needed.
- If JSON.parse fails or shape is invalid → silently skip (do not error the stream). Add structured log `chat.save_suggestion_parse_failed` so operators see misbehaving prompts.

This replaces the `process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION` + `/test-save` substring trigger, which is deleted along with its fixture call sites.

## 4. Wiring the two routes

### 4.1 `apps/api/src/lib/agent-pipeline.ts` — replace stub

```ts
export async function* runAgent(opts: {
  threadId: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
}): AsyncGenerator<AgentChunk> {
  // 1. Resolve workspace + history from chatThreads/chatMessages
  // 2. Decode `scope` (chat-threads has no chips/ragMode column — see 4.1.1)
  // 3. Yield status, then for await on chat-llm.runChat()
  // 4. Map ChatChunk → AgentChunk (citation: pass-through; usage: store on
  //    chat_messages.token_usage jsonb in finalize)
}
```

#### 4.1.1 Phase 4 has no ragMode/chips column

`chat_threads` predates `conversations` and stores no chip/RAG state. Two options:

- **(a)** v1: derive defaults — `ragMode = "strict"`, `chips = []`, `scope = { type: "workspace", workspaceId }`. Phase 4 chat is "ask anything in this workspace" by default. Acceptable.
- **(b)** Add columns. Out of scope per §1 non-goals.

Pick (a). When the agent panel UI grows scope chips it'll either migrate to the `conversations` table or get its own follow-up.

#### 4.1.2 Token usage persistence

`chat_messages.token_usage` is `jsonb`. Store `{tokensIn, tokensOut, model, costKrw}`. Cost via existing `tokensToKrw()` from `apps/api/src/lib/cost.ts`. Provider model name comes from `usage.model`.

### 4.2 `apps/api/src/routes/chat.ts` — replace placeholder

Replace lines 362–417 (the `streamSSE` block + the heuristic token calc). Wire:

- Read `convo.attachedChips`, `convo.ragMode`, `convo.scopeType`, `convo.scopeId`, `convo.workspaceId`.
- Map to `RetrievalChip[]` (filter out `memory:*` per §3.2 silent-ignore rule).
- Map `scopeType+scopeId+workspaceId` to `RetrievalScope`.
- Read history: last N `conversation_messages` for this conversation, oldest-first, mapping `role` to `ChatMsg.role` (treat `tool` rows as assistant in v1, since the renderer concats them).
- For-await `chat-llm.runChat()`. Buffer text. On `usage` chunk, derive token counts. Persist the assistant `conversation_messages` row with **provider-reported** `tokensIn`, `tokensOut`, and `costKrw` (computed once via `tokensToKrw`).
- On the final UPDATE to `conversations`, increment totals using the same numbers (no more `Math.ceil(content.length/4)` for the user side either — the user's input tokens are the provider's reported `tokensIn` *for this turn's prompt*. To keep the user-vs-assistant split honest, store the user row with `tokensIn = usage.promptTokens` and `tokensOut = 0`, and the assistant row with `tokensIn = 0` and `tokensOut = usage.candidatesTokens`. Pricing is per-direction so the totals match).

Note: Gemini reports `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`. v1 maps:

```
user row.tokensIn  = usage.promptTokens
user row.tokensOut = 0
assistant row.tokensIn  = 0
assistant row.tokensOut = usage.candidatesTokens
```

System tokens are bundled in `promptTokens` per Gemini's accounting. We do not double-count.

### 4.3 SSE events emitted

Both routes emit the same set, in the same order, that they emit today. The change is what fills `text/citation/usage/save_suggestion` events:

| Event             | Phase 4 today | Phase 4 after | 11A today        | 11A after        |
| ----------------- | ------------- | ------------- | ---------------- | ---------------- |
| user_persisted    | ✅ stays      | ✅            | ❌ (sync write)  | ❌ (sync write)  |
| agent_placeholder | ✅            | ✅            | ❌               | ❌               |
| status            | ✅ (stub)     | ✅ (real)     | ❌               | ❌ (skipped — 11A wire is leaner) |
| thought           | ✅ (stub)     | ✅ (real, optional) | ❌         | ❌               |
| text / delta      | ✅ (stub)     | ✅ (real)     | ✅ (placeholder) | ✅ (real)        |
| citation          | ❌            | ✅ (new)      | ❌               | ✅ (new)         |
| save_suggestion   | ✅ (env-stub) | ✅ (real)     | ❌               | ❌ (out of scope for 11A surface — 11A SSE doesn't transport this; the agent panel is the canonical save-suggestion surface) |
| usage / cost      | ❌            | ✅ (new)      | ✅ (heuristic)   | ✅ (real)        |
| done              | ✅            | ✅            | ✅               | ✅               |

11A's `cost` event today carries `tokensIn/tokensOut/costKrw` for the assistant only. After: same shape, real numbers.

## 5. Env vars

Add to `.env.example` and `apps/api/.env.example` (ko comment + en mirror):

```bash
# Chat-direct LLM (apps/api/src/lib/llm/gemini.ts)
# Reuses GEMINI_API_KEY already used by the worker.
GEMINI_CHAT_MODEL=gemini-2.5-flash

# RAG retrieval bounds (apps/api/src/lib/chat-retrieval.ts)
CHAT_RAG_TOP_K_STRICT=5
CHAT_RAG_TOP_K_EXPAND=12
CHAT_RAG_MAX_PROJECTS=64
CHAT_MAX_HISTORY_TURNS=12
CHAT_MAX_INPUT_TOKENS=32000
```

**Removed**: `AGENT_STUB_EMIT_SAVE_SUGGESTION`. Delete from `.env.example` and any docs that mention it. The fixture path that uses it (`agent-pipeline.test.ts`) is rewritten in §6.

## 6. Tests

Naming follows the existing `apps/api/tests/*.test.ts` Vitest convention (extension `.js` in import paths per memory entry "apps/api ESM import 컨벤션").

### 6.1 Unit

- `tests/lib/llm-gemini.test.ts` — mocks `@google/genai`. Verifies:
  - `embed` returns 768d, calls correct model + taskType.
  - `streamGenerate` yields deltas + final usage.
  - Throws `LLMNotConfiguredError` when key missing.
  - Forwards abort signal.
- `tests/lib/chat-retrieval.test.ts` — mocks `db.execute` and `getGeminiProvider`. Verifies:
  - `ragMode === "off"` → no embed call, returns `[]`.
  - `strict`/`expand` top_k routing.
  - chip union > scope precedence.
  - Memory chips are silently dropped.
  - Cross-workspace chips dropped.
  - Workspace scope fan-out cap honored.
- `tests/lib/chat-llm.test.ts` — injects fake `LLMProvider` + fake retrieval. Verifies:
  - status → citations → text → usage → done order.
  - History truncation under `CHAT_MAX_INPUT_TOKENS`.
  - Save-suggestion fence: parsed once, shape-validated, malformed JSON silently dropped (with one warn log).
  - `ragMode === "off"` skips system RAG block.
- `tests/lib/save-suggestion-fence.test.ts` — pure parser unit, edge cases (no fence, multiple fences, malformed JSON, oversized payload).

### 6.2 Integration (route-level)

Two **mocked-provider** SSE integration tests:

- `tests/routes/threads-real-llm.test.ts` — `POST /api/threads/:id/messages`, asserts SSE event order and that `chat_messages.token_usage` is non-null with the mocked numbers. Uses the existing `__setRunAgentForTest` seam to inject a fake `runAgent` that internally calls real `runChat()` with a fake provider.
- `tests/routes/chat-real-llm.test.ts` — `POST /api/chat/message`, asserts SSE `cost` event matches mocked usage and `conversations.total_*` rolled up correctly. No new seam is needed: the test uses `vi.mock("../../src/lib/llm/gemini")` to swap `getGeminiProvider()` module-wide (`runChat` reads it lazily inside the generator).

Rationale: the only existing seam (`__setRunAgentForTest` in `threads.ts`) is preserved for legacy E2E. Everywhere else, vitest module-mocking is the cleaner pattern — no production-export of a test setter, no NODE_ENV guard to maintain.

### 6.3 Smoke (manual, not CI)

- `pnpm dev` → open `/chat` → ingest a small note (2-3 paragraphs) → wait for embeddings (Phase 3b path or batch script) → ask a question whose answer is in the note → assert: streamed answer cites `[^1]` referencing the note, `cost` event reports non-zero tokens, `conversation_messages.tokens_out > 0`.
- Same on `/` (agent panel) via Phase 4 thread.

This is the user's promised acceptance check ("끝에 pnpm dev 띄워서 채팅 → 실제 RAG 답변 확인 후 ✅"). It does not run in CI.

### 6.4 What we explicitly do NOT test

- Live Gemini API. Tests mock the SDK module. Token-usage parity with reality is checked manually in §6.3.
- Per-token streaming timing. We assert event order, not throughput.

## 7. Performance & cost guardrails

- **Concurrent retrieval cap**: `chat-retrieval` runs at most `CHAT_RAG_MAX_PROJECTS` parallel project-level RRF queries via `Promise.all` slicing. No global semaphore in v1; if this becomes a hot path we can add one.
- **Embed call dedupe**: per-request only. Two messages in the same request body don't happen, but a second send replays the embed. Adding cache is a follow-up.
- **Model**: `gemini-2.5-flash` default. Operators can switch to `gemini-2.5-pro` via env. We do not auto-route by mode in v1 (model_router spec is on disk but unimplemented per memory).
- **Budget cap**: `streamGenerate` passes `maxOutputTokens=2048` default (overridable via env `CHAT_MAX_OUTPUT_TOKENS`). Prevents runaway responses from a misbehaving prompt.
- **Abort**: client disconnect → existing SSE close handler aborts the provider stream. No orphaned generation.

## 8. Migrations

**None required.** All needed columns exist:

- `chat_messages.token_usage jsonb` — already nullable, will be filled.
- `chat_messages.provider text` — already nullable, will be filled with `"gemini"`.
- `conversation_messages.tokens_in/tokens_out/cost_krw/citations` — all exist (Plan 11A migration 0030).
- `conversations.total_tokens_in/total_tokens_out/total_cost_krw` — exist.

If during implementation we discover a missing column (e.g. wanting to store the model name on `conversation_messages`), we add migration `0035_chat_real_llm.sql`. Plan starts assuming none.

## 9. Rollout

1. Land this PR onto `feat/plan-11b-phase-a` with `FEATURE_DOC_EDITOR_SLASH=false` unchanged. The chat path has **no feature flag** — it directly replaces the stubs. Rationale: there is no "real chat" today; flipping a flag would mean shipping the stubs *plus* a code path. Net code reduction is the goal.
- Risk: if Gemini is misconfigured, chat returns `503 llm_not_configured` instead of `(stub agent response to: ...)`. Acceptable — operators get a real signal instead of misleading echo. The previous behavior was actively hiding "no LLM is wired" from the user.

2. Update `docs/contributing/plans-status.md`: move audit's Tier 1 #1·#2·#3 from "open" to "closed in `<commit-sha>`".

3. Update `MEMORY.md` `project_completion_claims_audit.md` entry: append "Tier 1 #1·#2·#3 closed in <commit>" line.

4. After merge, manual `pnpm dev` smoke per §6.3. If smoke passes, the audit's headline ("0 user-facing paths invoke a real LLM") flips to "chat surfaces invoke real Gemini-2.5-flash with workspace-scoped RAG."

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `@google/genai` v1 API drift vs cached SDK docs | M | M | Use `references/Gemini_API_docs/` (already vendored) + `mcp__context7` for live verification before the SDK call shape lands. Pin SDK version in package.json. |
| pgvector index missing on chunks (older worktrees) | L | H | Verify with `\d note_chunks` during smoke. Migration is in main; this branch already has it. |
| Save-suggestion fence false positives (LLM emits fence in code samples) | L | L | Match only `^[\t ]*```save-suggestion\n` at start of line, and only the **last** matching fence in the response. Renderer already swallows unrecognized fences. |
| History bloat → token budget overflow → silent context truncation | M | M | `CHAT_MAX_INPUT_TOKENS` enforced before send; oldest turns dropped first. We log when truncation happens (`chat.history_truncated`). |
| Gemini abuse / cost spike | M | H | `maxOutputTokens` cap; per-request cost is bounded. Plan 9b billing (deferred) adds workspace-level rate limit. |
| Phase 4 chat with Workspace-wide RAG hammers DB on workspaces with 100+ projects | L | M | `CHAT_RAG_MAX_PROJECTS` cap. v2: pre-compute a workspace embedding view. |

## 11. Open questions

None blocking implementation. The following will be revisited if smoke surfaces issues:

- Should `mode: "fast"|"balanced"|"accurate"|"research"` from Phase 4 wire to model selection? v1 ignores the mode; a `mode_router` exists as an unimplemented spec. Defer.
- Should we surface `error_code = "rate_limited"` distinctly from `llm_failed` when Gemini 429s? Probably yes; v1 maps everything to `llm_failed` and we revisit after first 429 in dev.

## 12. Summary

One PR, no migrations, two new files (`llm/gemini.ts`, `chat-llm.ts`), one new file shared with retrieval (`chat-retrieval.ts`), one extracted file (`internal-hybrid-search.ts`), three modified files (`agent-pipeline.ts`, `chat.ts`, `threads.ts`), six new test files, two env vars added, one removed. Closes audit Tier 1 #1·#2·#3 in code, not just in plans-status.md.
