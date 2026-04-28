# Chat Real LLM Wiring (Audit Tier 1 #1·#2·#3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three production stubs (Phase 4 Agent Panel echo, Plan 11A `/api/chat/message` placeholder, Plan 2D env-gated fake save_suggestion producer) with a real Gemini-backed RAG chat path in `apps/api`. After this plan, `pnpm dev` → ask a workspace question → real grounded answer with provider-reported tokens.

**Architecture:** C1 hybrid — chat lives in `apps/api` (TS `@google/genai` SDK + Drizzle/pgvector retrieval). Worker keeps batch agents (doc-editor, deep-research, ingest, plan 8). Two new lib modules (`llm/gemini.ts`, `chat-retrieval.ts`, `chat-llm.ts`), one extracted (`internal-hybrid-search.ts`), three modified routes. No DB migration.

**Tech Stack:** Hono 4 SSE, Drizzle ORM + pgvector, `@google/genai` (new dep), Vitest module mocks, Plate v49 (renderer untouched).

**Spec:** `docs/superpowers/specs/2026-04-28-chat-real-llm-wiring-design.md`

**Dependencies:**
- ✅ Plan 11A — `conversations` / `conversation_messages` schema (`packages/db/src/schema/conversations.ts`).
- ✅ App Shell Phase 4 — `chat_threads` / `chat_messages` schema, SSE wire format (`apps/api/src/routes/threads.ts`).
- ✅ Plan 4 Phase B — `/internal/notes/hybrid-search` RRF endpoint (we extract its core into a shared lib).
- ✅ Plan 11B Phase A (this branch's preceding 16 tasks, HEAD `a44b810`) — proves the SSE+abort+audit pattern we mirror.

**Out of scope (not this PR):**
- Schema unification of `chat_threads` and `conversations`.
- Ollama support for the chat surface (TS path is Gemini-only).
- BYOK per-user keys.
- Worker-side `ResearchAgent` re-platforming.
- Long-context (<200k) vs hybrid mode router.
- Memory chip retrieval (`memory:l3*`/`memory:l4`/`memory:l2`) — chips persist but are silently ignored by retrieval.
- Per-step `citation` events streamed mid-generation (we emit them up-front before text).
- `mode: "fast"|"balanced"|"accurate"|"research"` → model routing.

---

## File Map

### apps/api
- **Modify** `package.json` — add `"@google/genai"` dependency.
- **Create** `src/lib/llm/gemini.ts` — `LLMProvider` interface + `getGeminiProvider()` + `LLMNotConfiguredError`.
- **Create** `src/lib/internal-hybrid-search.ts` — RRF function extracted from `routes/internal.ts` lines 539–678.
- **Modify** `src/routes/internal.ts` — `/notes/hybrid-search` route now calls the extracted lib.
- **Create** `src/lib/chat-retrieval.ts` — workspace/project/page scope + chip union + ragMode top_k routing.
- **Create** `src/lib/save-suggestion-fence.ts` — pure parser for the `\`\`\`save-suggestion` fenced JSON block.
- **Create** `src/lib/chat-llm.ts` — `runChat()` async generator: status → citations → streamed text → usage → done.
- **Modify** `src/lib/agent-pipeline.ts` — replace stub echo with `runChat()` call; remove env-gated save_suggestion fixture; persist real `token_usage`.
- **Modify** `src/routes/chat.ts` — replace `(11A placeholder reply)` SSE with `runChat()`; replace `Math.ceil(content.length/4)` with provider-reported usage; consume `attachedChips` + `ragMode` + `scopeType/scopeId` for retrieval.
- **Create** `tests/lib/llm-gemini.test.ts`
- **Create** `tests/lib/internal-hybrid-search.test.ts` (light, mostly the existing `/internal/notes/hybrid-search` route test continues to pass)
- **Create** `tests/lib/chat-retrieval.test.ts`
- **Create** `tests/lib/save-suggestion-fence.test.ts`
- **Create** `tests/lib/chat-llm.test.ts`
- **Create** `tests/routes/threads-real-llm.test.ts`
- **Create** `tests/routes/chat-real-llm.test.ts`
- **Modify** existing test fixtures that depended on stub echo strings (search and replace).

### Repo root
- **Modify** `.env.example` — add new `CHAT_*` vars; remove `AGENT_STUB_EMIT_SAVE_SUGGESTION` if present.

### docs
- **Modify** `docs/contributing/plans-status.md` — close audit Tier 1 #1·#2·#3 with this PR's commit.
- **Modify** `docs/architecture/api-contract.md` — annotate the two chat SSE rows as "real Gemini-backed" rather than "placeholder/stub".
- **Modify** `docs/contributing/llm-antipatterns.md` — record any `@google/genai` v1 stream-iteration footguns encountered (only if encountered; otherwise skip).

---

## Task 1: Add `@google/genai` dependency

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml` (auto)

- [ ] **Step 1: Verify the latest stable `@google/genai` version**

Run:

```bash
pnpm view @google/genai version
```

Expected: prints a 1.x version (as of plan writing, 1.0+ is GA). Note the exact version for the next step.

- [ ] **Step 2: Add the dependency to `apps/api/package.json`**

In `apps/api/package.json`, under `"dependencies"`, add:

```json
"@google/genai": "^1.0.0"
```

(Use the actual version from Step 1 if newer; pin to a major-version range.)

- [ ] **Step 3: Install**

Run from repo root:

```bash
pnpm install
```

Expected: lockfile updated; `apps/api/node_modules/@google/genai` exists. No type errors.

- [ ] **Step 4: Sanity import**

Open a Node REPL or quick smoke:

```bash
cd apps/api && node --input-type=module -e "import('@google/genai').then(m => console.log(Object.keys(m).filter(k => k.startsWith('Google')).join(',')))"
```

Expected: prints `GoogleGenAI` (or similar). Confirms ESM import path matches the SDK's main export.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add @google/genai dependency for chat LLM wiring

Sets up the Node-side Gemini SDK for the chat surface. The Python
packages/llm client stays as-is for the worker (ingest, doc-editor,
deep-research). See spec §2 for why we run two LLM clients.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `LLMProvider` interface + `LLMNotConfiguredError`

**Files:**
- Create: `apps/api/src/lib/llm/gemini.ts`
- Create: `apps/api/tests/lib/llm-gemini.test.ts`

- [ ] **Step 1: Write failing test — config error path**

Create `apps/api/tests/lib/llm-gemini.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getGeminiProvider,
  LLMNotConfiguredError,
} from "../../src/lib/llm/gemini.js";

describe("getGeminiProvider", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });
  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
    process.env.GOOGLE_API_KEY = originalGoogleKey;
    vi.restoreAllMocks();
  });

  it("throws LLMNotConfiguredError when no key is set", () => {
    expect(() => getGeminiProvider()).toThrowError(LLMNotConfiguredError);
  });

  it("falls back to GOOGLE_API_KEY when GEMINI_API_KEY missing", () => {
    process.env.GOOGLE_API_KEY = "AI" + "za-test-fallback";
    expect(() => getGeminiProvider()).not.toThrow();
  });

  it("LLMNotConfiguredError has code llm_not_configured", () => {
    try {
      getGeminiProvider();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMNotConfiguredError);
      expect((e as LLMNotConfiguredError).code).toBe("llm_not_configured");
    }
  });
});
```

(Note: `"AI" + "za-..."` concatenation per memory entry "Secret Scanner test fixture 회피".)

- [ ] **Step 2: Run test — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: `Cannot find module '../../src/lib/llm/gemini'`. The import target does not exist yet.

- [ ] **Step 3: Create `apps/api/src/lib/llm/gemini.ts` skeleton**

Create the file:

```ts
import { GoogleGenAI } from "@google/genai";

// ── Types ────────────────────────────────────────────────────────────────

export type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type Usage = {
  tokensIn: number;
  tokensOut: number;
  model: string;
};

export type StreamChunk = { delta: string } | { usage: Usage };

export interface LLMProvider {
  embed(text: string): Promise<number[]>;
  streamGenerate(opts: {
    messages: ChatMsg[];
    signal?: AbortSignal;
    maxOutputTokens?: number;
    temperature?: number;
  }): AsyncGenerator<StreamChunk>;
}

// ── Errors ───────────────────────────────────────────────────────────────

export class LLMNotConfiguredError extends Error {
  readonly code = "llm_not_configured";
  constructor(detail?: string) {
    super(
      `LLM not configured: ${detail ?? "GEMINI_API_KEY or GOOGLE_API_KEY env var missing"}`,
    );
    this.name = "LLMNotConfiguredError";
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

const CHAT_MODEL_DEFAULT = "gemini-2.5-flash";
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 768; // ADR-007

export function getGeminiProvider(): LLMProvider {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new LLMNotConfiguredError();

  const client = new GoogleGenAI({ apiKey });
  const chatModel = process.env.GEMINI_CHAT_MODEL ?? CHAT_MODEL_DEFAULT;

  return {
    async embed(text: string): Promise<number[]> {
      // Stub — implemented in Task 2.5
      throw new Error("not implemented yet");
    },
    async *streamGenerate(_opts) {
      // Stub — implemented in Task 2.6
      throw new Error("not implemented yet");
    },
  };
}
```

- [ ] **Step 4: Run test — expect pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: 3 passed. Config-error and key-fallback paths green; the stub `embed`/`streamGenerate` are not exercised yet.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/llm/gemini.ts apps/api/tests/lib/llm-gemini.test.ts
git commit -m "feat(api): LLMProvider interface + GeminiProvider factory + LLMNotConfiguredError

Sets up the surface for chat LLM calls. embed/streamGenerate are stubbed
and filled in by the next two tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.5: `embed()` implementation

**Files:**
- Modify: `apps/api/src/lib/llm/gemini.ts`
- Modify: `apps/api/tests/lib/llm-gemini.test.ts`

- [ ] **Step 1: Add failing test for `embed`**

Append to `apps/api/tests/lib/llm-gemini.test.ts`:

```ts
import type { GoogleGenAI } from "@google/genai";

vi.mock("@google/genai", () => {
  // Hoisted mock — vi.mock factories must be self-contained.
  const fakeEmbed = vi.fn();
  const fakeStream = vi.fn();
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        embedContent: fakeEmbed,
        generateContentStream: fakeStream,
      },
    })),
    __fakeEmbed: fakeEmbed,
    __fakeStream: fakeStream,
  };
});

describe("GeminiProvider.embed", () => {
  let fakeEmbed: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "AI" + "za-test-embed";
    const mod = (await import("@google/genai")) as unknown as {
      __fakeEmbed: ReturnType<typeof vi.fn>;
    };
    fakeEmbed = mod.__fakeEmbed;
    fakeEmbed.mockReset();
  });

  it("calls embedContent with gemini-embedding-001 + RETRIEVAL_QUERY + 768d", async () => {
    fakeEmbed.mockResolvedValue({
      embeddings: [{ values: new Array(768).fill(0.1) }],
    });
    const provider = getGeminiProvider();
    const out = await provider.embed("hello world");
    expect(out).toHaveLength(768);
    expect(fakeEmbed).toHaveBeenCalledWith({
      model: "gemini-embedding-001",
      contents: [{ parts: [{ text: "hello world" }] }],
      config: {
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
      },
    });
  });

  it("throws when SDK returns no embedding", async () => {
    fakeEmbed.mockResolvedValue({ embeddings: [] });
    const provider = getGeminiProvider();
    await expect(provider.embed("x")).rejects.toThrow(/embedding/i);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: 2 failures (`not implemented yet`).

- [ ] **Step 3: Implement `embed`**

In `apps/api/src/lib/llm/gemini.ts`, replace the `embed` stub:

```ts
    async embed(text: string): Promise<number[]> {
      const res = await client.models.embedContent({
        model: EMBED_MODEL,
        contents: [{ parts: [{ text }] }],
        config: {
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: EMBED_DIM,
        },
      });
      const values = res.embeddings?.[0]?.values;
      if (!values || values.length !== EMBED_DIM) {
        throw new Error(
          `Gemini returned no embedding (got ${values?.length ?? 0}d, expected ${EMBED_DIM}d)`,
        );
      }
      return values;
    },
```

- [ ] **Step 4: Run test — expect pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: all passing (5+ tests).

If the SDK shape differs (e.g. `embed_content` vs `embedContent`, `embedding` vs `embeddings`), use `mcp__context7` to fetch the current `@google/genai` Node SDK doc for `embedContent` and adjust both impl + test accordingly. Do NOT guess; the SDK has churned across versions.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/llm/gemini.ts apps/api/tests/lib/llm-gemini.test.ts
git commit -m "feat(api): GeminiProvider.embed using gemini-embedding-001 768d MRL

Per ADR-007 — taskType RETRIEVAL_QUERY for chat retrieval queries.
Document embeds stay on the worker side (Plan 3 / 3b).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.6: `streamGenerate()` implementation

**Files:**
- Modify: `apps/api/src/lib/llm/gemini.ts`
- Modify: `apps/api/tests/lib/llm-gemini.test.ts`

- [ ] **Step 1: Add failing test for `streamGenerate`**

Append to `apps/api/tests/lib/llm-gemini.test.ts`:

```ts
describe("GeminiProvider.streamGenerate", () => {
  let fakeStream: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "AI" + "za-test-stream";
    const mod = (await import("@google/genai")) as unknown as {
      __fakeStream: ReturnType<typeof vi.fn>;
    };
    fakeStream = mod.__fakeStream;
    fakeStream.mockReset();
  });

  it("yields delta chunks then a single usage chunk", async () => {
    async function* fakeChunks() {
      yield { text: "Hello" };
      yield { text: " world" };
      yield {
        text: "!",
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 5,
          totalTokenCount: 17,
        },
      };
    }
    fakeStream.mockReturnValue(fakeChunks());

    const provider = getGeminiProvider();
    const out: Array<{ delta: string } | { usage: Usage }> = [];
    for await (const chunk of provider.streamGenerate({
      messages: [{ role: "user", content: "hi" }],
    })) {
      out.push(chunk);
    }

    const deltas = out
      .filter((c): c is { delta: string } => "delta" in c)
      .map((c) => c.delta)
      .join("");
    expect(deltas).toBe("Hello world!");

    const usages = out.filter((c): c is { usage: Usage } => "usage" in c);
    expect(usages).toHaveLength(1);
    expect(usages[0].usage).toMatchObject({
      tokensIn: 12,
      tokensOut: 5,
    });
    expect(usages[0].usage.model).toMatch(/gemini-2\.5-flash/);
  });

  it("respects GEMINI_CHAT_MODEL env override", async () => {
    process.env.GEMINI_CHAT_MODEL = "gemini-2.5-pro";
    async function* one() {
      yield { text: "ok", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    }
    fakeStream.mockReturnValue(one());

    const provider = getGeminiProvider();
    const out: StreamChunk[] = [];
    for await (const c of provider.streamGenerate({ messages: [{ role: "user", content: "x" }] })) {
      out.push(c);
    }
    expect(fakeStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-pro" }),
    );
    delete process.env.GEMINI_CHAT_MODEL;
  });
});
```

(Adjust the `import type { Usage, StreamChunk }` line at the top of the test file to include the new types.)

- [ ] **Step 2: Run — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: 2 failures (`not implemented yet`).

- [ ] **Step 3: Implement `streamGenerate`**

In `apps/api/src/lib/llm/gemini.ts`, replace the stub:

```ts
    async *streamGenerate(opts) {
      const { messages, signal, maxOutputTokens, temperature } = opts;

      // Gemini chat is "single-turn with history" via `contents` array. We
      // collapse system messages into a leading system_instruction (the SDK
      // path) and map user/assistant to USER/MODEL roles.
      const systemMsgs = messages.filter((m) => m.role === "system");
      const turns = messages.filter((m) => m.role !== "system");
      const contents = turns.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const stream = await client.models.generateContentStream({
        model: chatModel,
        contents,
        config: {
          ...(systemMsgs.length > 0
            ? { systemInstruction: systemMsgs.map((m) => m.content).join("\n\n") }
            : {}),
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(signal ? { abortSignal: signal } : {}),
        },
      });

      let lastUsage: Usage | null = null;
      for await (const chunk of stream as AsyncIterable<{
        text?: string;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      }>) {
        if (signal?.aborted) return;
        if (chunk.text) yield { delta: chunk.text };
        if (chunk.usageMetadata) {
          lastUsage = {
            tokensIn: chunk.usageMetadata.promptTokenCount ?? 0,
            tokensOut: chunk.usageMetadata.candidatesTokenCount ?? 0,
            model: chatModel,
          };
        }
      }
      if (lastUsage) yield { usage: lastUsage };
    },
```

- [ ] **Step 4: Run — expect pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-gemini.test.ts
```

Expected: all passing.

If the SDK uses different field names (`response.text` vs `chunk.text`, `usage_metadata` vs `usageMetadata`, abort via `requestOptions.signal` vs `config.abortSignal`), consult `mcp__context7` for the current `@google/genai` reference and reconcile both impl and test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/llm/gemini.ts apps/api/tests/lib/llm-gemini.test.ts
git commit -m "feat(api): GeminiProvider.streamGenerate yields deltas then a single usage chunk

System messages collapse into systemInstruction; assistant→model role
mapping per Gemini's contents schema. usageMetadata on the final chunk
becomes the single {usage} the iterator yields after all deltas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract RRF hybrid-search core into a shared lib

**Files:**
- Create: `apps/api/src/lib/internal-hybrid-search.ts`
- Modify: `apps/api/src/routes/internal.ts` (lines 552–678)
- Create: `apps/api/tests/lib/internal-hybrid-search.test.ts`

- [ ] **Step 1: Confirm the existing route test still passes (baseline)**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/routes
```

Note any currently-passing test that exercises `/internal/notes/hybrid-search`. We want it green before *and* after the extraction.

- [ ] **Step 2: Create the extracted lib (TDD: paste, then test)**

Create `apps/api/src/lib/internal-hybrid-search.ts`:

```ts
import { db } from "@opencairn/db";
import { sql } from "drizzle-orm";

const RRF_K = 60;
const SNIPPET_MAX = 320;

export type HybridHit = {
  noteId: string;
  title: string;
  snippet: string;
  sourceType: string | null;
  sourceUrl: string | null;
  vectorScore: number | null;
  bm25Score: number | null;
  rrfScore: number;
};

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function clipSnippet(text: string | null): string {
  if (!text) return "";
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > SNIPPET_MAX
    ? compact.slice(0, SNIPPET_MAX) + "…"
    : compact;
}

export type HybridSearchOpts = {
  projectId: string;
  queryText: string;
  queryEmbedding: number[];
  k: number;
};

export async function projectHybridSearch(opts: HybridSearchOpts): Promise<HybridHit[]> {
  const { projectId, queryText, queryEmbedding, k } = opts;
  const vec = vectorLiteral(queryEmbedding);
  const fetchLimit = k * 2;

  const vectorRowsRaw = await db.execute(sql`
    SELECT
      id,
      title,
      content_text,
      source_type,
      source_url,
      1 - (embedding <=> ${vec}::vector) AS score
    FROM notes
    WHERE project_id = ${projectId}
      AND deleted_at IS NULL
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector ASC
    LIMIT ${fetchLimit}
  `);
  const vectorRows =
    (vectorRowsRaw as unknown as { rows: Array<Record<string, unknown>> })
      .rows ?? (vectorRowsRaw as unknown as Array<Record<string, unknown>>);

  const bm25RowsRaw = await db.execute(sql`
    SELECT
      id,
      title,
      content_text,
      source_type,
      source_url,
      ts_rank(content_tsv, plainto_tsquery('simple', ${queryText})) AS score
    FROM notes
    WHERE project_id = ${projectId}
      AND deleted_at IS NULL
      AND content_tsv @@ plainto_tsquery('simple', ${queryText})
    ORDER BY score DESC
    LIMIT ${fetchLimit}
  `);
  const bm25Rows =
    (bm25RowsRaw as unknown as { rows: Array<Record<string, unknown>> })
      .rows ?? (bm25RowsRaw as unknown as Array<Record<string, unknown>>);

  const hits = new Map<string, HybridHit>();
  const rrf = new Map<string, number>();

  const addRow = (
    row: Record<string, unknown>,
    rank: number,
    channel: "vector" | "bm25",
  ) => {
    const noteId = String(row.id);
    const existing = hits.get(noteId);
    const rawScore = Number(row.score ?? 0);
    if (!existing) {
      hits.set(noteId, {
        noteId,
        title: String(row.title ?? "Untitled"),
        snippet: clipSnippet(row.content_text as string | null),
        sourceType: (row.source_type as string | null) ?? null,
        sourceUrl: (row.source_url as string | null) ?? null,
        vectorScore: channel === "vector" ? rawScore : null,
        bm25Score: channel === "bm25" ? rawScore : null,
        rrfScore: 0,
      });
    } else if (channel === "vector") {
      existing.vectorScore = rawScore;
    } else {
      existing.bm25Score = rawScore;
    }
    rrf.set(noteId, (rrf.get(noteId) ?? 0) + 1 / (RRF_K + rank));
  };

  vectorRows.forEach((r, i) => addRow(r, i + 1, "vector"));
  bm25Rows.forEach((r, i) => addRow(r, i + 1, "bm25"));

  for (const [noteId, score] of rrf.entries()) {
    const hit = hits.get(noteId);
    if (hit) hit.rrfScore = score;
  }

  return Array.from(hits.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, k);
}
```

- [ ] **Step 3: Update `routes/internal.ts` to use the lib**

In `apps/api/src/routes/internal.ts`:

1. At the top of the file, add:

```ts
import { projectHybridSearch } from "../lib/internal-hybrid-search";
```

2. Delete the `RRF_K` constant, `SNIPPET_MAX` constant, `HybridHit` type, `clipSnippet` helper, and the inline body of the `/notes/hybrid-search` POST handler. Keep `vectorLiteral` only if still used elsewhere in the file (grep — if only used by `/notes/hybrid-search`, delete it too; if used by another internal route, leave as-is).

3. Replace the `/notes/hybrid-search` handler body with:

```ts
internal.post(
  "/notes/hybrid-search",
  zValidator("json", hybridSearchSchema),
  async (c) => {
    const body = c.req.valid("json");
    const results = await projectHybridSearch({
      projectId: body.projectId,
      queryText: body.queryText,
      queryEmbedding: body.queryEmbedding,
      k: body.k,
    });
    return c.json({ results });
  },
);
```

- [ ] **Step 4: Run all api tests**

Run:

```bash
pnpm --filter @opencairn/api test
```

Expected: all previously-passing tests still pass. The `/internal/notes/hybrid-search` route test exercises the new lib transitively.

- [ ] **Step 5: (Optional) Add a thin direct-lib test**

If no existing test exercises `projectHybridSearch` directly, create `apps/api/tests/lib/internal-hybrid-search.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  const execute = vi.fn();
  return { ...real, db: { execute } };
});

const { projectHybridSearch } = await import(
  "../../src/lib/internal-hybrid-search.js"
);
const { db } = (await import("@opencairn/db")) as unknown as {
  db: { execute: ReturnType<typeof vi.fn> };
};

describe("projectHybridSearch RRF", () => {
  beforeEach(() => db.execute.mockReset());

  it("merges vector + bm25 channels and orders by RRF score", async () => {
    db.execute
      .mockResolvedValueOnce({
        rows: [
          { id: "n1", title: "alpha", content_text: "vec only", source_type: "pdf", source_url: null, score: 0.91 },
          { id: "n2", title: "beta", content_text: "vec+bm25", source_type: "pdf", source_url: null, score: 0.85 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "n2", title: "beta", content_text: "vec+bm25", source_type: "pdf", source_url: null, score: 0.7 },
          { id: "n3", title: "gamma", content_text: "bm25 only", source_type: "pdf", source_url: null, score: 0.6 },
        ],
      });

    const out = await projectHybridSearch({
      projectId: "00000000-0000-0000-0000-000000000001",
      queryText: "alpha beta",
      queryEmbedding: new Array(768).fill(0),
      k: 3,
    });

    expect(out.map((h) => h.noteId)).toEqual(["n2", "n1", "n3"]);
    // n2 hit on both channels → highest RRF
  });

  it("k=1 returns one row", async () => {
    db.execute.mockResolvedValue({ rows: [] });
    const out = await projectHybridSearch({
      projectId: "00000000-0000-0000-0000-000000000001",
      queryText: "x",
      queryEmbedding: new Array(768).fill(0),
      k: 1,
    });
    expect(out).toHaveLength(0);
  });
});
```

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/internal-hybrid-search.test.ts
```

Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/internal-hybrid-search.ts apps/api/src/routes/internal.ts apps/api/tests/lib/internal-hybrid-search.test.ts
git commit -m "refactor(api): extract projectHybridSearch from internal route

The same RRF function is needed by chat-retrieval (Task 4). Extracting
into a shared lib so chat-retrieval doesn't HTTP round-trip its own
process. Existing /internal/notes/hybrid-search route now thinly wraps
the function; behavior unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `chat-retrieval.ts` — workspace/project/page scope + chip union

**Files:**
- Create: `apps/api/src/lib/chat-retrieval.ts`
- Create: `apps/api/tests/lib/chat-retrieval.test.ts`

- [ ] **Step 1: Write failing tests — types + ragMode=off**

Create `apps/api/tests/lib/chat-retrieval.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/llm/gemini", () => ({
  getGeminiProvider: vi.fn(),
}));
vi.mock("../../src/lib/internal-hybrid-search", () => ({
  projectHybridSearch: vi.fn(),
}));

const { retrieve } = await import("../../src/lib/chat-retrieval.js");
const llm = (await import("../../src/lib/llm/gemini.js")) as unknown as {
  getGeminiProvider: ReturnType<typeof vi.fn>;
};
const search = (await import("../../src/lib/internal-hybrid-search.js")) as unknown as {
  projectHybridSearch: ReturnType<typeof vi.fn>;
};

const fakeProvider = {
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  streamGenerate: vi.fn(),
};

beforeEach(() => {
  llm.getGeminiProvider.mockReturnValue(fakeProvider);
  fakeProvider.embed.mockClear();
  search.projectHybridSearch.mockReset();
});

describe("chat-retrieval ragMode", () => {
  it("ragMode=off returns [] without calling embed or search", async () => {
    const hits = await retrieve({
      workspaceId: "ws-1",
      query: "anything",
      ragMode: "off",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [],
    });
    expect(hits).toEqual([]);
    expect(fakeProvider.embed).not.toHaveBeenCalled();
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });

  it("ragMode=strict uses CHAT_RAG_TOP_K_STRICT (default 5)", async () => {
    delete process.env.CHAT_RAG_TOP_K_STRICT;
    search.projectHybridSearch.mockResolvedValue([]);
    await retrieve({
      workspaceId: "ws-1",
      query: "x",
      ragMode: "strict",
      scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
      chips: [],
    });
    expect(search.projectHybridSearch).toHaveBeenCalledWith(
      expect.objectContaining({ k: 5 }),
    );
  });

  it("ragMode=expand uses CHAT_RAG_TOP_K_EXPAND (default 12)", async () => {
    delete process.env.CHAT_RAG_TOP_K_EXPAND;
    search.projectHybridSearch.mockResolvedValue([]);
    await retrieve({
      workspaceId: "ws-1",
      query: "x",
      ragMode: "expand",
      scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
      chips: [],
    });
    expect(search.projectHybridSearch).toHaveBeenCalledWith(
      expect.objectContaining({ k: 12 }),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-retrieval.test.ts
```

Expected: `Cannot find module .../src/lib/chat-retrieval`.

- [ ] **Step 3: Create `apps/api/src/lib/chat-retrieval.ts` with the ragMode core**

```ts
import { db } from "@opencairn/db";
import { sql } from "drizzle-orm";
import { getGeminiProvider } from "./llm/gemini";
import { projectHybridSearch, type HybridHit } from "./internal-hybrid-search";

// ── Types ────────────────────────────────────────────────────────────────

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
};

// ── Top-k routing ────────────────────────────────────────────────────────

function topK(mode: RagMode): number {
  if (mode === "off") return 0;
  if (mode === "strict") return Number(process.env.CHAT_RAG_TOP_K_STRICT ?? 5);
  return Number(process.env.CHAT_RAG_TOP_K_EXPAND ?? 12);
}

function maxProjects(): number {
  return Number(process.env.CHAT_RAG_MAX_PROJECTS ?? 64);
}

// ── Public surface ───────────────────────────────────────────────────────

export async function retrieve(opts: {
  workspaceId: string;
  query: string;
  ragMode: RagMode;
  scope: RetrievalScope;
  chips: RetrievalChip[];
  signal?: AbortSignal;
}): Promise<RetrievalHit[]> {
  const k = topK(opts.ragMode);
  if (k === 0) return [];

  const provider = getGeminiProvider();
  const queryEmbedding = await provider.embed(opts.query);

  const projectIds = await resolveProjectIds(opts);
  if (projectIds.length === 0) return [];

  const fanout = projectIds.slice(0, maxProjects());
  const perProjectK = Math.max(k, 5);

  const projectHits = await Promise.all(
    fanout.map((projectId) =>
      projectHybridSearch({
        projectId,
        queryText: opts.query,
        queryEmbedding,
        k: perProjectK,
      }).catch(() => [] as HybridHit[]),
    ),
  );

  // Re-merge: union by noteId, sum RRF scores, sort, slice. If a noteId
  // appears in multiple projects (it can't — note↔project is 1:1) we still
  // keep the first occurrence.
  const merged = new Map<string, HybridHit>();
  for (const hits of projectHits) {
    for (const h of hits) {
      if (!merged.has(h.noteId)) merged.set(h.noteId, h);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, k)
    .map((h) => ({
      noteId: h.noteId,
      title: h.title,
      snippet: h.snippet,
      score: h.rrfScore,
    }));
}

// ── Scope/chip resolution ────────────────────────────────────────────────

async function resolveProjectIds(opts: {
  workspaceId: string;
  scope: RetrievalScope;
  chips: RetrievalChip[];
}): Promise<string[]> {
  // Memory chips are silently ignored at retrieval (Plan 11B Phase B/C
  // owns the memory store). Filter them at call sites; here we accept
  // only page/project/workspace chips by type.
  if (opts.chips.length > 0) {
    const ids = new Set<string>();
    for (const chip of opts.chips) {
      if (chip.type === "project") {
        if (await projectInWorkspace(chip.id, opts.workspaceId)) {
          ids.add(chip.id);
        }
      } else if (chip.type === "page") {
        const projectId = await projectIdForNote(chip.id, opts.workspaceId);
        if (projectId) ids.add(projectId);
      } else if (chip.type === "workspace") {
        if (chip.id === opts.workspaceId) {
          for (const p of await allProjectsInWorkspace(opts.workspaceId)) {
            ids.add(p);
          }
        }
      }
    }
    return Array.from(ids);
  }

  if (opts.scope.type === "project") return [opts.scope.projectId];
  if (opts.scope.type === "page") {
    const p = await projectIdForNote(opts.scope.noteId, opts.workspaceId);
    return p ? [p] : [];
  }
  return allProjectsInWorkspace(opts.workspaceId);
}

async function projectInWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const rowsRaw = await db.execute(sql`
    SELECT 1 FROM projects
    WHERE id = ${projectId} AND workspace_id = ${workspaceId}
    LIMIT 1
  `);
  const rows =
    (rowsRaw as unknown as { rows: unknown[] }).rows ??
    (rowsRaw as unknown as unknown[]);
  return rows.length > 0;
}

async function projectIdForNote(
  noteId: string,
  workspaceId: string,
): Promise<string | null> {
  const rowsRaw = await db.execute(sql`
    SELECT n.project_id AS pid
    FROM notes n
    JOIN projects p ON p.id = n.project_id
    WHERE n.id = ${noteId} AND p.workspace_id = ${workspaceId} AND n.deleted_at IS NULL
    LIMIT 1
  `);
  const rows =
    ((rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (rowsRaw as unknown as Array<Record<string, unknown>>)) as Array<{
      pid: string;
    }>;
  return rows[0]?.pid ?? null;
}

async function allProjectsInWorkspace(workspaceId: string): Promise<string[]> {
  const rowsRaw = await db.execute(sql`
    SELECT id FROM projects
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `);
  const rows =
    ((rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (rowsRaw as unknown as Array<Record<string, unknown>>)) as Array<{
      id: string;
    }>;
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run — expect Step 1 tests pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-retrieval.test.ts
```

Expected: 3 passing (the 3 ragMode tests). Note: the strict/expand tests need `db.execute` to be mocked because the resolver calls it. Adjust the mock at the top of the test file to also stub `@opencairn/db`'s `db.execute` (returning empty arrays), so the resolver returns `[]` and `projectHybridSearch` is called with the right `k`. Update Step 1 test to do this if it's failing for the wrong reason.

If the strict/expand tests fail because `projectHybridSearch` was never called (because `resolveProjectIds` returned `[]`), reorder the test to use `scope: { type: "project", ...}` — the project scope path has no DB lookup, so `projectHybridSearch` is reached directly without a DB mock.

(The Step 1 test already uses `scope: { type: "project", ... }` for strict/expand, which avoids the resolver DB call. Confirm this.)

- [ ] **Step 5: Add chip union + cross-workspace tests**

Append to `apps/api/tests/lib/chat-retrieval.test.ts`:

```ts
vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  return { ...real, db: { execute: vi.fn() } };
});

describe("chat-retrieval chip union", () => {
  let dbMod: { db: { execute: ReturnType<typeof vi.fn> } };
  beforeEach(async () => {
    dbMod = (await import("@opencairn/db")) as unknown as typeof dbMod;
    dbMod.db.execute.mockReset();
    search.projectHybridSearch.mockReset();
    search.projectHybridSearch.mockResolvedValue([]);
  });

  it("project chip in same workspace is included", async () => {
    dbMod.db.execute.mockResolvedValue({ rows: [{}] }); // projectInWorkspace → true
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [{ type: "project", id: "p-allowed" }],
    });
    expect(search.projectHybridSearch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p-allowed" }),
    );
  });

  it("project chip in different workspace is silently dropped", async () => {
    dbMod.db.execute.mockResolvedValue({ rows: [] }); // projectInWorkspace → false
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [{ type: "project", id: "p-other-ws" }],
    });
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });

  it("when chips are non-empty, conversation scope is ignored", async () => {
    dbMod.db.execute.mockResolvedValue({ rows: [{}] });
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "project", workspaceId: "ws-1", projectId: "p-conv" },
      chips: [{ type: "project", id: "p-chip" }],
    });
    const calls = search.projectHybridSearch.mock.calls.map(
      (c) => (c[0] as { projectId: string }).projectId,
    );
    expect(calls).toEqual(["p-chip"]);
  });
});
```

- [ ] **Step 6: Run — expect all chat-retrieval tests pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-retrieval.test.ts
```

Expected: 6 passing. Fix any drift.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/chat-retrieval.ts apps/api/tests/lib/chat-retrieval.test.ts
git commit -m "feat(api): chat-retrieval — workspace/project/page scope + chip union + ragMode top_k

ragMode=off short-circuits without embed. strict/expand drive top_k via
env. Chip union (project/page/workspace types) takes precedence over
conversation scope. Cross-workspace chips are silently dropped (defense
in depth — chip writes already enforce boundary). Memory chips are not
read here; Plan 11B Phase B/C owns the memory store.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Save-suggestion fence parser

**Files:**
- Create: `apps/api/src/lib/save-suggestion-fence.ts`
- Create: `apps/api/tests/lib/save-suggestion-fence.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/lib/save-suggestion-fence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractSaveSuggestion } from "../../src/lib/save-suggestion-fence.js";

describe("extractSaveSuggestion", () => {
  it("returns null when no fence", () => {
    expect(extractSaveSuggestion("just a normal answer")).toBeNull();
  });

  it("parses a single fence", () => {
    const text = [
      "Here's the answer.",
      "",
      "```save-suggestion",
      `{"title": "Pivot table notes", "body_markdown": "# Notes\\n\\n- bullet"}`,
      "```",
      "",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toEqual({
      title: "Pivot table notes",
      body_markdown: "# Notes\n\n- bullet",
    });
  });

  it("returns the LAST fence when multiple appear", () => {
    const text = [
      "```save-suggestion",
      `{"title": "first", "body_markdown": "f"}`,
      "```",
      "```save-suggestion",
      `{"title": "second", "body_markdown": "s"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)?.title).toBe("second");
  });

  it("returns null on malformed JSON", () => {
    const text = [
      "```save-suggestion",
      `{"title": "broken", body_markdown:}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });

  it("returns null when shape is invalid (missing body_markdown)", () => {
    const text = [
      "```save-suggestion",
      `{"title": "no body"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });

  it("returns null when title or body is empty", () => {
    const text = [
      "```save-suggestion",
      `{"title": "", "body_markdown": "hi"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });

  it("returns null when payload exceeds 16KB", () => {
    const big = "a".repeat(20_000);
    const text = [
      "```save-suggestion",
      `{"title": "big", "body_markdown": "${big}"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/save-suggestion-fence.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create the parser**

Create `apps/api/src/lib/save-suggestion-fence.ts`:

```ts
const FENCE_RE = /^[\t ]*```save-suggestion\s*\n([\s\S]*?)\n[\t ]*```\s*$/gm;
const MAX_PAYLOAD_BYTES = 16 * 1024;

export type SaveSuggestion = {
  title: string;
  body_markdown: string;
};

// Returns the LAST recognized save-suggestion fence parsed from `text`,
// or null if none is well-formed. We intentionally return only the last
// match — the system prompt asks for at most one fence; multiple fences
// usually mean the LLM repeated itself, and the latest is most likely
// the intended one.
export function extractSaveSuggestion(text: string): SaveSuggestion | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  // Reset lastIndex because the regex carries state across calls.
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    last = match[1];
  }
  if (last === null) return null;

  const trimmed = last.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PAYLOAD_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const title = obj.title;
  const body = obj.body_markdown;
  if (
    typeof title !== "string" ||
    typeof body !== "string" ||
    title.trim().length === 0 ||
    body.trim().length === 0 ||
    title.length > 512 ||
    body.length > MAX_PAYLOAD_BYTES
  ) {
    return null;
  }
  return { title, body_markdown: body };
}
```

- [ ] **Step 4: Run — expect pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/save-suggestion-fence.test.ts
```

Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/save-suggestion-fence.ts apps/api/tests/lib/save-suggestion-fence.test.ts
git commit -m "feat(api): save-suggestion fence parser — replaces env-gated stub trigger

Pure function, parses the LAST \`\`\`save-suggestion fenced JSON block in
the assembled response. Drops the env stub path; the LLM emits the
fence when its system prompt prompts it to.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `chat-llm.ts` — `runChat()` async generator

**Files:**
- Create: `apps/api/src/lib/chat-llm.ts`
- Create: `apps/api/tests/lib/chat-llm.test.ts`

- [ ] **Step 1: Write failing happy-path test**

Create `apps/api/tests/lib/chat-llm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/chat-retrieval", () => ({
  retrieve: vi.fn(),
}));

const { runChat } = await import("../../src/lib/chat-llm.js");
const retrievalMod = (await import("../../src/lib/chat-retrieval.js")) as unknown as {
  retrieve: ReturnType<typeof vi.fn>;
};

const fakeProvider = {
  embed: vi.fn(),
  streamGenerate: vi.fn(),
};

beforeEach(() => {
  retrievalMod.retrieve.mockReset();
  fakeProvider.embed.mockReset();
  fakeProvider.streamGenerate.mockReset();
});

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("runChat happy path", () => {
  it("emits status → citation → text → usage → done in order", async () => {
    retrievalMod.retrieve.mockResolvedValue([
      { noteId: "n1", title: "alpha", snippet: "first hit", score: 0.9 },
    ]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "Hello" };
      yield { delta: " world" };
      yield { usage: { tokensIn: 30, tokensOut: 7, model: "gemini-2.5-flash" } };
    });

    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("status");
    expect(types).toContain("citation");
    const texts = events.filter((e) => e.type === "text");
    expect(texts.map((e) => (e.payload as { delta: string }).delta).join("")).toBe(
      "Hello world",
    );
    const usage = events.find((e) => e.type === "usage");
    expect(usage?.payload).toMatchObject({ tokensIn: 30, tokensOut: 7 });
    expect(types[types.length - 1]).toBe("done");
  });

  it("ragMode=off skips retrieval and emits zero citations", async () => {
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "ok" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" } };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    expect(events.find((e) => e.type === "citation")).toBeUndefined();
    expect(retrievalMod.retrieve).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/api/src/lib/chat-llm.ts`**

```ts
import type { Citation } from "@opencairn/db";
import { retrieve, type RagMode, type RetrievalScope, type RetrievalChip } from "./chat-retrieval";
import { extractSaveSuggestion } from "./save-suggestion-fence";
import {
  getGeminiProvider,
  type ChatMsg,
  type LLMProvider,
  type Usage,
} from "./llm/gemini";

export type ChatChunk =
  | { type: "status"; payload: { phrase: string } }
  | { type: "thought"; payload: { summary: string } }
  | { type: "text"; payload: { delta: string } }
  | { type: "citation"; payload: Citation }
  | {
      type: "save_suggestion";
      payload: { title: string; body_markdown: string };
    }
  | { type: "usage"; payload: Usage }
  | { type: "done"; payload: Record<string, never> };

const SYSTEM_PROMPT = [
  "You are OpenCairn, a knowledge assistant grounded in the user's workspace.",
  "When you cite the workspace, use [^N] markers matching the order of the provided context items.",
  "Never invent citations. If the context does not contain the answer, say so plainly.",
  "Reply in the same language as the user's question (Korean if Korean, English if English).",
  "",
  "If the user's question contains a self-contained insight worth saving as a separate note,",
  "you MAY append exactly one fenced block at the very end of your reply, in this exact form:",
  "",
  "```save-suggestion",
  `{"title": "<≤80 char title>", "body_markdown": "<markdown body>"}`,
  "```",
  "",
  "Skip the block when in doubt. The body must be valid JSON on a single physical block.",
].join("\n");

export async function* runChat(opts: {
  workspaceId: string;
  scope: RetrievalScope;
  ragMode: RagMode;
  chips: RetrievalChip[];
  history: ChatMsg[];
  userMessage: string;
  signal?: AbortSignal;
  provider?: LLMProvider;
}): AsyncGenerator<ChatChunk> {
  const provider = opts.provider ?? getGeminiProvider();

  yield { type: "status", payload: { phrase: "관련 문서 훑는 중..." } };

  const hits =
    opts.ragMode === "off"
      ? []
      : await retrieve({
          workspaceId: opts.workspaceId,
          query: opts.userMessage,
          ragMode: opts.ragMode,
          scope: opts.scope,
          chips: opts.chips,
          signal: opts.signal,
        });

  // Emit citations up-front. The renderer reconciles [^N] markers in the
  // generated text against this ordered list.
  const citations: Citation[] = hits.map((h) => ({
    source_type: "note",
    source_id: h.noteId,
    snippet: h.snippet,
  }));
  for (const c of citations) yield { type: "citation", payload: c };

  // Build the prompt. RAG context block lives in the system message so it
  // doesn't burn through the user-history truncation budget below.
  const ragBlock =
    hits.length === 0
      ? ""
      : "\n\n<context>\n" +
        hits
          .map((h, i) => `[${i + 1}] ${h.title}\n${h.snippet}`)
          .join("\n\n") +
        "\n</context>";
  const system: ChatMsg = {
    role: "system",
    content: SYSTEM_PROMPT + ragBlock,
  };

  const history = truncateHistory(opts.history);
  const messages: ChatMsg[] = [
    system,
    ...history,
    { role: "user", content: opts.userMessage },
  ];

  yield {
    type: "thought",
    payload: { summary: "사용자의 질문 분석 중" },
  };

  const buffer: string[] = [];
  let usage: Usage | null = null;
  for await (const chunk of provider.streamGenerate({
    messages,
    signal: opts.signal,
    maxOutputTokens: Number(process.env.CHAT_MAX_OUTPUT_TOKENS ?? 2048),
  })) {
    if ("delta" in chunk) {
      buffer.push(chunk.delta);
      yield { type: "text", payload: { delta: chunk.delta } };
    } else if ("usage" in chunk) {
      usage = chunk.usage;
    }
  }

  // Save-suggestion fence is parsed once at the end (system prompt asks
  // for at most one). The fence text was already yielded as part of the
  // text deltas; the renderer strips unrecognized fences itself.
  const full = buffer.join("");
  const suggestion = extractSaveSuggestion(full);
  if (suggestion) {
    yield { type: "save_suggestion", payload: suggestion };
  }

  if (usage) yield { type: "usage", payload: usage };
  yield { type: "done", payload: {} };
}

// Drop oldest user/assistant turns until the rough character budget for
// history fits under CHAT_MAX_INPUT_TOKENS. Crude but bounded — billing
// uses the provider-reported usage, not this estimate.
function truncateHistory(history: ChatMsg[]): ChatMsg[] {
  const maxTurns = Number(process.env.CHAT_MAX_HISTORY_TURNS ?? 12);
  const maxTokens = Number(process.env.CHAT_MAX_INPUT_TOKENS ?? 32000);
  let kept = history.slice(-maxTurns);

  const estimate = (msgs: ChatMsg[]) =>
    Math.ceil(msgs.reduce((n, m) => n + m.content.length, 0) / 3.5);

  while (kept.length > 0 && estimate(kept) > maxTokens) {
    kept = kept.slice(1);
  }
  return kept;
}
```

- [ ] **Step 4: Run — expect Step 1 tests pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Add save-suggestion + history truncation tests**

Append to `apps/api/tests/lib/chat-llm.test.ts`:

```ts
describe("runChat save_suggestion", () => {
  it("emits save_suggestion when LLM appends a fence", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "Here is the answer.\n\n```save-suggestion\n" };
      yield { delta: '{"title": "Test", "body_markdown": "Body"}\n```\n' };
      yield { usage: { tokensIn: 5, tokensOut: 3, model: "gemini-2.5-flash" } };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    const sugg = events.find((e) => e.type === "save_suggestion");
    expect(sugg?.payload).toEqual({ title: "Test", body_markdown: "Body" });
  });

  it("does NOT emit save_suggestion on malformed fence", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "```save-suggestion\n{not json}\n```" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" } };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    expect(events.find((e) => e.type === "save_suggestion")).toBeUndefined();
  });
});

describe("runChat history truncation", () => {
  it("drops oldest turns when over CHAT_MAX_INPUT_TOKENS", async () => {
    process.env.CHAT_MAX_INPUT_TOKENS = "100";
    process.env.CHAT_MAX_HISTORY_TURNS = "100";
    retrievalMod.retrieve.mockResolvedValue([]);
    let receivedMessages: unknown[] = [];
    fakeProvider.streamGenerate.mockImplementation(async function* (opts: {
      messages: unknown[];
    }) {
      receivedMessages = opts.messages;
      yield { delta: "ok" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" } };
    });

    const big = "x".repeat(500);
    const history = [
      { role: "user" as const, content: big },
      { role: "assistant" as const, content: big },
      { role: "user" as const, content: "recent" },
    ];

    await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history,
        userMessage: "now",
        provider: fakeProvider,
      }),
    );
    const userTexts = (receivedMessages as { role: string; content: string }[])
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userTexts).toContain("now");
    expect(userTexts.some((t) => t === big)).toBe(false);

    delete process.env.CHAT_MAX_INPUT_TOKENS;
    delete process.env.CHAT_MAX_HISTORY_TURNS;
  });
});
```

- [ ] **Step 6: Run — expect all chat-llm tests pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: 5 passing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/chat-llm.ts apps/api/tests/lib/chat-llm.test.ts
git commit -m "feat(api): chat-llm runChat — status → citations → text → usage → done

Async generator orchestrating retrieval + Gemini stream + save-suggestion
fence parsing. Provider is injectable for tests; defaults to
getGeminiProvider(). System prompt instructs the model on citation
markers and the optional save-suggestion fence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire `agent-pipeline.ts:runAgent` to `runChat()` (Phase 4)

**Files:**
- Modify: `apps/api/src/lib/agent-pipeline.ts`
- Create: `apps/api/tests/routes/threads-real-llm.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `apps/api/tests/routes/threads-real-llm.test.ts`. The exact harness depends on the conventions used in `apps/api/tests/routes/`; mirror the closest existing pattern (likely `agent-panel.spec.ts` or a `threads.test.ts`). The test asserts:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __setRunAgentForTest } from "../../src/routes/threads.js";
import { runChat } from "../../src/lib/chat-llm.js";
// ... existing test fixtures (createThread, signSessionForUser, etc.)

const fakeProvider = {
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  streamGenerate: vi.fn(),
};

beforeEach(() => {
  // Inject runChat with an injected fake provider.
  __setRunAgentForTest(async function* (opts) {
    // Build a workspace scope from threadId → use existing thread→workspace mapping.
    const workspaceId = await getWorkspaceIdForThread(opts.threadId);
    yield* runChat({
      workspaceId,
      scope: { type: "workspace", workspaceId },
      ragMode: "strict",
      chips: [],
      history: [],
      userMessage: opts.userMessage.content,
      provider: fakeProvider,
    });
  });
});

afterEach(() => __setRunAgentForTest(null));

describe("POST /api/threads/:id/messages — real LLM path", () => {
  it("emits text deltas and persists token_usage", async () => {
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "real" };
      yield { delta: " answer" };
      yield { usage: { tokensIn: 22, tokensOut: 6, model: "gemini-2.5-flash" } };
    });
    // ... POST + collect SSE
    // Assert:
    //  - SSE includes text events with "real" and " answer"
    //  - chat_messages row for the agent has token_usage = {tokensIn:22, tokensOut:6, model, costKrw:>=0}
    //  - chat_messages.provider = "gemini"
    //  - status row is "complete"
  });
});
```

(Fill in the exact harness using the patterns already present in the test directory. Helpers such as `getWorkspaceIdForThread` either exist in test-seed-multi.ts or need a 3-line db lookup; do the lookup inline rather than introducing a new helper.)

- [ ] **Step 2: Run — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/routes/threads-real-llm.test.ts
```

Expected: failure on assertions about `token_usage` content (current `runAgent` sets nothing in that field).

- [ ] **Step 3: Replace `agent-pipeline.ts`**

Open `apps/api/src/lib/agent-pipeline.ts`. Replace the entire file with:

```ts
import { db, chatMessages, chatThreads, eq } from "@opencairn/db";
import { runChat, type ChatChunk } from "./chat-llm";
import { tokensToKrw } from "./cost";

export type AgentChunkType =
  | "status"
  | "thought"
  | "text"
  | "citation"
  | "save_suggestion"
  | "usage"
  | "done";

export interface AgentChunk {
  type: AgentChunkType;
  payload: unknown;
}

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";

// Phase 4 chat surface today has no per-thread chip/ragMode column. Defaults
// — workspace scope, strict RAG, empty chips — match the agent panel's
// "ask anything in the workspace" UX. When/if the agent panel grows scope
// chips, it'll either migrate to the conversations table or carry chip
// state on chat_threads via a follow-up migration.
export async function* runAgent(opts: {
  threadId: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
}): AsyncGenerator<AgentChunk> {
  const [thread] = await db
    .select({ workspaceId: chatThreads.workspaceId })
    .from(chatThreads)
    .where(eq(chatThreads.id, opts.threadId));
  if (!thread) {
    throw new Error(`thread not found: ${opts.threadId}`);
  }
  const workspaceId = thread.workspaceId;

  for await (const chunk of runChat({
    workspaceId,
    scope: { type: "workspace", workspaceId },
    ragMode: "strict",
    chips: [],
    history: [], // Phase 4 history reload is out of scope for v1; UI shows
                 //   prior turns from chatMessages on its own. Multi-turn
                 //   reasoning over older turns is a follow-up.
    userMessage: opts.userMessage.content,
  })) {
    yield mapChunk(chunk);
  }
}

function mapChunk(c: ChatChunk): AgentChunk {
  return { type: c.type, payload: c.payload };
}

export async function createStreamingAgentMessage(
  threadId: string,
  mode: ChatMode,
) {
  const [row] = await db
    .insert(chatMessages)
    .values({
      threadId,
      role: "agent",
      status: "streaming",
      content: { body: "" },
      mode,
      provider: "gemini",
    })
    .returning({ id: chatMessages.id });
  return row;
}

export async function finalizeAgentMessage(
  messageId: string,
  content: object,
  status: "complete" | "failed",
) {
  // The route already accumulates `content` from streamed chunks. We add
  // token_usage as a sidecar field so callers don't have to know about
  // its column shape — finalize unwraps it from the content object if
  // present.
  const c = content as Record<string, unknown> & {
    usage?: { tokensIn: number; tokensOut: number; model: string };
  };
  const tokenUsage = c.usage
    ? {
        tokensIn: c.usage.tokensIn,
        tokensOut: c.usage.tokensOut,
        model: c.usage.model,
        costKrw: Number(tokensToKrw(c.usage.tokensIn, c.usage.tokensOut)),
      }
    : null;
  // Remove `usage` from content before persist — it lives in token_usage.
  const { usage: _drop, ...persistedContent } = c;

  const [row] = await db
    .update(chatMessages)
    .set({
      content: persistedContent,
      status,
      ...(tokenUsage ? { tokenUsage } : {}),
    })
    .where(eq(chatMessages.id, messageId))
    .returning();
  return row;
}
```

- [ ] **Step 4: Update `threads.ts` to forward `usage` into the content object**

In `apps/api/src/routes/threads.ts`, in the `for await` chunk loop, add a branch for `usage`:

```ts
              } else if (chunk.type === "save_suggestion") {
                meta.save_suggestion = chunk.payload;
              } else if (chunk.type === "usage") {
                meta.usage = chunk.payload;
              }
```

(Insert directly after the existing `save_suggestion` branch.)

`finalizeAgentMessage` then pulls `meta.usage` out and writes it to `chat_messages.token_usage`.

- [ ] **Step 5: Run — expect Step 1 test passes**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/routes/threads-real-llm.test.ts
```

Expected: pass. Token persistence correct, SSE events forwarded.

If existing tests in `tests/routes/` rely on the old stub-echo string `(stub agent response to: ...)` (search the directory), update them to either:
- Inject a `__setRunAgentForTest` fixture that yields a known string, or
- Assert on event ordering rather than literal text.

- [ ] **Step 6: Run full api suite**

Run:

```bash
pnpm --filter @opencairn/api test
```

Expected: all green. Fix any tests that depended on stub echo.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/agent-pipeline.ts apps/api/src/routes/threads.ts apps/api/tests/routes/threads-real-llm.test.ts
git commit -m "feat(api): wire runAgent to real Gemini path — closes audit Tier 1 #1

Phase 4 agent panel SSE no longer streams '(stub agent response to: ...)'.
runAgent now resolves the thread workspace, calls chat-llm.runChat with
workspace-scoped RAG defaults, and forwards every chunk type. token_usage
is persisted from the provider-reported numbers; provider='gemini' on
the chat_messages row.

Drops the env-gated AGENT_STUB_EMIT_SAVE_SUGGESTION fixture path —
save-suggestion now comes from the LLM via the fence parser (Task 5).

Refs: docs/review/2026-04-28-completion-claims-audit.md §1.1, §1.3
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire `chat.ts /message` to `runChat()` (Plan 11A)

**Files:**
- Modify: `apps/api/src/routes/chat.ts` (lines 346–420 region)
- Create: `apps/api/tests/routes/chat-real-llm.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/routes/chat-real-llm.test.ts`. Mirror an existing chat route test for fixtures (likely `tests/routes/chat.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/llm/gemini", () => ({
  getGeminiProvider: vi.fn(),
  LLMNotConfiguredError: class extends Error {},
}));

const llm = (await import("../../src/lib/llm/gemini.js")) as unknown as {
  getGeminiProvider: ReturnType<typeof vi.fn>;
};

const fakeProvider = {
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  streamGenerate: vi.fn(),
};

beforeEach(() => {
  llm.getGeminiProvider.mockReturnValue(fakeProvider);
});

describe("POST /api/chat/message — real LLM path", () => {
  it("emits real text deltas + cost event with provider tokens", async () => {
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "answer" };
      yield { usage: { tokensIn: 40, tokensOut: 9, model: "gemini-2.5-flash" } };
    });

    // Set up: workspace + user + conversation (project scope, ragMode=strict)
    // ... existing fixtures
    // POST /api/chat/message with conversationId + content
    // Collect SSE events.
    // Assert:
    //  - delta event with "answer"
    //  - cost event payload has tokensIn=0, tokensOut=9 (assistant only — see spec §4.2)
    //  - conversation_messages.assistant row has tokens_out=9, citations=[] (or non-empty if hits)
    //  - conversations.total_tokens_in incremented by 40
    //  - conversations.total_tokens_out incremented by 9
  });

  it("returns 503 llm_not_configured when LLMNotConfiguredError raised pre-stream", async () => {
    llm.getGeminiProvider.mockImplementation(() => {
      throw new (class extends Error {
        code = "llm_not_configured";
      })();
    });
    // POST → expect 503 body { error: "llm_not_configured" }
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/routes/chat-real-llm.test.ts
```

Expected: assertions fail (current placeholder reply doesn't match).

- [ ] **Step 3: Replace `/message` body in `chat.ts`**

In `apps/api/src/routes/chat.ts`, replace the entire body of the `chatRoutes.post("/message", ...)` handler (lines 346–420 region) with:

```ts
chatRoutes.post(
  "/message",
  zValidator("json", SendMessageBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const { conversationId, content } = c.req.valid("json");

    const [convo] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!convo) return c.json({ error: "not found" }, 404);
    if (convo.ownerUserId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Map conversation scope to retrieval scope.
    const scope: RetrievalScope =
      convo.scopeType === "page"
        ? { type: "page", workspaceId: convo.workspaceId, noteId: convo.scopeId }
        : convo.scopeType === "project"
          ? { type: "project", workspaceId: convo.workspaceId, projectId: convo.scopeId }
          : { type: "workspace", workspaceId: convo.workspaceId };

    // Filter chips: retrieval ignores memory:* in v1.
    const chips: RetrievalChip[] = (convo.attachedChips as AttachedChip[])
      .filter((c) => c.type === "page" || c.type === "project" || c.type === "workspace")
      .map((c) => ({ type: c.type, id: c.id }));

    // Replay last N turns of history (oldest-first). Tool rows fold to
    // assistant per spec §4.2 (renderer concats them visually).
    const histRows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt));
    const history: ChatMsg[] = histRows.map((r) => ({
      role:
        r.role === "user"
          ? "user"
          : r.role === "assistant" || r.role === "tool"
            ? "assistant"
            : "system",
      content: r.content,
    }));

    // Persist the user row synchronously. We do NOT yet know the prompt
    // token count — fill it in below once Gemini reports usage. For the
    // moment, leave tokensIn null so a mid-stream crash leaves an
    // unbilled but recoverable row.
    const [userRow] = await db
      .insert(conversationMessages)
      .values({
        conversationId,
        role: "user",
        content,
        tokensIn: null,
        tokensOut: 0,
      })
      .returning();

    return streamSSE(c, async (stream) => {
      let provider;
      try {
        provider = getGeminiProvider();
      } catch (err) {
        const code =
          err instanceof LLMNotConfiguredError ? "llm_not_configured" : "llm_failed";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ code, message: (err as Error).message }),
        });
        await stream.writeSSE({ event: "done", data: "{}" });
        return;
      }

      const buffer: string[] = [];
      const citations: Citation[] = [];
      let usage: Usage | null = null;
      let saveSuggestion: { title: string; body_markdown: string } | null = null;

      try {
        for await (const chunk of runChat({
          workspaceId: convo.workspaceId,
          scope,
          ragMode: convo.ragMode,
          chips,
          history,
          userMessage: content,
          provider,
        })) {
          if (chunk.type === "text") {
            const p = chunk.payload as { delta: string };
            buffer.push(p.delta);
            await stream.writeSSE({
              event: "delta",
              data: JSON.stringify({ delta: p.delta }),
            });
          } else if (chunk.type === "citation") {
            citations.push(chunk.payload as Citation);
          } else if (chunk.type === "usage") {
            usage = chunk.payload as Usage;
          } else if (chunk.type === "save_suggestion") {
            saveSuggestion = chunk.payload as {
              title: string;
              body_markdown: string;
            };
          }
        }
      } catch (err) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            code: "llm_failed",
            message: err instanceof Error ? err.message : "unknown",
          }),
        });
        await stream.writeSSE({ event: "done", data: "{}" });
        return;
      }

      // Persist usage. Provider reports promptTokens (system+history+user)
      // and candidatesTokens (assistant). We split per spec §4.2: the
      // user's promptTokens go on the user row; the assistant's
      // candidatesTokens go on the assistant row.
      const tokensIn = usage?.tokensIn ?? 0;
      const tokensOut = usage?.tokensOut ?? 0;
      const userCostKrw = tokensToKrw(tokensIn, 0);
      const assistantCostKrw = tokensToKrw(0, tokensOut);

      await db
        .update(conversationMessages)
        .set({
          tokensIn,
          costKrw: String(userCostKrw),
        })
        .where(eq(conversationMessages.id, userRow.id));

      const reply = buffer.join("");
      const [assistant] = await db
        .insert(conversationMessages)
        .values({
          conversationId,
          role: "assistant",
          content: reply,
          citations,
          tokensIn: 0,
          tokensOut,
          costKrw: String(assistantCostKrw),
        })
        .returning();

      await db
        .update(conversations)
        .set({
          totalTokensIn: sql`${conversations.totalTokensIn} + ${tokensIn}`,
          totalTokensOut: sql`${conversations.totalTokensOut} + ${tokensOut}`,
          totalCostKrw: sql`${conversations.totalCostKrw} + ${userCostKrw + assistantCostKrw}`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));

      if (saveSuggestion) {
        await stream.writeSSE({
          event: "save_suggestion",
          data: JSON.stringify(saveSuggestion),
        });
      }

      await stream.writeSSE({
        event: "cost",
        data: JSON.stringify({
          messageId: assistant.id,
          tokensIn: 0,
          tokensOut,
          costKrw: assistantCostKrw,
        }),
      });
      await stream.writeSSE({ event: "done", data: "{}" });
    });
  },
);
```

Add the new imports at the top of `chat.ts`:

```ts
import { asc } from "@opencairn/db";
import { runChat } from "../lib/chat-llm";
import {
  getGeminiProvider,
  LLMNotConfiguredError,
  type ChatMsg,
  type Usage,
} from "../lib/llm/gemini";
import type { RetrievalScope, RetrievalChip } from "../lib/chat-retrieval";
```

(If `asc` is already exported from `@opencairn/db`'s drizzle re-exports, the import compacts naturally; otherwise import directly from `drizzle-orm`.)

- [ ] **Step 4: Run — expect Step 1 tests pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/routes/chat-real-llm.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Run full api suite**

Run:

```bash
pnpm --filter @opencairn/api test
```

Expected: all green. If existing 11A tests assert `(11A placeholder reply)`, update them to mock the provider and assert real shape.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/chat.ts apps/api/tests/routes/chat-real-llm.test.ts
git commit -m "feat(api): /api/chat/message uses real Gemini + workspace RAG — closes audit Tier 1 #2

attachedChips and ragMode are now read by retrieve(). Token accounting
uses provider-reported usage (tokensIn = promptTokens on user row,
tokensOut = candidatesTokens on assistant row). LLMNotConfiguredError
maps to a 503-shaped SSE error event so misconfigured operators get a
real signal instead of the prior '(11A placeholder reply)' echo.

Refs: docs/review/2026-04-28-completion-claims-audit.md §1.2
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Cleanup `.env.example` and remove dead env stub references

**Files:**
- Modify: `.env.example`
- Search: any remaining references to `AGENT_STUB_EMIT_SAVE_SUGGESTION` and `(stub agent response to`

- [ ] **Step 1: Audit dead references**

Run:

```bash
git grep -n "AGENT_STUB_EMIT_SAVE_SUGGESTION"
git grep -n "stub agent response to"
git grep -n "11A placeholder reply"
```

Expected: only docs/review/2026-04-28-completion-claims-audit.md hits remain (audit document is intentionally a permanent record). Other hits in .env.example or test fixtures must be removed.

- [ ] **Step 2: Update `.env.example`**

In `.env.example`, after the existing `LLM_PROVIDER` block (around line 31), add:

```bash
# ── Chat surface (apps/api/src/lib/chat-llm.ts) ─────────────────────────────
# The chat path uses @google/genai TS SDK directly (not packages/llm).
# Reuses GEMINI_API_KEY above. Override GEMINI_CHAT_MODEL if you need a
# different chat-tier model than the worker uses.
GEMINI_CHAT_MODEL=gemini-2.5-flash

# RAG retrieval bounds (apps/api/src/lib/chat-retrieval.ts).
# top_k 5 / 12 covers typical ingest sizes; raise CHAT_RAG_MAX_PROJECTS
# if a workspace contains many projects and workspace-wide RAG feels under-
# inclusive.
CHAT_RAG_TOP_K_STRICT=5
CHAT_RAG_TOP_K_EXPAND=12
CHAT_RAG_MAX_PROJECTS=64

# History truncation (apps/api/src/lib/chat-llm.ts).
CHAT_MAX_HISTORY_TURNS=12
CHAT_MAX_INPUT_TOKENS=32000
CHAT_MAX_OUTPUT_TOKENS=2048
```

- [ ] **Step 3: Remove obsolete `AGENT_STUB_EMIT_SAVE_SUGGESTION` if present**

Search:

```bash
git grep -n "AGENT_STUB_EMIT_SAVE_SUGGESTION" .env.example apps/
```

Delete any remaining lines from `.env.example` and any test fixtures that set this env. The agent-pipeline.ts code path that read it is already gone (Task 7).

- [ ] **Step 4: Run full api suite**

Run:

```bash
pnpm --filter @opencairn/api test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "chore(env): document new CHAT_* vars; drop AGENT_STUB_EMIT_SAVE_SUGGESTION

The save-suggestion stub trigger no longer exists in code (Task 7
deleted the env-gated branch in agent-pipeline.ts). Removing the env
var documentation matches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: TypeScript build + monorepo type-check

**Files:**
- (no source changes; verification step)

- [ ] **Step 1: Run TypeScript build**

Run:

```bash
pnpm --filter @opencairn/api build
```

Expected: zero TS errors. If the new lib files surface type errors (most likely from the `db.execute` raw row casts or `@google/genai` mismatched shapes), reconcile by either (a) loosening the cast site to a typed helper or (b) querying via Drizzle's typed builder for the simple `projects.id`/`notes.project_id` lookups instead of `db.execute(sql\`...\`)`.

- [ ] **Step 2: Run web build (downstream check)**

Run:

```bash
pnpm --filter @opencairn/web build
```

Expected: green. Web does not import any of the new chat-llm modules, but a web build is the cheapest way to confirm `@opencairn/db` and `@opencairn/shared` re-exports still resolve.

- [ ] **Step 3: Run all api tests one more time**

Run:

```bash
pnpm --filter @opencairn/api test
```

Expected: all green. Note the test count delta vs pre-PR.

- [ ] **Step 4: Commit if any minor fixups were needed**

If the prior tasks landed the code cleanly, no commit is needed here. If a TS-only fix was required, commit it under:

```bash
git commit -m "chore(api): TS fixups after chat LLM wiring"
```

---

## Task 11: Manual smoke (`pnpm dev`) — the user's acceptance check

**Files:**
- (no source changes; manual verification)

- [ ] **Step 1: Bring up dev**

Run from repo root:

```bash
docker-compose up -d        # postgres + redis + minio + temporal
pnpm db:migrate             # migrations are unchanged but run for parity
pnpm dev                    # api + web + worker + hocuspocus
```

Wait until all four services log "ready".

- [ ] **Step 2: Provision a tiny corpus**

In the web app:

1. Sign up / sign in.
2. Create a workspace + project.
3. Upload one PDF or paste 2–3 paragraphs into a note. The note must contain a recognizable phrase (e.g. "the quick brown fox jumped").
4. Wait for ingest to complete. Expect a green "ingest done" notification (existing live-ingest viz wires this).
5. Confirm the note's `embedding` column is populated:

```bash
docker compose exec postgres psql -U opencairn -c "SELECT id, title, (embedding IS NOT NULL) AS has_embed FROM notes ORDER BY created_at DESC LIMIT 3;"
```

Expected: `has_embed = t` on the new note. If `f`, the embedding pipeline is broken and chat retrieval will return empty hits — investigate Plan 3/3b before proceeding.

- [ ] **Step 3: Phase 4 agent panel smoke**

1. Open the app shell, click the agent panel.
2. Ask: "What is the quick brown fox doing?"
3. Expected:
   - SSE streams a real, grounded answer (NOT `(stub agent response to: ...)`).
   - Answer references the note's content.
   - DevTools network tab → SSE events include `text`, `citation`, `usage`, `done`.
   - The `chat_messages` row (DB) for the agent reply has non-null `token_usage` with `tokensIn > 0`, `tokensOut > 0`, `model = "gemini-2.5-flash"`.

- [ ] **Step 4: Plan 11A `/chat` smoke**

1. Navigate to `/chat`.
2. Pick the same workspace; in conversation create, set `scopeType=workspace`, `ragMode=strict`.
3. Send the same question.
4. Expected:
   - Streamed reply with content from the note.
   - SSE `cost` event payload has `tokensOut > 0`.
   - DB: `conversation_messages.assistant` row has `tokens_out > 0` and `citations` non-empty if RAG hit.
   - DB: `conversations.total_tokens_out` incremented.

- [ ] **Step 5: ragMode=off smoke**

1. PATCH the conversation: `ragMode=off`.
2. Ask the same question.
3. Expected:
   - Reply is a generic answer (no workspace grounding).
   - DB: `conversation_messages.assistant.citations = []`.

- [ ] **Step 6: save_suggestion smoke (best-effort)**

Ask a question that prompts the LLM to suggest a takeaway (e.g. "Summarize 3 actionable next steps from the note"). The model *may or may not* emit a `save-suggestion` fence — this is non-deterministic. If it does:
- The agent panel renders a `SaveSuggestionCard`.
- Clicking "Save" creates a new note (Plan 2D handler).

If the model never emits the fence in 5 attempts, that's acceptable. The system prompt invites the fence; LLMs decide.

- [ ] **Step 7: Misconfigured-key smoke**

1. Set `GEMINI_API_KEY=""` in `.env`.
2. Restart the api.
3. Send a message.
4. Expected: SSE `error` event with `code="llm_not_configured"`. UI should not freeze. (Existing error renderer handles this — no regression check needed beyond "no infinite spinner".)
5. Restore the key.

- [ ] **Step 8: Document smoke outcomes**

If smoke passed cleanly, proceed to Task 12. If any step failed, log the failure inline in the audit (`docs/review/2026-04-28-completion-claims-audit.md`) under a new "Smoke results" section and triage before merging.

---

## Task 12: Update plans-status.md, MEMORY index, api-contract docs

**Files:**
- Modify: `docs/contributing/plans-status.md`
- Modify: `docs/architecture/api-contract.md`
- Modify: `~/.claude/projects/.../memory/MEMORY.md` and the relevant memory file (audit entry)

- [ ] **Step 1: Update `plans-status.md`**

Add (or update) a row tying Plan 11B Phase A to the Tier 1 closures:

```markdown
| Plan 11B Phase A — Chat real LLM wiring | ✅ <commit-sha> | `feat/plan-11b-phase-a` | Closes audit Tier 1 #1·#2·#3. Chat surfaces (Phase 4 agent panel + Plan 11A /chat) call real `gemini-2.5-flash` with workspace-scoped RAG. No migration; no feature flag. |
```

(Where `<commit-sha>` is the merge commit hash after this PR lands.)

- [ ] **Step 2: Update `docs/architecture/api-contract.md`**

Find the rows for `POST /api/threads/:id/messages` and `POST /api/chat/message`. Replace any "stub" / "placeholder" annotations with:

> SSE → `{user_persisted, agent_placeholder, status, thought, text, citation, usage, save_suggestion?, done}`. Real Gemini-2.5-flash; citations from workspace-scoped RAG retrieval. `usage` payload uses provider-reported `tokensIn`/`tokensOut`/`model`.

(Adjust to whatever the existing column structure expects.)

- [ ] **Step 3: Append to the audit doc**

In `docs/review/2026-04-28-completion-claims-audit.md`, at the bottom of §11 (priority list), add:

```markdown
### Update (2026-04-28)

- Tier 1 #1 (Phase 4 stub) — **CLOSED** in <commit-sha>. agent-pipeline.ts:39 echo replaced with chat-llm.runChat() call.
- Tier 1 #2 (11A placeholder) — **CLOSED** in <commit-sha>. chat.ts /message body rewritten; provider-reported tokens.
- Tier 1 #3 (env-gated save_suggestion) — **CLOSED** in <commit-sha>. AGENT_STUB_EMIT_SAVE_SUGGESTION removed; producer is now LLM fence parser.
```

- [ ] **Step 4: Update memory**

Update `MEMORY.md` index entry for `project_completion_claims_audit.md`:

```markdown
- [⚠️ Completion Claims Audit 2026-04-28](project_completion_claims_audit.md) — Phase 0/1/2 완료 표기 플랜 다수가 silent stub/placeholder/cron 미스케줄. **Tier 1 #1·#2·#3 (chat real LLM)는 <commit-sha>에서 닫힘.** production 실제 LLM user-facing 경로 0개 → 2개 (Phase 4 agent panel + 11A /chat). plans-status.md의 ✅를 신뢰하지 말 것. 박제: `docs/review/2026-04-28-completion-claims-audit.md`
```

Add a new entry tying Plan 11B Phase A to the audit closure:

```markdown
- [Plan 11B Phase A 완료 + 감사 Tier 1 마감](project_plan_11b_phase_a_complete.md) — 2026-04-28 PR # MERGED. doc-editor slash 16 task + chat real LLM wiring (audit Tier 1 #1·#2·#3 closure). chat.ts /message + agent-pipeline.ts/threads.ts 모두 real Gemini-2.5-flash + workspace RAG. 마이그레이션 없음.
```

- [ ] **Step 5: Commit docs**

```bash
git add docs/contributing/plans-status.md docs/architecture/api-contract.md docs/review/2026-04-28-completion-claims-audit.md
git commit -m "docs: mark audit Tier 1 #1·#2·#3 closed by chat real LLM wiring

plans-status.md row added; api-contract chat rows annotated as real
Gemini-backed; audit doc gets a closure footnote so the next session
sees Tier 1 closed without relying on memory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(MEMORY.md updates happen via the memory writer, not git.)

---

## Task 13: PR + post-feature workflow

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/plan-11b-phase-a
```

- [ ] **Step 2: Open PR**

Use `gh pr create` with body summarizing:
- 16 Phase A tasks (DocEditorAgent + slash commands) — already on this branch from prior commits
- This PR's added 13 tasks for chat real LLM wiring
- Closes audit Tier 1 #1·#2·#3
- No DB migration
- Manual smoke completed (paste smoke output if useful)

- [ ] **Step 3: Run `opencairn-post-feature` skill**

This runs verification + review + docs + commit checks. Address any review fixes in follow-up commits on the same branch.

- [ ] **Step 4: After merge, update memory entry with merge commit SHA**

Replace the placeholder `<commit-sha>` in MEMORY.md / plans-status.md / audit footnote with the actual merge SHA.

---

## Self-Review Checklist (run after writing all tasks)

**Spec coverage:**
- ✅ §3.1 LLMProvider — Task 2 / 2.5 / 2.6
- ✅ §3.2 chat-retrieval — Task 4
- ✅ §3.3 internal-hybrid-search refactor — Task 3
- ✅ §3.4 chat-llm runChat — Task 6
- ✅ §3.5 save-suggestion fence — Task 5
- ✅ §4.1 agent-pipeline runAgent — Task 7
- ✅ §4.2 chat.ts /message — Task 8
- ✅ §5 env vars — Task 9
- ✅ §6 tests — Tasks 2/2.5/2.6/3/4/5/6/7/8 each include unit or integration
- ✅ §6.3 manual smoke — Task 11
- ✅ §8 no migration — confirmed by Task 8 wiring; no migration step exists in plan
- ✅ §9 rollout — Tasks 12/13

**Type consistency:** `LLMProvider`, `ChatMsg`, `Usage`, `StreamChunk` defined in Task 2 are used as-is in Tasks 6/7/8. `RetrievalScope`, `RetrievalChip`, `RagMode`, `RetrievalHit` from Task 4 used in Task 6/8. `ChatChunk` discriminated union from Task 6 used in Task 7. No drift.

**Placeholders:** None — every step has the actual code or command. The only `<commit-sha>` placeholder is in Task 12, which is a deliberate post-merge fill-in.

---

## Execution Handoff

Two execution options for this plan:

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review between tasks. Best for this plan because each task is genuinely self-contained and TDD-disciplined; subagents won't accidentally cross-contaminate.

**2. Inline Execution** — execute all tasks in this session using `superpowers:executing-plans`. Faster for the operator but the conversation context grows.

Choose at start of execution.
