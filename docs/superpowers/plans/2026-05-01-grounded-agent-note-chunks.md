# Grounded Agent Note Chunks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chunk-level retrieval storage and fallback-safe chunk search so long documents can be cited by paragraph/section instead of only by parent note.

**Architecture:** Add a PostgreSQL `note_chunks` table with pgvector, full-text search, source metadata, `content_hash`, and denormalized `deleted_at`. Add a chunker/indexer in `apps/api/src/lib`, update retrieval to query chunks first, and keep note-level retrieval as fallback while existing workspaces are backfilled.

**Tech Stack:** Drizzle ORM, PostgreSQL pgvector, PostgreSQL `tsvector`, Hono API internals, Vitest, existing Gemini embedding adapter.

---

## File Structure

Create:

- `packages/db/src/schema/note-chunks.ts` — Drizzle schema for chunk rows.
- `apps/api/src/lib/note-chunker.ts` — deterministic text chunking with heading paths.
- `apps/api/src/lib/note-chunk-indexer.ts` — builds chunk rows from notes and embeddings.
- `apps/api/src/lib/chunk-hybrid-search.ts` — vector + full-text chunk search with RRF.
- `apps/api/tests/lib/note-chunker.test.ts`
- `apps/api/tests/lib/chunk-hybrid-search.test.ts`

Modify:

- `packages/db/src/schema/index.ts` or `packages/db/src/client.ts` schema exports, following the repo's current schema import pattern.
- `packages/db/src/index.ts` to export `noteChunks`.
- `apps/api/src/lib/chat-retrieval.ts` to call chunk search first and note search as fallback.
- `apps/api/src/lib/internal-hybrid-search.ts` only if shared RRF helpers are extracted.
- `apps/api/tests/lib/chat-retrieval.test.ts`.

Do not update `docs/contributing/plans-status.md` until the implementation PR is merged.

---

## Task 1: Add `note_chunks` DB Schema

**Files:**

- Create: `packages/db/src/schema/note-chunks.ts`
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/note-chunks.test.ts`

- [ ] **Step 1: Write failing schema test**

Create `packages/db/tests/note-chunks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { noteChunks } from "../src/schema/note-chunks";

describe("noteChunks schema", () => {
  it("defines retrieval, citation, and soft-delete columns", () => {
    const columns = Object.keys(getTableColumns(noteChunks));
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "projectId",
        "noteId",
        "chunkIndex",
        "headingPath",
        "contentText",
        "contentTsv",
        "embedding",
        "tokenCount",
        "sourceOffsets",
        "contentHash",
        "deletedAt",
        "createdAt",
        "updatedAt",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/db test -- tests/note-chunks.test.ts
```

Expected: FAIL because schema does not exist.

- [ ] **Step 3: Implement schema**

Create `packages/db/src/schema/note-chunks.ts`:

```ts
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { vector3072 } from "./custom-types";
import { notes } from "./notes";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export const noteChunks = pgTable(
  "note_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    contentText: text("content_text").notNull(),
    contentTsv: text("content_tsv").notNull().default(""),
    embedding: vector3072("embedding"),
    tokenCount: integer("token_count").notNull(),
    sourceOffsets: jsonb("source_offsets").$type<{ start?: number; end?: number } | null>(),
    contentHash: text("content_hash").notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    noteIndexUnique: uniqueIndex("note_chunks_note_index_unique").on(t.noteId, t.chunkIndex),
    contentHashIdx: index("note_chunks_content_hash_idx").on(t.contentHash),
    activeProjectIdx: index("note_chunks_active_project_idx").on(t.projectId, t.deletedAt),
    activeWorkspaceIdx: index("note_chunks_active_workspace_idx").on(t.workspaceId, t.deletedAt),
  }),
);

export type NoteChunk = typeof noteChunks.$inferSelect;
export type NewNoteChunk = typeof noteChunks.$inferInsert;
```

The existing `vector3072` helper keeps its legacy name while honoring `VECTOR_DIM`; do not introduce a second vector helper for chunks.

- [ ] **Step 4: Export schema**

Add `noteChunks` to the same schema export/import paths used by `notes`, `concepts`, and `embeddingBatches`.

- [ ] **Step 5: Run schema test**

```bash
pnpm --filter @opencairn/db test -- tests/note-chunks.test.ts
```

Expected: PASS.

- [ ] **Step 6: Generate migration**

```bash
pnpm --filter @opencairn/db db:generate
```

Expected: a new Drizzle migration for `note_chunks`. Do not hand-pick a migration number.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/note-chunks.ts packages/db/src/client.ts packages/db/src/index.ts packages/db/tests/note-chunks.test.ts packages/db/drizzle
git commit -m "feat(db): add note chunks retrieval table"
```

---

## Task 2: Deterministic Note Chunker

**Files:**

- Create: `apps/api/src/lib/note-chunker.ts`
- Test: `apps/api/tests/lib/note-chunker.test.ts`

- [ ] **Step 1: Write failing chunker tests**

Create `apps/api/tests/lib/note-chunker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chunkNoteText } from "../../src/lib/note-chunker.js";

describe("chunkNoteText", () => {
  it("keeps heading path on each chunk", () => {
    const chunks = chunkNoteText({
      contentText: "# Intro\nAlpha text.\n\n## Details\nBeta text.",
      maxChars: 30,
    });
    expect(chunks.map((c) => c.headingPath)).toEqual(["Intro", "Intro > Details"]);
  });

  it("splits long paragraphs without producing empty chunks", () => {
    const chunks = chunkNoteText({
      contentText: "A".repeat(90),
      maxChars: 40,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.contentText.length > 0)).toBe(true);
    expect(chunks.every((c) => c.tokenCount > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/note-chunker.test.ts
```

Expected: FAIL because `note-chunker.ts` does not exist.

- [ ] **Step 3: Implement chunker**

Create `apps/api/src/lib/note-chunker.ts`:

```ts
import { createHash } from "node:crypto";

export type ChunkNoteTextInput = {
  contentText: string;
  maxChars?: number;
};

export type NoteTextChunk = {
  chunkIndex: number;
  headingPath: string;
  contentText: string;
  tokenCount: number;
  contentHash: string;
  sourceOffsets: { start: number; end: number };
};

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

export function chunkNoteText(input: ChunkNoteTextInput): NoteTextChunk[] {
  const maxChars = input.maxChars ?? 2400;
  const lines = input.contentText.split(/\r?\n/);
  const headingStack: string[] = [];
  const chunks: Omit<NoteTextChunk, "chunkIndex">[] = [];
  let buffer = "";
  let bufferStart = 0;
  let cursor = 0;

  function flush(end: number) {
    const text = buffer.trim();
    if (!text) {
      buffer = "";
      bufferStart = cursor;
      return;
    }
    chunks.push({
      headingPath: headingStack.join(" > "),
      contentText: text,
      tokenCount: Math.max(1, Math.ceil(text.length / 4)),
      contentHash: createHash("sha256").update(text).digest("hex"),
      sourceOffsets: { start: bufferStart, end },
    });
    buffer = "";
    bufferStart = cursor;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush(cursor);
      const level = heading[1]!.length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2]!.trim();
    } else if (line.length > maxChars) {
      flush(cursor);
      for (let i = 0; i < line.length; i += maxChars) {
        const part = line.slice(i, i + maxChars);
        bufferStart = cursor + i;
        buffer = part;
        flush(cursor + i + part.length);
      }
    } else {
      if (!buffer) bufferStart = cursor;
      const next = buffer ? `${buffer}\n${line}` : line;
      if (next.length > maxChars) {
        flush(cursor);
        bufferStart = cursor;
        buffer = line;
      } else {
        buffer = next;
      }
    }
    cursor += rawLine.length + 1;
  }
  flush(input.contentText.length);

  return chunks.map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
}
```

- [ ] **Step 4: Run chunker test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/note-chunker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/note-chunker.ts apps/api/tests/lib/note-chunker.test.ts
git commit -m "feat(api): add deterministic note chunker"
```

---

## Task 3: Chunk Hybrid Search

**Files:**

- Create: `apps/api/src/lib/chunk-hybrid-search.ts`
- Test: `apps/api/tests/lib/chunk-hybrid-search.test.ts`

- [ ] **Step 1: Write failing test with mocked DB**

Create `apps/api/tests/lib/chunk-hybrid-search.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@opencairn/db", () => ({
  db: { execute },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const { projectChunkHybridSearch } = await import("../../src/lib/chunk-hybrid-search.js");

describe("projectChunkHybridSearch", () => {
  it("merges vector and full-text rows with active chunk filtering", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ id: "c1", note_id: "n1", title: "T", content_text: "alpha", score: 0.9 }] })
      .mockResolvedValueOnce({ rows: [{ id: "c1", note_id: "n1", title: "T", content_text: "alpha", score: 0.7 }] });

    const hits = await projectChunkHybridSearch({
      projectId: "p1",
      queryText: "alpha",
      queryEmbedding: [0.1, 0.2],
      k: 5,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ chunkId: "c1", noteId: "n1", title: "T" });
    expect(String(execute.mock.calls[0][0].strings.join(" "))).toContain("deleted_at IS NULL");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chunk-hybrid-search.test.ts
```

Expected: FAIL because `chunk-hybrid-search.ts` does not exist.

- [ ] **Step 3: Implement chunk search**

Create `apps/api/src/lib/chunk-hybrid-search.ts`:

```ts
import { db, sql } from "@opencairn/db";

const RRF_K = 60;
const SNIPPET_MAX = 500;

export type ChunkHybridHit = {
  chunkId: string;
  noteId: string;
  title: string;
  headingPath: string;
  snippet: string;
  vectorScore: number | null;
  bm25Score: number | null;
  rrfScore: number;
};

export type ChunkHybridSearchOpts = {
  projectId: string;
  queryText: string;
  queryEmbedding: number[];
  k: number;
};

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function clipSnippet(text: string | null): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  return compact.length > SNIPPET_MAX ? compact.slice(0, SNIPPET_MAX) + "..." : compact;
}

export async function projectChunkHybridSearch(opts: ChunkHybridSearchOpts): Promise<ChunkHybridHit[]> {
  const vec = vectorLiteral(opts.queryEmbedding);
  const fetchLimit = opts.k * 3;

  const [vectorRowsRaw, bm25RowsRaw] = await Promise.all([
    db.execute(sql`
      SELECT
        c.id,
        c.note_id,
        n.title,
        c.heading_path,
        c.content_text,
        1 - (c.embedding <=> ${vec}::vector) AS score
      FROM note_chunks c
      JOIN notes n ON n.id = c.note_id
      WHERE c.project_id = ${opts.projectId}
        AND c.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vec}::vector ASC
      LIMIT ${fetchLimit}
    `),
    db.execute(sql`
      SELECT
        c.id,
        c.note_id,
        n.title,
        c.heading_path,
        c.content_text,
        ts_rank(to_tsvector('simple', c.content_text), plainto_tsquery('simple', ${opts.queryText})) AS score
      FROM note_chunks c
      JOIN notes n ON n.id = c.note_id
      WHERE c.project_id = ${opts.projectId}
        AND c.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND to_tsvector('simple', c.content_text) @@ plainto_tsquery('simple', ${opts.queryText})
      ORDER BY score DESC
      LIMIT ${fetchLimit}
    `),
  ]);

  const vectorRows = (vectorRowsRaw as { rows?: Array<Record<string, unknown>> }).rows ?? (vectorRowsRaw as Array<Record<string, unknown>>);
  const bm25Rows = (bm25RowsRaw as { rows?: Array<Record<string, unknown>> }).rows ?? (bm25RowsRaw as Array<Record<string, unknown>>);
  const hits = new Map<string, ChunkHybridHit>();
  const rrf = new Map<string, number>();

  function add(row: Record<string, unknown>, rank: number, channel: "vector" | "bm25") {
    const chunkId = String(row.id);
    const rawScore = Number(row.score ?? 0);
    const existing = hits.get(chunkId);
    if (!existing) {
      hits.set(chunkId, {
        chunkId,
        noteId: String(row.note_id),
        title: String(row.title ?? "Untitled"),
        headingPath: String(row.heading_path ?? ""),
        snippet: clipSnippet(row.content_text as string | null),
        vectorScore: channel === "vector" ? rawScore : null,
        bm25Score: channel === "bm25" ? rawScore : null,
        rrfScore: 0,
      });
    } else if (channel === "vector") {
      existing.vectorScore = rawScore;
    } else {
      existing.bm25Score = rawScore;
    }
    rrf.set(chunkId, (rrf.get(chunkId) ?? 0) + 1 / (RRF_K + rank));
  }

  vectorRows.forEach((row, index) => add(row, index + 1, "vector"));
  bm25Rows.forEach((row, index) => add(row, index + 1, "bm25"));

  for (const [chunkId, score] of rrf) {
    const hit = hits.get(chunkId);
    if (hit) hit.rrfScore = score;
  }

  return Array.from(hits.values()).sort((a, b) => b.rrfScore - a.rrfScore).slice(0, opts.k);
}
```

- [ ] **Step 4: Run chunk search test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chunk-hybrid-search.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chunk-hybrid-search.ts apps/api/tests/lib/chunk-hybrid-search.test.ts
git commit -m "feat(api): search note chunks with hybrid retrieval"
```

---

## Task 4: Wire Chunk Search Into Chat Retrieval

**Files:**

- Modify: `apps/api/src/lib/chat-retrieval.ts`
- Modify: `apps/api/tests/lib/chat-retrieval.test.ts`

- [ ] **Step 1: Add failing chat retrieval test**

In `apps/api/tests/lib/chat-retrieval.test.ts`, mock `projectChunkHybridSearch` and add:

```ts
it("prefers chunk hits before falling back to note hits", async () => {
  chunkSearch.projectChunkHybridSearch.mockResolvedValue([
    {
      chunkId: "c1",
      noteId: "n1",
      title: "Chunked",
      headingPath: "Intro",
      snippet: "chunk hit",
      rrfScore: 1,
      vectorScore: 0.9,
      bm25Score: null,
    },
  ]);

  const hits = await retrieve({
    workspaceId: "ws1",
    query: "alpha",
    ragMode: "strict",
    scope: { type: "project", workspaceId: "ws1", projectId: "p1" },
    chips: [],
  });

  expect(hits[0]).toMatchObject({
    noteId: "n1",
    title: "Chunked",
    snippet: "chunk hit",
  });
});
```

Use the existing mock style in `chat-retrieval.test.ts`; do not introduce a second DB mock system.

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-retrieval.test.ts
```

Expected: FAIL until `retrieve()` calls chunk search.

- [ ] **Step 3: Modify retrieval**

In `apps/api/src/lib/chat-retrieval.ts`, import:

```ts
import { projectChunkHybridSearch } from "./chunk-hybrid-search";
```

In the project fanout path, call `projectChunkHybridSearch()` before `projectHybridSearch()`. If chunk hits exist for a project, map them to `RetrievalHit` and do not call note-level search for that project. If there are no chunk hits, call the existing note search fallback.

Mapping:

```ts
{
  noteId: h.noteId,
  title: h.headingPath ? `${h.title} · ${h.headingPath}` : h.title,
  snippet: h.snippet,
  score: h.rrfScore,
}
```

- [ ] **Step 4: Run chat retrieval tests**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-retrieval.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-retrieval.ts apps/api/tests/lib/chat-retrieval.test.ts
git commit -m "feat(api): prefer chunk retrieval for chat"
```

---

## Final Verification

Run:

```bash
pnpm --filter @opencairn/db test -- tests/note-chunks.test.ts
pnpm --filter @opencairn/api test -- tests/lib/note-chunker.test.ts tests/lib/chunk-hybrid-search.test.ts tests/lib/chat-retrieval.test.ts
pnpm --filter @opencairn/db build
pnpm --filter @opencairn/api build
git diff --check
```

Expected: all pass and `git diff --check` prints no output.
