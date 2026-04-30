# Grounded Agent Rerank And Context Packing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add candidate reranking and structured context packing so retrieval quality stays stable as corpus size grows.

**Architecture:** Convert raw retrieval hits into a typed candidate pool, apply deterministic reranking signals, enforce source diversity, and produce an `EvidenceBundle` consumed by `runChat()`. This keeps final prompt construction inspectable and prepares the verifier plan.

**Tech Stack:** TypeScript, Vitest, existing `chat-retrieval.ts`, existing `runChat()` SSE path.

---

## File Structure

Create:

- `apps/api/src/lib/retrieval-candidates.ts` — typed candidate and evidence bundle definitions.
- `apps/api/src/lib/retrieval-rerank.ts` — deterministic ranking weights.
- `apps/api/src/lib/context-packer.ts` — token budget and source diversity packer.
- `apps/api/tests/lib/retrieval-rerank.test.ts`
- `apps/api/tests/lib/context-packer.test.ts`

Modify:

- `apps/api/src/lib/chat-retrieval.ts` — return packed evidence or expose candidate pool.
- `apps/api/src/lib/chat-llm.ts` — build prompt from `EvidenceBundle`.
- `apps/api/tests/lib/chat-llm.test.ts`.

---

## Task 1: Candidate And Evidence Types

**Files:**

- Create: `apps/api/src/lib/retrieval-candidates.ts`

- [ ] **Step 1: Create shared types**

Create `apps/api/src/lib/retrieval-candidates.ts`:

```ts
export type RetrievalChannel = "vector" | "bm25" | "graph" | "active_context";

export type RetrievalCandidate = {
  id: string;
  noteId: string;
  chunkId: string | null;
  title: string;
  headingPath: string;
  snippet: string;
  channelScores: Partial<Record<RetrievalChannel, number>>;
  sourceType: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
};

export type EvidenceItem = {
  citationIndex: number;
  noteId: string;
  chunkId: string | null;
  title: string;
  headingPath: string;
  snippet: string;
  sourceType: string | null;
  sourceUrl: string | null;
};

export type EvidenceBundle = {
  items: EvidenceItem[];
  totalEstimatedTokens: number;
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/retrieval-candidates.ts
git commit -m "feat(api): define retrieval evidence bundle"
```

---

## Task 2: Deterministic Reranker

**Files:**

- Create: `apps/api/src/lib/retrieval-rerank.ts`
- Test: `apps/api/tests/lib/retrieval-rerank.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/lib/retrieval-rerank.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rerankCandidates } from "../../src/lib/retrieval-rerank.js";
import type { RetrievalCandidate } from "../../src/lib/retrieval-candidates.js";

function candidate(id: string, snippet: string, scores: RetrievalCandidate["channelScores"]): RetrievalCandidate {
  return {
    id,
    noteId: id,
    chunkId: id,
    title: id,
    headingPath: "",
    snippet,
    channelScores: scores,
    sourceType: null,
    sourceUrl: null,
    updatedAt: null,
  };
}

describe("rerankCandidates", () => {
  it("boosts exact query overlap and multi-channel evidence", () => {
    const out = rerankCandidates({
      query: "transformer attention",
      candidates: [
        candidate("weak", "unrelated", { vector: 0.9 }),
        candidate("strong", "transformer attention mechanism", { vector: 0.7, bm25: 0.6 }),
      ],
    });
    expect(out[0]!.id).toBe("strong");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/retrieval-rerank.test.ts
```

Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement reranker**

Create `apps/api/src/lib/retrieval-rerank.ts`:

```ts
import type { RetrievalCandidate } from "./retrieval-candidates";

export function rerankCandidates(input: {
  query: string;
  candidates: RetrievalCandidate[];
}): RetrievalCandidate[] {
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);

  function score(c: RetrievalCandidate): number {
    const base = Object.values(c.channelScores).reduce((sum, value) => sum + (value ?? 0), 0);
    const haystack = `${c.title} ${c.headingPath} ${c.snippet}`.toLowerCase();
    const overlap = terms.filter((term) => haystack.includes(term)).length;
    const multiChannelBoost = Object.keys(c.channelScores).length > 1 ? 0.25 : 0;
    return base + overlap * 0.2 + multiChannelBoost;
  }

  return input.candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.candidate);
}
```

- [ ] **Step 4: Run reranker test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/retrieval-rerank.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/retrieval-rerank.ts apps/api/tests/lib/retrieval-rerank.test.ts
git commit -m "feat(api): rerank retrieval candidates"
```

---

## Task 3: Context Packer

**Files:**

- Create: `apps/api/src/lib/context-packer.ts`
- Test: `apps/api/tests/lib/context-packer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/lib/context-packer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { packEvidence } from "../../src/lib/context-packer.js";
import type { RetrievalCandidate } from "../../src/lib/retrieval-candidates.js";

function candidate(id: string, noteId = id, snippet = "alpha beta"): RetrievalCandidate {
  return {
    id,
    noteId,
    chunkId: id,
    title: `Title ${id}`,
    headingPath: "",
    snippet,
    channelScores: { vector: 1 },
    sourceType: null,
    sourceUrl: null,
    updatedAt: null,
  };
}

describe("packEvidence", () => {
  it("assigns citation indexes and respects token budget", () => {
    const bundle = packEvidence({
      candidates: [candidate("c1"), candidate("c2", "n2", "x".repeat(2000))],
      maxTokens: 100,
    });
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]!.citationIndex).toBe(1);
  });

  it("limits repeated chunks from one note", () => {
    const bundle = packEvidence({
      candidates: [candidate("c1", "same"), candidate("c2", "same"), candidate("c3", "other")],
      maxTokens: 1000,
      maxChunksPerNote: 1,
    });
    expect(bundle.items.map((i) => i.noteId)).toEqual(["same", "other"]);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/context-packer.test.ts
```

Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement packer**

Create `apps/api/src/lib/context-packer.ts`:

```ts
import type { EvidenceBundle, EvidenceItem, RetrievalCandidate } from "./retrieval-candidates";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function packEvidence(input: {
  candidates: RetrievalCandidate[];
  maxTokens: number;
  maxChunksPerNote?: number;
}): EvidenceBundle {
  const maxChunksPerNote = input.maxChunksPerNote ?? 2;
  const perNote = new Map<string, number>();
  const items: EvidenceItem[] = [];
  let totalEstimatedTokens = 0;

  for (const candidate of input.candidates) {
    const noteCount = perNote.get(candidate.noteId) ?? 0;
    if (noteCount >= maxChunksPerNote) continue;
    const cost = estimateTokens(candidate.snippet);
    if (totalEstimatedTokens + cost > input.maxTokens) continue;
    items.push({
      citationIndex: items.length + 1,
      noteId: candidate.noteId,
      chunkId: candidate.chunkId,
      title: candidate.title,
      headingPath: candidate.headingPath,
      snippet: candidate.snippet,
      sourceType: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
    });
    totalEstimatedTokens += cost;
    perNote.set(candidate.noteId, noteCount + 1);
  }

  return { items, totalEstimatedTokens };
}

export function evidenceBundleToPrompt(bundle: EvidenceBundle): string {
  if (bundle.items.length === 0) return "";
  return [
    "<context>",
    ...bundle.items.map((item) => {
      const heading = item.headingPath ? ` · ${item.headingPath}` : "";
      return `[${item.citationIndex}] ${item.title}${heading}\n${item.snippet}`;
    }),
    "</context>",
  ].join("\n\n");
}
```

- [ ] **Step 4: Run packer test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/context-packer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/context-packer.ts apps/api/tests/lib/context-packer.test.ts
git commit -m "feat(api): pack retrieval evidence for chat"
```

---

## Task 4: Use EvidenceBundle In Chat Prompt

**Files:**

- Modify: `apps/api/src/lib/chat-llm.ts`
- Modify: `apps/api/src/lib/chat-retrieval.ts`
- Modify: `apps/api/tests/lib/chat-llm.test.ts`

- [ ] **Step 1: Add failing prompt test**

In `apps/api/tests/lib/chat-llm.test.ts`, update an existing citation test to assert prompt context uses packed evidence:

```ts
expect((receivedMessages[0] as { content: string }).content).toContain("<context>");
expect((receivedMessages[0] as { content: string }).content).toContain("[1] alpha");
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts
```

Expected: FAIL until `runChat()` uses `EvidenceBundle`.

- [ ] **Step 3: Convert hits to candidates and pack evidence**

In `apps/api/src/lib/chat-llm.ts`, import:

```ts
import { evidenceBundleToPrompt, packEvidence } from "./context-packer";
import type { RetrievalCandidate } from "./retrieval-candidates";
```

After `hits` are loaded, convert:

```ts
const candidates: RetrievalCandidate[] = hits.map((h, index) => ({
  id: `${h.noteId}:${index}`,
  noteId: h.noteId,
  chunkId: "chunkId" in h ? String(h.chunkId) : null,
  title: h.title,
  headingPath: "",
  snippet: h.snippet,
  channelScores: { vector: h.score },
  sourceType: null,
  sourceUrl: null,
  updatedAt: null,
}));
const evidenceBundle = packEvidence({
  candidates,
  maxTokens: envInt("CHAT_CONTEXT_MAX_TOKENS", 6000),
});
const ragBlock = evidenceBundleToPrompt(evidenceBundle);
```

Then derive citations from `evidenceBundle.items` instead of raw `hits`.

- [ ] **Step 4: Run chat tests**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-llm.test.ts tests/lib/context-packer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-llm.ts apps/api/tests/lib/chat-llm.test.ts
git commit -m "feat(api): build chat prompts from evidence bundles"
```

---

## Final Verification

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/retrieval-rerank.test.ts tests/lib/context-packer.test.ts tests/lib/chat-llm.test.ts
pnpm --filter @opencairn/api build
git diff --check
```

Expected: all pass.

