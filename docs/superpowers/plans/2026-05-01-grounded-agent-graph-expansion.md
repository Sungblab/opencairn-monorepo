# Grounded Agent Graph Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded concept-graph expansion as a retrieval candidate channel without introducing Neo4j.

**Architecture:** Starting from seed chunk/note hits, resolve linked concepts, traverse 1-2 hops through existing Postgres graph tables, fetch readable related notes/chunks, and merge them into the retrieval candidate pool through RRF. Graph remains a recall booster, not the primary query engine.

**Tech Stack:** TypeScript, PostgreSQL recursive/limited queries, Drizzle/sql, existing `concepts`/graph schema, Vitest.

---

## File Structure

Create:

- `apps/api/src/lib/retrieval-graph-expansion.ts` — bounded graph expansion query and weights.
- `apps/api/tests/lib/retrieval-graph-expansion.test.ts`

Modify:

- `apps/api/src/lib/chunk-hybrid-search.ts` — accept graph candidate boosts or expose shared RRF merge helpers.
- `apps/api/src/lib/chat-retrieval.ts` — include graph-expanded candidates for `accurate`/`research` and eventually `expand`.
- `apps/api/tests/lib/chat-retrieval.test.ts`

No Neo4j, no new service, and no cross-workspace traversal.

---

## Task 1: Graph Expansion Query

**Files:**

- Create: `apps/api/src/lib/retrieval-graph-expansion.ts`
- Test: `apps/api/tests/lib/retrieval-graph-expansion.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/lib/retrieval-graph-expansion.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@opencairn/db", () => ({
  db: { execute },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const { expandGraphCandidates } = await import("../../src/lib/retrieval-graph-expansion.js");

describe("expandGraphCandidates", () => {
  it("queries only within workspace/project and bounded depth", async () => {
    execute.mockResolvedValueOnce({
      rows: [
        { note_id: "n2", chunk_id: "c2", title: "Related", content_text: "related snippet", graph_score: 0.8 },
      ],
    });

    const hits = await expandGraphCandidates({
      workspaceId: "ws1",
      projectId: "p1",
      seedNoteIds: ["n1"],
      maxDepth: 2,
      limit: 10,
    });

    expect(hits).toEqual([
      expect.objectContaining({ noteId: "n2", chunkId: "c2", graphScore: 0.8 }),
    ]);
    const query = String(execute.mock.calls[0][0].strings.join(" "));
    expect(query).toContain("workspace_id");
    expect(query).toContain("project_id");
    expect(query).toContain("deleted_at IS NULL");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/retrieval-graph-expansion.test.ts
```

Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement graph expansion**

Create `apps/api/src/lib/retrieval-graph-expansion.ts`:

```ts
import { db, sql } from "@opencairn/db";

export type GraphExpansionHit = {
  noteId: string;
  chunkId: string | null;
  title: string;
  snippet: string;
  graphScore: number;
};

export type GraphExpansionOpts = {
  workspaceId: string;
  projectId: string;
  seedNoteIds: string[];
  maxDepth?: 1 | 2;
  limit?: number;
};

export async function expandGraphCandidates(opts: GraphExpansionOpts): Promise<GraphExpansionHit[]> {
  if (opts.seedNoteIds.length === 0) return [];
  const maxDepth = opts.maxDepth ?? 2;
  const limit = opts.limit ?? 20;

  const rowsRaw = await db.execute(sql`
    WITH seed_concepts AS (
      SELECT DISTINCT cn.concept_id
      FROM concept_notes cn
      JOIN notes n ON n.id = cn.note_id
      WHERE cn.note_id = ANY(${opts.seedNoteIds})
        AND n.workspace_id = ${opts.workspaceId}
        AND n.project_id = ${opts.projectId}
        AND n.deleted_at IS NULL
    ),
    expanded AS (
      SELECT concept_id, 0 AS depth FROM seed_concepts
      UNION
      SELECT
        CASE WHEN ce.source_id = e.concept_id THEN ce.target_id ELSE ce.source_id END AS concept_id,
        e.depth + 1 AS depth
      FROM expanded e
      JOIN concept_edges ce ON ce.source_id = e.concept_id OR ce.target_id = e.concept_id
      WHERE e.depth < ${maxDepth}
    )
    SELECT
      n.id AS note_id,
      c.id AS chunk_id,
      n.title,
      COALESCE(c.content_text, n.content_text, '') AS content_text,
      MAX(1.0 / (1 + expanded.depth)) AS graph_score
    FROM expanded
    JOIN concept_notes cn ON cn.concept_id = expanded.concept_id
    JOIN notes n ON n.id = cn.note_id
    LEFT JOIN note_chunks c ON c.note_id = n.id AND c.deleted_at IS NULL
    WHERE n.workspace_id = ${opts.workspaceId}
      AND n.project_id = ${opts.projectId}
      AND n.deleted_at IS NULL
      AND NOT (n.id = ANY(${opts.seedNoteIds}))
    GROUP BY n.id, c.id, n.title, c.content_text, n.content_text
    ORDER BY graph_score DESC
    LIMIT ${limit}
  `);

  const rows = (rowsRaw as { rows?: Array<Record<string, unknown>> }).rows ?? (rowsRaw as Array<Record<string, unknown>>);
  return rows.map((r) => ({
    noteId: String(r.note_id),
    chunkId: r.chunk_id ? String(r.chunk_id) : null,
    title: String(r.title ?? "Untitled"),
    snippet: String(r.content_text ?? "").slice(0, 500),
    graphScore: Number(r.graph_score ?? 0),
  }));
}
```

These table names match the current Drizzle schema in `packages/db/src/schema/concepts.ts`.

- [ ] **Step 4: Run graph expansion test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/retrieval-graph-expansion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/retrieval-graph-expansion.ts apps/api/tests/lib/retrieval-graph-expansion.test.ts
git commit -m "feat(api): add bounded retrieval graph expansion"
```

---

## Task 2: Merge Graph Candidates Into Retrieval

**Files:**

- Modify: `apps/api/src/lib/chat-retrieval.ts`
- Modify: `apps/api/tests/lib/chat-retrieval.test.ts`

- [ ] **Step 1: Add failing test**

In `apps/api/tests/lib/chat-retrieval.test.ts`, mock `expandGraphCandidates()` and assert it is called when initial hits exist and `ragMode="expand"`:

```ts
it("adds graph expansion candidates in expand mode", async () => {
  chunkSearch.projectChunkHybridSearch.mockResolvedValue([
    { chunkId: "c1", noteId: "n1", title: "Seed", headingPath: "", snippet: "seed", rrfScore: 1 },
  ]);
  graphExpansion.expandGraphCandidates.mockResolvedValue([
    { chunkId: "c2", noteId: "n2", title: "Related", snippet: "related", graphScore: 0.5 },
  ]);

  const hits = await retrieve({
    workspaceId: "ws1",
    query: "alpha",
    ragMode: "expand",
    scope: { type: "project", workspaceId: "ws1", projectId: "p1" },
    chips: [],
  });

  expect(hits.map((h) => h.noteId)).toContain("n2");
  expect(graphExpansion.expandGraphCandidates).toHaveBeenCalledWith(
    expect.objectContaining({ seedNoteIds: ["n1"] }),
  );
});
```

- [ ] **Step 2: Run failing retrieval test**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-retrieval.test.ts
```

Expected: FAIL until retrieval calls graph expansion.

- [ ] **Step 3: Implement merge**

In `apps/api/src/lib/chat-retrieval.ts`, after seed hits per project are collected:

```ts
const graphHits =
  opts.ragMode === "expand" && seedHits.length > 0
    ? await expandGraphCandidates({
        workspaceId: opts.workspaceId,
        projectId,
        seedNoteIds: Array.from(new Set(seedHits.map((h) => h.noteId))),
        maxDepth: 2,
        limit: Math.max(k, 10),
      })
    : [];
```

Map graph hits to retrieval hits with lower base score than direct retrieval:

```ts
graphHits.map((h) => ({
  noteId: h.noteId,
  title: h.title,
  snippet: h.snippet,
  score: h.graphScore * 0.5,
}));
```

Deduplicate by `noteId + snippet` and sort by score descending before slicing.

- [ ] **Step 4: Run retrieval tests**

```bash
pnpm --filter @opencairn/api test -- tests/lib/chat-retrieval.test.ts tests/lib/retrieval-graph-expansion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat-retrieval.ts apps/api/tests/lib/chat-retrieval.test.ts
git commit -m "feat(api): merge graph-expanded retrieval candidates"
```

---

## Final Verification

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/retrieval-graph-expansion.test.ts tests/lib/chat-retrieval.test.ts
pnpm --filter @opencairn/api build
git diff --check
```

Expected: all pass.
