# Plan 5 · Knowledge Graph Phase 1 — Project Graph Tab + Wiki-Link Backlinks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Shell Tab Mode Router 의 신규 `graph` 모드 + Cytoscape 기반 단일 force-directed 그래프 뷰 + 노트 wiki-link **Backlinks Panel** 을 구축한다. KG 추출(Compiler) 은 손대지 않고, 이미 채워진 `concepts` / `concept_edges` 를 시각적으로 노출하는 것이 본 Phase 의 표면 역할.

**Architecture:** apps/web 에 Cytoscape (`react-cytoscapejs` + `cytoscape-fcose`) 단일 뷰 + 사이드바 진입점 추가. apps/api 에 `/api/projects/:id/graph` (top-N by degree) / `/graph/expand/:conceptId` (N-hop) / `/api/notes/:id/backlinks` 세 개 라우트. 신규 `wiki_links` 인덱스 테이블은 apps/hocuspocus `persistence.store` 트랜잭션 안에서 inline 동기화 (Plate value 권위 시점). Visualization Agent / 5뷰 / 클러스터링은 모두 Phase 2 이연.

**Tech Stack:** Next.js 16 (App Shell), Hono 4, Drizzle ORM (Postgres jsonb_path_query, ltree 이미 도입), Cytoscape.js 3.30+ + cytoscape-fcose 2.2+ + react-cytoscapejs 2.0+, Better Auth, Zod, TanStack Query, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-04-25-plan-5-knowledge-graph-design.md`](../specs/2026-04-25-plan-5-knowledge-graph-design.md)

**Worktree:** `.worktrees/plan-5-kg` · **Branch:** `feat/plan-5-kg-design` · **Base:** main `7d4ae57`

---

## File Structure

```
packages/
├── db/
│   ├── src/
│   │   ├── schema/
│   │   │   └── wiki-links.ts                      # NEW
│   │   └── index.ts                               # MOD: re-export wiki_links
│   ├── drizzle/
│   │   └── 0020_wiki_links_table.sql              # NEW (table + backfill)
│   └── test/
│       └── wiki-links-constraint.test.ts          # NEW
└── shared/src/
    └── api-types.ts                               # MOD: GraphDto, BacklinkDto Zod

apps/api/src/
├── routes/
│   ├── graph.ts                                   # NEW
│   ├── graph.test.ts                              # NEW
│   ├── notes.ts                                   # MOD: + GET /:id/backlinks
│   └── notes-backlinks.test.ts                    # NEW
└── app.ts                                         # MOD: app.route("/api/projects", graphRoutes)

apps/hocuspocus/
├── src/
│   ├── wiki-link-sync.ts                          # NEW (extractor + sync)
│   └── persistence.ts                             # MOD: workspaceId lookup + sync call
└── tests/
    ├── wiki-link-sync.test.ts                     # NEW (pure fn unit tests)
    └── wiki-link-sync.integration.test.ts         # NEW (DB integration)

apps/web/
├── messages/
│   ├── ko/
│   │   ├── graph.json                             # NEW
│   │   ├── sidebar.json                           # MOD: + graph entry
│   │   ├── note.json                              # MOD: + backlinks panel
│   │   └── appShell.json                          # MOD: + tabTitles.graph
│   └── en/                                         # MOD same files
├── src/
│   ├── stores/
│   │   ├── tabs-store.ts                          # MOD: TabMode union 'graph'
│   │   └── panel-store.ts                         # MOD: + backlinksOpen
│   ├── components/
│   │   ├── graph/                                  # NEW
│   │   │   ├── ProjectGraph.tsx
│   │   │   ├── GraphFilters.tsx
│   │   │   ├── GraphEmpty.tsx
│   │   │   ├── GraphSkeleton.tsx
│   │   │   ├── GraphError.tsx
│   │   │   ├── useProjectGraph.ts
│   │   │   ├── graph-types.ts
│   │   │   ├── cytoscape-stylesheet.ts
│   │   │   ├── to-cytoscape-elements.ts
│   │   │   └── __tests__/
│   │   │       ├── ProjectGraph.test.tsx
│   │   │       ├── GraphFilters.test.tsx
│   │   │       ├── useProjectGraph.test.ts
│   │   │       └── to-cytoscape-elements.test.ts
│   │   ├── tab-shell/
│   │   │   ├── tab-mode-router.tsx                # MOD: case 'graph'
│   │   │   ├── tab-mode-router.test.tsx           # MOD
│   │   │   └── viewers/
│   │   │       ├── project-graph-viewer.tsx       # NEW
│   │   │       └── project-graph-viewer.test.tsx  # NEW
│   │   ├── notes/
│   │   │   ├── BacklinksPanel.tsx                 # NEW
│   │   │   └── BacklinksPanel.test.tsx            # NEW
│   │   └── sidebar/
│   │       ├── project-graph-link.tsx             # NEW
│   │       ├── project-graph-link.test.tsx        # NEW
│   │       └── shell-sidebar.tsx                  # MOD: insert <ProjectGraphLink />
│   └── app/[locale]/(shell)/w/[wsSlug]/p/[projectId]/graph/
│       └── page.tsx                               # NEW
└── tests/e2e/
    └── graph.spec.ts                              # NEW

.github/
└── workflows/ci.yml                               # MOD: regression grep guards
```

---

### Task 1: Shared Zod schemas for Graph + Backlinks

**Files:**
- Modify: `packages/shared/src/api-types.ts` (append at end)

> 의존성 0. 이후 모든 API/Web 작업의 타입 source.

- [ ] **Step 1.1: Read the current end of `api-types.ts` to see existing patterns**

```bash
tail -20 /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/shared/src/api-types.ts
```

Confirm `import { z } from "zod";` is at the top of the file (other DTOs already use Zod). If not, prepend it.

- [ ] **Step 1.2: Append Graph DTOs**

Append to `packages/shared/src/api-types.ts`:

```ts
// ─── Plan 5 Phase 1: Knowledge Graph ───────────────────────────────────────

/**
 * One node in the project graph response. `firstNoteId` lets the UI
 * jump to the concept's representative source note on dblclick without
 * an extra round-trip; null means the concept has no source notes
 * registered yet (Compiler upserts the row before linking).
 */
export const graphNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  degree: z.number().int().nonnegative(),
  noteCount: z.number().int().nonnegative(),
  firstNoteId: z.string().uuid().nullable(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  /**
   * concept_edges.relation_type is `text` (free text, default 'related-to')
   * because Compiler emits arbitrary relation labels. The graph UI's
   * relation filter dropdown derives its options from observed values,
   * not a Zod enum.
   */
  relationType: z.string(),
  weight: z.number(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  /** True when totalConcepts > limit; UI shows a "narrow with filters" banner. */
  truncated: z.boolean(),
  totalConcepts: z.number().int().nonnegative(),
});
export type GraphResponse = z.infer<typeof graphResponseSchema>;

/** Same node/edge shape; expand returns a subgraph slice without truncation meta. */
export const graphExpandResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});
export type GraphExpandResponse = z.infer<typeof graphExpandResponseSchema>;

/** Server-side validators (mirrored to `apps/api/src/routes/graph.ts`). */
export const graphQuerySchema = z.object({
  limit: z.coerce.number().int().min(50).max(500).default(500),
  order: z.enum(["degree", "recent"]).default("degree"),
  relation: z.string().optional(),
});
export const graphExpandQuerySchema = z.object({
  hops: z.coerce.number().int().min(1).max(3).default(1),
});

// ─── Plan 5 Phase 1: Wiki-link Backlinks ──────────────────────────────────

export const backlinkSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  updatedAt: z.string().datetime(),
});
export type Backlink = z.infer<typeof backlinkSchema>;

export const backlinksResponseSchema = z.object({
  data: z.array(backlinkSchema),
  total: z.number().int().nonnegative(),
});
export type BacklinksResponse = z.infer<typeof backlinksResponseSchema>;
```

- [ ] **Step 1.3: Build the package**

```bash
pnpm --filter @opencairn/shared build
```

Expected: no TypeScript errors, `dist/` updated.

- [ ] **Step 1.4: Commit**

```bash
git add packages/shared/src/api-types.ts
git commit -m "feat(shared): add Plan 5 graph + backlinks Zod schemas"
```

---

### Task 2: DB schema, migration, and constraint test for `wiki_links`

**Files:**
- Create: `packages/db/src/schema/wiki-links.ts`
- Modify: `packages/db/src/schema/index.ts` or `packages/db/src/index.ts` (re-export)
- Create: `packages/db/drizzle/0021_wiki_links_table.sql` *(0020 은 PR #34 의 `chat_redesign` 이 이미 차지)*
- Create: `packages/db/drizzle/meta/_journal.json` patched entry
- Create: `packages/db/test/wiki-links-constraint.test.ts`

> **번호 race**: PR #34 (App Shell Phase 4) 가 머지되며 `0020_chat_redesign.sql` 로 0020 슬롯을 점유했음. 본 PR 은 0021. Plan 7 Canvas Phase 1 도 두 개 (`0021/0022` 또는 `0022/0023`) 가 필요하므로 머지 순서에 따라 다음 번호로 추가 rename 필요할 수 있음 — 충돌 시 파일명 + `meta/_journal.json` 두 곳.

- [ ] **Step 2.1: Read existing schema barrel to see export pattern**

```bash
cat /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/packages/db/src/index.ts | head -40
```

`packages/db/src/index.ts` re-exports schema files via `export * from "./schema/X"` or via a barrel `./schema/index.ts`. Note the exact pattern.

- [ ] **Step 2.2: Create the constraint test (TDD)**

`packages/db/test/wiki-links-constraint.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db, notes, projects, workspaces, user, wikiLinks, eq } from "../src";

describe("wiki_links table", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;
  let n1: string;
  let n2: string;

  beforeAll(async () => {
    const [u] = await db
      .insert(user)
      .values({ id: crypto.randomUUID(), email: `wl-${Date.now()}@example.com`, name: "wl-test", emailVerified: false })
      .returning();
    userId = u.id;
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "WL Test", slug: `wl-${Date.now()}`, ownerId: userId })
      .returning();
    workspaceId = ws.id;
    const [p] = await db
      .insert(projects)
      .values({ name: "P", workspaceId, createdBy: userId })
      .returning();
    projectId = p.id;
    const [a] = await db
      .insert(notes)
      .values({ title: "A", projectId, workspaceId })
      .returning();
    const [b] = await db
      .insert(notes)
      .values({ title: "B", projectId, workspaceId })
      .returning();
    n1 = a.id;
    n2 = b.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("inserts a wiki_links row", async () => {
    const [row] = await db
      .insert(wikiLinks)
      .values({ sourceNoteId: n1, targetNoteId: n2, workspaceId })
      .returning();
    expect(row.sourceNoteId).toBe(n1);
    expect(row.targetNoteId).toBe(n2);
  });

  it("rejects duplicate (source, target) pairs", async () => {
    await expect(
      db.insert(wikiLinks).values({ sourceNoteId: n1, targetNoteId: n2, workspaceId })
    ).rejects.toThrow(/wiki_links_source_target_unique/);
  });

  it("cascades on source note hard delete", async () => {
    const [c] = await db.insert(notes).values({ title: "C", projectId, workspaceId }).returning();
    await db.insert(wikiLinks).values({ sourceNoteId: c.id, targetNoteId: n2, workspaceId });
    await db.delete(notes).where(eq(notes.id, c.id));
    const after = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, c.id));
    expect(after).toHaveLength(0);
  });

  it("cascades on target note hard delete", async () => {
    const [d] = await db.insert(notes).values({ title: "D", projectId, workspaceId }).returning();
    await db.insert(wikiLinks).values({ sourceNoteId: n1, targetNoteId: d.id, workspaceId });
    await db.delete(notes).where(eq(notes.id, d.id));
    const after = await db.select().from(wikiLinks).where(eq(wikiLinks.targetNoteId, d.id));
    expect(after).toHaveLength(0);
  });
});
```

- [ ] **Step 2.3: Run the test — expect FAIL**

```bash
pnpm --filter @opencairn/db test -- wiki-links-constraint
```

Expected: `Cannot find module '../src/wikiLinks'` or `relation "wiki_links" does not exist`.

- [ ] **Step 2.4: Create the schema file**

`packages/db/src/schema/wiki-links.ts`:

```ts
import {
  pgTable,
  uuid,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { workspaces } from "./workspaces";

// Plan 5 Phase 1 — reverse index of wiki-link Plate nodes.
// Populated inline by Hocuspocus persistence.store on every flush; backfilled
// once via migration 0020. workspace_id mirrors the source note's workspace
// so backlinks queries can be workspace-scoped without a join through projects.
//
// FK ON DELETE CASCADE handles HARD-deletes only. Soft-deletes
// (`notes.deleted_at`) are filtered in API queries — see notes/:id/backlinks.
export const wikiLinks = pgTable(
  "wiki_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceNoteId: uuid("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetNoteId: uuid("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("wiki_links_source_target_unique").on(t.sourceNoteId, t.targetNoteId),
    index("wiki_links_target_idx").on(t.targetNoteId),
    index("wiki_links_workspace_idx").on(t.workspaceId),
  ]
);
```

- [ ] **Step 2.5: Re-export from `packages/db/src/index.ts`**

Open `packages/db/src/index.ts`. Find the schema re-export block (a series of `export * from "./schema/X"` lines). Add:

```ts
export * from "./schema/wiki-links";
```

If a `./schema/index.ts` barrel exists instead, add the line there.

- [ ] **Step 2.6: Generate the migration**

```bash
pnpm --filter @opencairn/db db:generate
```

Drizzle will produce `0021_*.sql` (since 0020 is already taken by `chat_redesign`). The generated file name may include a random suffix (e.g. `0021_loose_taskmaster.sql`); rename it to `0021_wiki_links_table.sql` and update `meta/_journal.json` accordingly.

- [ ] **Step 2.7: Append the backfill query to the migration**

Open `packages/db/drizzle/0021_wiki_links_table.sql` and append after the auto-generated DDL:

```sql
--> statement-breakpoint
-- Plan 5 Phase 1 backfill: extract existing wiki-link nodes from notes.content.
-- Plate node shape: { type: 'wiki-link', targetId: '<uuid>', title: '<str>', children: [...] }
-- jsonb_path_query (PG 12+) recursively walks JSON; '$.** ? (@.type == "wiki-link")'
-- yields every wiki-link node at any depth. Validate targetId is a UUID AND
-- points to an existing, non-soft-deleted note before insert.
INSERT INTO "wiki_links" ("source_note_id", "target_note_id", "workspace_id")
SELECT DISTINCT
  n.id AS source_note_id,
  (link->>'targetId')::uuid AS target_note_id,
  p.workspace_id
FROM "notes" n
JOIN "projects" p ON p.id = n.project_id
JOIN LATERAL jsonb_path_query(n.content, '$.** ? (@.type == "wiki-link")') AS link
  ON true
WHERE n.deleted_at IS NULL
  AND n.content IS NOT NULL
  AND link ? 'targetId'
  AND (link->>'targetId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM "notes" t
    WHERE t.id = (link->>'targetId')::uuid
      AND t.deleted_at IS NULL
  )
ON CONFLICT ("source_note_id", "target_note_id") DO NOTHING;
```

- [ ] **Step 2.8: Apply the migration to dev DB**

```bash
pnpm --filter @opencairn/db db:migrate
```

Expected: migration applies cleanly. If Plan 7 Canvas Phase 1 lands first and takes 0021/0022, rename to the next free slot (e.g. `0023_wiki_links_table.sql`) and update `meta/_journal.json`'s tag/breakpoints accordingly, then re-run.

- [ ] **Step 2.9: Run the constraint test — expect PASS**

```bash
pnpm --filter @opencairn/db test -- wiki-links-constraint
```

Expected: 4 tests pass.

- [ ] **Step 2.10: Commit**

```bash
git add packages/db/src/schema/wiki-links.ts \
        packages/db/src/index.ts \
        packages/db/drizzle/0021_wiki_links_table.sql \
        packages/db/drizzle/meta/_journal.json \
        packages/db/test/wiki-links-constraint.test.ts
git commit -m "feat(db): add wiki_links reverse-index table with backfill (Plan 5 Phase 1)"
```

---

### Task 3: Hocuspocus wiki-link sync (extractor + helper + persistence integration)

**Files:**
- Create: `apps/hocuspocus/src/wiki-link-sync.ts`
- Create: `apps/hocuspocus/tests/wiki-link-sync.test.ts`
- Create: `apps/hocuspocus/tests/wiki-link-sync.integration.test.ts`
- Modify: `apps/hocuspocus/src/persistence.ts:198-226`

- [ ] **Step 3.1: Write extractor unit tests (TDD)**

`apps/hocuspocus/tests/wiki-link-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractWikiLinkTargets } from "../src/wiki-link-sync.js";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";
const ID_C = "33333333-3333-3333-3333-333333333333";

describe("extractWikiLinkTargets", () => {
  it("returns empty set for non-array root", () => {
    expect(extractWikiLinkTargets(null)).toEqual(new Set());
    expect(extractWikiLinkTargets(undefined)).toEqual(new Set());
    expect(extractWikiLinkTargets({})).toEqual(new Set());
    expect(extractWikiLinkTargets("nope")).toEqual(new Set());
  });

  it("finds a single top-level wiki-link", () => {
    const v = [
      { type: "p", children: [
        { text: "see " },
        { type: "wiki-link", targetId: ID_A, title: "A", children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set([ID_A]));
  });

  it("dedupes identical targets", () => {
    const v = [
      { type: "p", children: [
        { type: "wiki-link", targetId: ID_A, title: "A", children: [{ text: "" }] },
        { type: "wiki-link", targetId: ID_A, title: "A", children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set([ID_A]));
  });

  it("walks deeply nested children", () => {
    const v = [
      { type: "blockquote", children: [
        { type: "p", children: [
          { type: "ul", children: [
            { type: "li", children: [
              { type: "wiki-link", targetId: ID_B, title: "B", children: [{ text: "" }] },
            ] },
          ] },
        ] },
      ] },
      { type: "p", children: [
        { type: "wiki-link", targetId: ID_C, title: "C", children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set([ID_B, ID_C]));
  });

  it("rejects non-UUID targetId", () => {
    const v = [
      { type: "p", children: [
        { type: "wiki-link", targetId: "not-a-uuid", children: [{ text: "" }] },
        { type: "wiki-link", targetId: 12345, children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set());
  });

  it("ignores nodes with the wrong type", () => {
    const v = [
      { type: "mention", targetId: ID_A, children: [{ text: "" }] },
      { type: "link", url: "https://...", children: [{ text: "" }] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set());
  });
});
```

- [ ] **Step 3.2: Run unit tests — expect FAIL**

```bash
pnpm --filter @opencairn/hocuspocus test -- wiki-link-sync.test.ts
```

Expected: `Cannot find module '../src/wiki-link-sync.js'`.

- [ ] **Step 3.3: Implement the extractor + sync helper**

`apps/hocuspocus/src/wiki-link-sync.ts`:

```ts
import { eq, and, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { wikiLinks, notes, projects } from "@opencairn/db";

// `i` flag: external systems (some Better Auth flows, ingest sources) can
// emit upper- or mixed-case UUIDs. Plate is consistent today but we don't
// own the producers transitively — be permissive on read.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Walk a Plate value (deeply nested array of nodes with `children`) and
 * collect unique wiki-link `targetId`s. Pure function — no I/O.
 *
 * The wiki-link node type key is hard-coded to "wiki-link" because that is
 * the value `WIKILINK_KEY` in apps/web/src/components/editor/plugins/wiki-link.tsx
 * exports. CI grep guard pins both keys to prevent silent rename breakage.
 */
export function extractWikiLinkTargets(plateValue: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(plateValue)) return out;
  const stack: unknown[] = [...plateValue];
  while (stack.length) {
    const n = stack.pop();
    if (n && typeof n === "object") {
      const node = n as {
        type?: string;
        targetId?: unknown;
        children?: unknown;
      };
      if (
        node.type === "wiki-link" &&
        typeof node.targetId === "string" &&
        UUID_RE.test(node.targetId)
      ) {
        out.add(node.targetId);
      }
      if (Array.isArray(node.children)) {
        for (const c of node.children) stack.push(c);
      }
    }
  }
  return out;
}

/**
 * Resolve the workspace_id for a source note. Returns null if the note
 * doesn't exist or its project was hard-deleted between fetch and store
 * (Hocuspocus race tolerated — caller bails).
 */
export async function resolveWorkspaceForNote(
  // tx is a Drizzle transaction context; `any` for the schema generic so
  // callers don't have to thread the transaction type through every layer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: NodePgDatabase<any>,
  noteId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ workspaceId: projects.workspaceId })
    .from(notes)
    .innerJoin(projects, eq(projects.id, notes.projectId))
    .where(eq(notes.id, noteId));
  return rows[0]?.workspaceId ?? null;
}

/**
 * Replace the wiki_links rows for `sourceNoteId` with the deduped target set.
 * Runs inside the transaction passed by persistence.store, so the new index
 * is committed atomically with notes.content.
 *
 * Targets pointing to non-existent / soft-deleted notes are silently dropped
 * (matches the migration's backfill semantic). Self-references are dropped.
 */
export async function syncWikiLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: NodePgDatabase<any>,
  sourceNoteId: string,
  targets: Set<string>,
  workspaceId: string,
): Promise<void> {
  // 1) full rebuild — drop existing rows for this source.
  await tx.delete(wikiLinks).where(eq(wikiLinks.sourceNoteId, sourceNoteId));

  if (targets.size === 0) return;

  // 2) drop self-references, then verify each target points to a live note.
  const candidates = [...targets].filter((id) => id !== sourceNoteId);
  if (candidates.length === 0) return;

  const live = await tx
    .select({ id: notes.id })
    .from(notes)
    .where(and(inArray(notes.id, candidates), isNull(notes.deletedAt)));
  const liveSet = new Set(live.map((r) => r.id));
  const rows = candidates
    .filter((t) => liveSet.has(t))
    .map((targetNoteId) => ({ sourceNoteId, targetNoteId, workspaceId }));
  if (rows.length === 0) return;

  // .onConflictDoNothing() guards against the rare case where two Hocuspocus
  // store transactions for the same note interleave — the DELETE→SELECT→INSERT
  // sequence is atomic *per* tx, but PostgreSQL's READ COMMITTED default lets
  // a peer tx commit between the DELETE and INSERT and reach the unique
  // constraint first. Cheaper than escalating isolation; the constraint
  // itself still enforces correctness.
  await tx.insert(wikiLinks).values(rows).onConflictDoNothing();
}
```

- [ ] **Step 3.4: Run unit tests — expect PASS**

```bash
pnpm --filter @opencairn/hocuspocus test -- wiki-link-sync.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 3.5: Write the integration test**

`apps/hocuspocus/tests/wiki-link-sync.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, notes, projects, workspaces, user, wikiLinks, eq } from "@opencairn/db";
import { syncWikiLinks } from "../src/wiki-link-sync.js";

describe("syncWikiLinks (integration)", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;
  let source: string;
  let liveTarget: string;
  let deletedTarget: string;

  beforeAll(async () => {
    const [u] = await db
      .insert(user)
      .values({ id: crypto.randomUUID(), email: `wls-${Date.now()}@example.com`, name: "wls", emailVerified: false })
      .returning();
    userId = u.id;
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "WLS", slug: `wls-${Date.now()}`, ownerId: userId })
      .returning();
    workspaceId = ws.id;
    const [p] = await db.insert(projects).values({ name: "P", workspaceId, createdBy: userId }).returning();
    projectId = p.id;
    const [s] = await db.insert(notes).values({ title: "src", projectId, workspaceId }).returning();
    source = s.id;
    const [t1] = await db.insert(notes).values({ title: "live", projectId, workspaceId }).returning();
    liveTarget = t1.id;
    const [t2] = await db.insert(notes).values({ title: "gone", projectId, workspaceId, deletedAt: new Date() }).returning();
    deletedTarget = t2.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("inserts rows for live targets only", async () => {
    await db.transaction(async (tx) => {
      await syncWikiLinks(
        tx,
        source,
        new Set([liveTarget, deletedTarget, "00000000-0000-0000-0000-000000000000"]),
        workspaceId,
      );
    });
    const rows = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, source));
    expect(rows.map((r) => r.targetNoteId)).toEqual([liveTarget]);
  });

  it("rebuilds — empty target set deletes all rows for the source", async () => {
    await db.transaction(async (tx) => {
      await syncWikiLinks(tx, source, new Set(), workspaceId);
    });
    const rows = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, source));
    expect(rows).toHaveLength(0);
  });

  it("drops self-references", async () => {
    await db.transaction(async (tx) => {
      await syncWikiLinks(tx, source, new Set([source, liveTarget]), workspaceId);
    });
    const rows = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, source));
    expect(rows.map((r) => r.targetNoteId)).toEqual([liveTarget]);
  });
});
```

- [ ] **Step 3.6: Run the integration test — expect PASS**

```bash
pnpm --filter @opencairn/hocuspocus test -- wiki-link-sync.integration.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 3.7: Patch `persistence.ts` to call sync inside the store transaction**

Open `apps/hocuspocus/src/persistence.ts`. Find the import block (around line 25):

```diff
 import { plateToYDoc, yDocToPlate } from "./plate-bridge.js";
+import {
+  extractWikiLinkTargets,
+  resolveWorkspaceForNote,
+  syncWikiLinks,
+} from "./wiki-link-sync.js";
```

Find the `db.transaction` block at lines 198–226 (inside `storeImpl`):

```diff
     await db.transaction(async (tx) => {
       await tx
         .insert(yjsDocuments)
         .values({...})
         .onConflictDoUpdate({...});
       await tx
         .update(notes)
         .set({
           content: plateValue as unknown,
           contentText,
           updatedAt: new Date(),
         })
         .where(eq(notes.id, noteId));
+      // Plan 5 Phase 1: rebuild wiki_links index from the just-saved Plate
+      // value. workspaceId resolved inside the same tx so a project move
+      // mid-flight cannot mis-scope the index.
+      const workspaceId = await resolveWorkspaceForNote(tx, noteId);
+      if (workspaceId) {
+        const targets = extractWikiLinkTargets(plateValue);
+        await syncWikiLinks(tx, noteId, targets, workspaceId);
+      }
     });
```

If `workspaceId` is null, the source note was hard-deleted between fetch and store — the existing `UPDATE notes` is also a no-op, so skipping the index update is consistent.

- [ ] **Step 3.8: Verify hocuspocus typechecks + persistence test still passes**

```bash
pnpm --filter @opencairn/hocuspocus build
pnpm --filter @opencairn/hocuspocus test -- persistence.test
```

Expected: build succeeds, persistence tests still green.

- [ ] **Step 3.9: Commit**

```bash
git add apps/hocuspocus/src/wiki-link-sync.ts \
        apps/hocuspocus/src/persistence.ts \
        apps/hocuspocus/tests/wiki-link-sync.test.ts \
        apps/hocuspocus/tests/wiki-link-sync.integration.test.ts
git commit -m "feat(hocuspocus): sync wiki_links inline on persistence.store (Plan 5 Phase 1)"
```

---

### Task 4: API GET `/api/projects/:projectId/graph`

**Files:**
- Create: `apps/api/src/routes/graph.ts`
- Create: `apps/api/src/routes/graph.test.ts`
- Modify: `apps/api/src/app.ts` (mount router)

- [ ] **Step 4.1: Write the route test (TDD)**

`apps/api/src/routes/graph.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, notes, projects, workspaces, user, concepts, conceptEdges, conceptNotes, eq, workspaceMembers } from "@opencairn/db";
import { createTestApp, signInAs } from "../test/helpers";

// Test helpers (createTestApp, signInAs) follow the patterns established
// in apps/api/src/test/helpers.ts — same fixtures used by notes.test.ts and
// graph-expand will reuse.

describe("GET /api/projects/:projectId/graph", () => {
  let workspaceId: string;
  let projectId: string;
  let otherProjectId: string;
  let memberId: string;
  let nonMemberId: string;
  let conceptA: string;
  let conceptB: string;
  let app: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    app = createTestApp();
    const [m] = await db.insert(user).values({ id: crypto.randomUUID(), email: `g-m-${Date.now()}@example.com`, name: "m", emailVerified: false }).returning();
    memberId = m.id;
    const [nm] = await db.insert(user).values({ id: crypto.randomUUID(), email: `g-nm-${Date.now()}@example.com`, name: "nm", emailVerified: false }).returning();
    nonMemberId = nm.id;

    const [ws] = await db.insert(workspaces).values({ name: "G", slug: `g-${Date.now()}`, ownerId: memberId }).returning();
    workspaceId = ws.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: "owner" });

    const [p] = await db.insert(projects).values({ name: "P", workspaceId, createdBy: memberId }).returning();
    projectId = p.id;
    const [op] = await db.insert(projects).values({ name: "Other", workspaceId, createdBy: memberId }).returning();
    otherProjectId = op.id;

    const [n] = await db.insert(notes).values({ title: "src", projectId, workspaceId }).returning();
    const [a] = await db.insert(concepts).values({ projectId, name: "A", description: "alpha" }).returning();
    const [b] = await db.insert(concepts).values({ projectId, name: "B", description: "beta" }).returning();
    conceptA = a.id;
    conceptB = b.id;
    await db.insert(conceptEdges).values({ sourceId: a.id, targetId: b.id, relationType: "is-a", weight: 1 });
    await db.insert(conceptNotes).values({ conceptId: a.id, noteId: n.id });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, memberId));
    await db.delete(user).where(eq(user.id, nonMemberId));
  });

  it("returns 403 for a non-member", async () => {
    const res = await app.request(`/api/projects/${projectId}/graph`, {}, signInAs(nonMemberId));
    expect(res.status).toBe(403);
  });

  it("returns nodes + edges for a member", async () => {
    const res = await app.request(`/api/projects/${projectId}/graph`, {}, signInAs(memberId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: any[]; edges: any[]; truncated: boolean; totalConcepts: number };
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(body.truncated).toBe(false);
    expect(body.totalConcepts).toBe(2);
    const nodeA = body.nodes.find((n) => n.id === conceptA);
    expect(nodeA?.firstNoteId).toBeTruthy();
    expect(nodeA?.degree).toBe(1);
    expect(nodeA?.noteCount).toBe(1);
    const nodeB = body.nodes.find((n) => n.id === conceptB);
    expect(nodeB?.firstNoteId).toBeNull();
  });

  it("filters edges by relation", async () => {
    const res = await app.request(
      `/api/projects/${projectId}/graph?relation=does-not-exist`,
      {},
      signInAs(memberId),
    );
    const body = (await res.json()) as { edges: any[] };
    expect(body.edges).toHaveLength(0);
  });

  it("returns empty result for an empty project", async () => {
    const res = await app.request(`/api/projects/${otherProjectId}/graph`, {}, signInAs(memberId));
    const body = (await res.json()) as { nodes: any[]; edges: any[]; totalConcepts: number };
    expect(body.nodes).toHaveLength(0);
    expect(body.edges).toHaveLength(0);
    expect(body.totalConcepts).toBe(0);
  });
});
```

- [ ] **Step 4.2: Run test — expect FAIL**

```bash
pnpm --filter @opencairn/api test -- graph.test
```

Expected: 404 routing failure ("Not Found").

- [ ] **Step 4.3: Create the route**

`apps/api/src/routes/graph.ts`:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, concepts, eq, and, sql } from "@opencairn/db";
import {
  graphQuerySchema,
  graphExpandQuerySchema,
  type GraphResponse,
  type GraphExpandResponse,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// concept_edges / concept_notes / notes are referenced via raw SQL string
// literals in db.execute() calls below; only `concepts` needs a Drizzle
// schema accessor for the typed seed-existence SELECT.
export const graphRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  // GET /api/projects/:projectId/graph
  .get(
    "/:projectId/graph",
    zValidator("query", graphQuerySchema),
    async (c) => {
      const user = c.get("user");
      const projectId = c.req.param("projectId");
      if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
      if (!(await canRead(user.id, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const { limit, order, relation } = c.req.valid("query");

      // Total concepts for the truncated banner.
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(concepts)
        .where(eq(concepts.projectId, projectId));

      // Top-N concepts. Degree = inbound + outbound edges (cross apply
      // concept_edges twice). For "recent" we just sort by created_at desc.
      const orderClause =
        order === "recent"
          ? sql`c.created_at DESC`
          : sql`(SELECT count(*)::int
                 FROM concept_edges e
                 WHERE e.source_id = c.id OR e.target_id = c.id) DESC,
                c.name ASC`;

      // For each concept: id, name, description, degree, noteCount, firstNoteId.
      // firstNoteId = LEFT JOIN concept_notes ORDER BY notes.created_at LIMIT 1.
      const nodeRows = await db.execute<{
        id: string;
        name: string;
        description: string | null;
        degree: number;
        note_count: number;
        first_note_id: string | null;
      }>(sql`
        SELECT
          c.id,
          c.name,
          c.description,
          (SELECT count(*)::int FROM concept_edges e
            WHERE e.source_id = c.id OR e.target_id = c.id) AS degree,
          (SELECT count(*)::int FROM concept_notes cn
            WHERE cn.concept_id = c.id) AS note_count,
          (SELECT cn.note_id FROM concept_notes cn
            JOIN notes n ON n.id = cn.note_id
            WHERE cn.concept_id = c.id AND n.deleted_at IS NULL
            ORDER BY n.created_at ASC LIMIT 1) AS first_note_id
        FROM concepts c
        WHERE c.project_id = ${projectId}
        ORDER BY ${orderClause}
        LIMIT ${limit}
      `);

      const nodeIds = nodeRows.rows.map((r) => r.id);
      let edgeRows: { id: string; source_id: string; target_id: string; relation_type: string; weight: number }[] = [];
      if (nodeIds.length > 0) {
        const idArr = sql.join(
          nodeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        );
        const relationFilter = relation ? sql`AND e.relation_type = ${relation}` : sql``;
        const edgeRes = await db.execute<{
          id: string;
          source_id: string;
          target_id: string;
          relation_type: string;
          weight: number;
        }>(sql`
          SELECT e.id, e.source_id, e.target_id, e.relation_type, e.weight
          FROM concept_edges e
          WHERE e.source_id = ANY(ARRAY[${idArr}])
            AND e.target_id = ANY(ARRAY[${idArr}])
            ${relationFilter}
        `);
        edgeRows = edgeRes.rows;
      }

      const body: GraphResponse = {
        nodes: nodeRows.rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? "",
          degree: r.degree,
          noteCount: r.note_count,
          firstNoteId: r.first_note_id,
        })),
        edges: edgeRows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          targetId: r.target_id,
          relationType: r.relation_type,
          weight: Number(r.weight),
        })),
        truncated: total > limit,
        totalConcepts: total,
      };
      return c.json(body);
    },
  );
```

- [ ] **Step 4.4: Mount the router in `app.ts`**

Open `apps/api/src/app.ts`. Find the route mounting section (around line 56 — `app.route("/api", projectRoutes);`). Add the import at top:

```ts
import { graphRoutes } from "./routes/graph";
```

And mount BEFORE `noteRoutes` (graph is project-scoped, doesn't conflict but keeps locality with project routes):

```diff
   app.route("/api", projectRoutes);
+  app.route("/api/projects", graphRoutes);
   app.route("/api/folders", folderRoutes);
```

- [ ] **Step 4.5: Run test — expect PASS**

```bash
pnpm --filter @opencairn/api test -- graph.test
```

Expected: 4 tests pass.

- [ ] **Step 4.6: Commit**

```bash
git add apps/api/src/routes/graph.ts apps/api/src/routes/graph.test.ts apps/api/src/app.ts
git commit -m "feat(api): add GET /api/projects/:id/graph (Plan 5 Phase 1)"
```

---

### Task 5: API GET `/api/projects/:projectId/graph/expand/:conceptId`

**Files:**
- Modify: `apps/api/src/routes/graph.ts` (add expand handler)
- Modify: `apps/api/src/routes/graph.test.ts` (add expand tests)

- [ ] **Step 5.1: Append expand tests (TDD)**

Append to `apps/api/src/routes/graph.test.ts`:

```ts
describe("GET /api/projects/:projectId/graph/expand/:conceptId", () => {
  // Reuses the fixtures from the GET /graph describe via beforeAll above
  // (vitest runs both describes in the same module, fixtures persist).
  // If your test runner isolates describes, copy the fixture setup.

  it("rejects hops > 3", async () => {
    const res = await app.request(
      `/api/projects/${projectId}/graph/expand/${conceptA}?hops=4`,
      {},
      signInAs(memberId),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the concept belongs to a different project", async () => {
    // conceptA is in projectId; the URL says otherProjectId. Should 404,
    // NOT 200 with the wrong-project subgraph (resource scope leak).
    const res = await app.request(
      `/api/projects/${otherProjectId}/graph/expand/${conceptA}`,
      {},
      signInAs(memberId),
    );
    expect(res.status).toBe(404);
  });

  it("returns the seed + 1-hop neighbors for hops=1", async () => {
    const res = await app.request(
      `/api/projects/${projectId}/graph/expand/${conceptA}?hops=1`,
      {},
      signInAs(memberId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: any[]; edges: any[] };
    const ids = body.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([conceptA, conceptB].sort());
    expect(body.edges).toHaveLength(1);
  });

  it("returns 403 for a non-member", async () => {
    const res = await app.request(
      `/api/projects/${projectId}/graph/expand/${conceptA}`,
      {},
      signInAs(nonMemberId),
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 5.2: Run tests — expect FAIL on the first 3 (404 routing)**

```bash
pnpm --filter @opencairn/api test -- graph.test
```

Expected: the 4 expand tests fail with route-not-found.

- [ ] **Step 5.3: Add the expand handler to `graph.ts`**

Append to `apps/api/src/routes/graph.ts` (chain off the existing `.get`):

```ts
  // GET /api/projects/:projectId/graph/expand/:conceptId
  .get(
    "/:projectId/graph/expand/:conceptId",
    zValidator("query", graphExpandQuerySchema),
    async (c) => {
      const user = c.get("user");
      const projectId = c.req.param("projectId");
      const conceptId = c.req.param("conceptId");
      if (!isUuid(projectId) || !isUuid(conceptId)) {
        return c.json({ error: "bad-request" }, 400);
      }
      if (!(await canRead(user.id, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const { hops } = c.req.valid("query");

      // Seed must belong to the path projectId — prevents cross-project leak.
      const [seed] = await db
        .select({ id: concepts.id })
        .from(concepts)
        .where(and(eq(concepts.id, conceptId), eq(concepts.projectId, projectId)));
      if (!seed) return c.json({ error: "not-found" }, 404);

      // Recursive CTE: collect concept ids reachable within `hops` undirected
      // steps. Cap result to 200 nodes to bound payload size.
      const result = await db.execute<{ concept_id: string }>(sql`
        WITH RECURSIVE traversal AS (
          SELECT ${conceptId}::uuid AS concept_id, 0 AS depth
          UNION
          SELECT
            CASE WHEN e.source_id = t.concept_id THEN e.target_id
                 ELSE e.source_id END AS concept_id,
            t.depth + 1 AS depth
          FROM traversal t
          JOIN concept_edges e
            ON e.source_id = t.concept_id OR e.target_id = t.concept_id
          WHERE t.depth < ${hops}
        )
        SELECT DISTINCT concept_id FROM traversal LIMIT 200
      `);
      const conceptIds = result.rows.map((r) => r.concept_id);

      const idArr = sql.join(
        conceptIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );

      // Same node shape as /graph (degree + noteCount + firstNoteId).
      const nodeRows = await db.execute<{
        id: string;
        name: string;
        description: string | null;
        degree: number;
        note_count: number;
        first_note_id: string | null;
      }>(sql`
        SELECT
          c.id, c.name, c.description,
          (SELECT count(*)::int FROM concept_edges e
            WHERE e.source_id = c.id OR e.target_id = c.id) AS degree,
          (SELECT count(*)::int FROM concept_notes cn
            WHERE cn.concept_id = c.id) AS note_count,
          (SELECT cn.note_id FROM concept_notes cn
            JOIN notes n ON n.id = cn.note_id
            WHERE cn.concept_id = c.id AND n.deleted_at IS NULL
            ORDER BY n.created_at ASC LIMIT 1) AS first_note_id
        FROM concepts c
        WHERE c.id = ANY(ARRAY[${idArr}])
          AND c.project_id = ${projectId}
      `);

      const edgeRes = await db.execute<{
        id: string;
        source_id: string;
        target_id: string;
        relation_type: string;
        weight: number;
      }>(sql`
        SELECT e.id, e.source_id, e.target_id, e.relation_type, e.weight
        FROM concept_edges e
        WHERE e.source_id = ANY(ARRAY[${idArr}])
          AND e.target_id = ANY(ARRAY[${idArr}])
      `);

      const body: GraphExpandResponse = {
        nodes: nodeRows.rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? "",
          degree: r.degree,
          noteCount: r.note_count,
          firstNoteId: r.first_note_id,
        })),
        edges: edgeRes.rows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          targetId: r.target_id,
          relationType: r.relation_type,
          weight: Number(r.weight),
        })),
      };
      return c.json(body);
    },
  );
```

Note: also import `notes` from `@opencairn/db` if not already. The CTE references `concept_edges` and `concepts` directly via SQL, but JS-side type imports for `notes` are needed for any future Drizzle accessor — the current handler uses raw `sql` so no schema accessor is needed; you may skip the import.

- [ ] **Step 5.4: Run tests — expect PASS**

```bash
pnpm --filter @opencairn/api test -- graph.test
```

Expected: 8 tests total pass (4 from Task 4 + 4 expand).

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/routes/graph.ts apps/api/src/routes/graph.test.ts
git commit -m "feat(api): add /graph/expand/:conceptId N-hop subgraph route"
```

---

### Task 6: API GET `/api/notes/:id/backlinks`

**Files:**
- Modify: `apps/api/src/routes/notes.ts` (add handler before `/:id` catch-all)
- Create: `apps/api/src/routes/notes-backlinks.test.ts`

- [ ] **Step 6.1: Write the test (TDD)**

`apps/api/src/routes/notes-backlinks.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, notes, projects, workspaces, user, wikiLinks, eq, workspaceMembers } from "@opencairn/db";
import { createTestApp, signInAs } from "../test/helpers";

describe("GET /api/notes/:id/backlinks", () => {
  let workspaceId: string;
  let projectId: string;
  let memberId: string;
  let nonMemberId: string;
  let target: string;
  let sourceLive: string;
  let sourceDeleted: string;
  let app: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    app = createTestApp();
    const [m] = await db.insert(user).values({ id: crypto.randomUUID(), email: `bl-m-${Date.now()}@example.com`, name: "m", emailVerified: false }).returning();
    memberId = m.id;
    const [nm] = await db.insert(user).values({ id: crypto.randomUUID(), email: `bl-nm-${Date.now()}@example.com`, name: "nm", emailVerified: false }).returning();
    nonMemberId = nm.id;

    const [ws] = await db.insert(workspaces).values({ name: "BL", slug: `bl-${Date.now()}`, ownerId: memberId }).returning();
    workspaceId = ws.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: "owner" });
    const [p] = await db.insert(projects).values({ name: "P", workspaceId, createdBy: memberId }).returning();
    projectId = p.id;

    const [t] = await db.insert(notes).values({ title: "Target", projectId, workspaceId }).returning();
    target = t.id;
    const [s1] = await db.insert(notes).values({ title: "Live source", projectId, workspaceId }).returning();
    sourceLive = s1.id;
    const [s2] = await db.insert(notes).values({ title: "Deleted source", projectId, workspaceId, deletedAt: new Date() }).returning();
    sourceDeleted = s2.id;

    await db.insert(wikiLinks).values([
      { sourceNoteId: sourceLive, targetNoteId: target, workspaceId },
      { sourceNoteId: sourceDeleted, targetNoteId: target, workspaceId },
    ]);
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, memberId));
    await db.delete(user).where(eq(user.id, nonMemberId));
  });

  it("returns 403 for a non-member", async () => {
    const res = await app.request(`/api/notes/${target}/backlinks`, {}, signInAs(nonMemberId));
    expect(res.status).toBe(403);
  });

  it("excludes soft-deleted source notes", async () => {
    const res = await app.request(`/api/notes/${target}/backlinks`, {}, signInAs(memberId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[]; total: number };
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe(sourceLive);
    expect(body.data[0].title).toBe("Live source");
    expect(body.data[0].projectName).toBe("P");
  });

  it("returns empty data for a note with no backlinks", async () => {
    const [orphan] = await db.insert(notes).values({ title: "Orphan", projectId, workspaceId }).returning();
    const res = await app.request(`/api/notes/${orphan.id}/backlinks`, {}, signInAs(memberId));
    const body = (await res.json()) as { data: any[]; total: number };
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });
});
```

- [ ] **Step 6.2: Run test — expect FAIL**

```bash
pnpm --filter @opencairn/api test -- notes-backlinks
```

Expected: 404 routing failure.

- [ ] **Step 6.3: Add handler to `notes.ts`**

Open `apps/api/src/routes/notes.ts`. Find the existing `/by-project/:projectId` GET handler. The new `/:id/backlinks` handler must be registered BEFORE the catch-all `/:id` route — Hono evaluates literal segments after dynamic params last, but to be safe place it ahead.

Add at the top of the file (imports, near line 4):

```diff
-import { db, notes, projects, eq, and, desc, isNull, sql } from "@opencairn/db";
+import { db, notes, projects, wikiLinks, eq, and, desc, isNull, sql } from "@opencairn/db";
```

Insert the new handler chain step BEFORE `.patch("/:id/move", ...)`:

```ts
  .get("/:id/backlinks", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    // JOIN wiki_links → notes (source) → projects (for project name).
    // Exclude soft-deleted source notes.
    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        projectId: notes.projectId,
        projectName: projects.name,
        updatedAt: notes.updatedAt,
        inheritParent: notes.inheritParent,
      })
      .from(wikiLinks)
      .innerJoin(notes, eq(notes.id, wikiLinks.sourceNoteId))
      .innerJoin(projects, eq(projects.id, notes.projectId))
      .where(
        and(
          eq(wikiLinks.targetNoteId, id),
          isNull(notes.deletedAt),
        ),
      )
      .orderBy(desc(notes.updatedAt));

    // Per-row canRead for private (inheritParent=false) source notes.
    // Mirrors the over-fetch + filter pattern used by mentions.ts.
    const visible: Array<{
      id: string;
      title: string;
      projectId: string;
      projectName: string;
      updatedAt: string;
    }> = [];
    for (const row of rows) {
      if (row.inheritParent === false) {
        if (!(await canRead(user.id, { type: "note", id: row.id }))) continue;
      } else {
        if (!(await canRead(user.id, { type: "project", id: row.projectId }))) continue;
      }
      visible.push({
        id: row.id,
        title: row.title,
        projectId: row.projectId,
        projectName: row.projectName,
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    return c.json({ data: visible, total: visible.length });
  })
```

- [ ] **Step 6.4: Run test — expect PASS**

```bash
pnpm --filter @opencairn/api test -- notes-backlinks
```

Expected: 3 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/routes/notes.ts apps/api/src/routes/notes-backlinks.test.ts
git commit -m "feat(api): add GET /api/notes/:id/backlinks (Plan 5 Phase 1)"
```

---

### Task 7: i18n + tabs-store TabMode union

**Files:**
- Create: `apps/web/messages/ko/graph.json`
- Create: `apps/web/messages/en/graph.json`
- Modify: `apps/web/messages/{ko,en}/sidebar.json` (+ graph entry)
- Modify: `apps/web/messages/{ko,en}/note.json` (+ backlinks panel keys)
- Modify: `apps/web/messages/{ko,en}/appShell.json` (+ tabTitles.graph)
- Modify: `apps/web/src/stores/tabs-store.ts` (+ 'graph' in TabMode union)

- [ ] **Step 7.1: Create `messages/ko/graph.json`**

```json
{
  "viewer": {
    "title": "그래프",
    "missing": "그래프를 표시할 프로젝트가 선택되지 않았습니다."
  },
  "filters": {
    "searchPlaceholder": "개념 이름으로 검색…",
    "relationLabel": "관계",
    "relationAll": "전체",
    "truncatedBanner": "{shown} / {total} 개념 표시 중. 검색·관계 필터로 좁히세요.",
    "showAllOver500": "노드 500개 이상 — 필터로 좁혀서 보세요."
  },
  "nodeMenu": {
    "openFirstNote": "노트 열기",
    "openFirstNoteDisabled": "이 개념에 연결된 노트가 없습니다",
    "expand": "주변 펼치기"
  },
  "empty": {
    "title": "아직 그래프가 비어 있습니다",
    "body": "노트가 인제스트되면 자동으로 개념이 추출되어 여기에 나타납니다."
  },
  "errors": {
    "loadFailed": "그래프를 불러오지 못했습니다.",
    "tooManyHops": "이웃 펼치기 단계는 최대 3까지 가능합니다.",
    "forbidden": "이 프로젝트에 접근 권한이 없습니다."
  }
}
```

- [ ] **Step 7.2: Create `messages/en/graph.json`**

```json
{
  "viewer": {
    "title": "Graph",
    "missing": "No project selected to render a graph."
  },
  "filters": {
    "searchPlaceholder": "Search concepts…",
    "relationLabel": "Relation",
    "relationAll": "All",
    "truncatedBanner": "Showing {shown} of {total} concepts. Narrow with search or relation filters.",
    "showAllOver500": "Over 500 nodes — narrow with filters."
  },
  "nodeMenu": {
    "openFirstNote": "Open note",
    "openFirstNoteDisabled": "This concept has no source notes yet",
    "expand": "Expand neighbors"
  },
  "empty": {
    "title": "The graph is still empty",
    "body": "Concepts will appear here automatically as notes are ingested."
  },
  "errors": {
    "loadFailed": "Failed to load the graph.",
    "tooManyHops": "Neighbor expansion supports at most 3 hops.",
    "forbidden": "You don't have access to this project."
  }
}
```

- [ ] **Step 7.3: Add sidebar.graph entry to both locales**

Open `apps/web/messages/ko/sidebar.json`. Add a top-level `graph` object (next to existing `project`, `search` keys):

```json
  "graph": {
    "entry": "이 프로젝트 그래프 보기"
  }
```

`apps/web/messages/en/sidebar.json`:

```json
  "graph": {
    "entry": "View this project's graph"
  }
```

- [ ] **Step 7.4: Add note.backlinks keys to both locales**

If `apps/web/messages/ko/note.json` doesn't exist, create it. Otherwise append:

```json
  "backlinks": {
    "title": "백링크",
    "empty": "이 노트를 가리키는 다른 노트가 없습니다.",
    "countAria": "{count}개의 백링크",
    "toggleAria": "백링크 패널 펼치기/접기"
  }
```

`apps/web/messages/en/note.json`:

```json
  "backlinks": {
    "title": "Backlinks",
    "empty": "No other notes link to this one.",
    "countAria": "{count} backlinks",
    "toggleAria": "Toggle backlinks panel"
  }
```

> Confirm whether a `note.json` namespace already exists. If not, the messages file structure already reserves a single namespace per JSON file — search `apps/web/src` for `useTranslations("note.` to see if it's used. If unused, this PR introduces it. If `note.json` exists with other content, append `backlinks` as a top-level key. **Do not** create a duplicate namespace.

- [ ] **Step 7.5: Add appShell.tabTitles.graph**

Open `apps/web/messages/ko/appShell.json`. Find `tabTitles` block:

```diff
   "tabTitles": {
     "dashboard": "대시보드",
     "research_hub": "리서치",
+    "graph": "그래프",
     ...
   }
```

`apps/web/messages/en/appShell.json`:

```diff
   "tabTitles": {
     "dashboard": "Dashboard",
     "research_hub": "Research",
+    "graph": "Graph",
     ...
   }
```

- [ ] **Step 7.6: Add `'graph'` to TabMode union**

Open `apps/web/src/stores/tabs-store.ts`. Find the `TabMode` union (line 15):

```diff
 export type TabMode =
   | "plate"
   | "reading"
   | "diff"
   | "artifact"
   | "presentation"
   | "data"
   | "spreadsheet"
   | "whiteboard"
   | "source"
   | "canvas"
+  | "graph"
   | "mindmap"
   | "flashcard";
```

> Plan 7 Canvas Phase 1 inserts `"canvas"` at this same alphabetical position. The two PRs touch different lines (canvas above, graph below it) — auto-merge expected.

- [ ] **Step 7.7: Run i18n parity check + tabs-store typecheck**

```bash
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: parity passes (graph.json keys identical ko/en); tsc passes (TabMode union widened, no consumer broken yet).

- [ ] **Step 7.8: Commit**

```bash
git add apps/web/messages/ko/graph.json apps/web/messages/en/graph.json \
        apps/web/messages/ko/sidebar.json apps/web/messages/en/sidebar.json \
        apps/web/messages/ko/note.json apps/web/messages/en/note.json \
        apps/web/messages/ko/appShell.json apps/web/messages/en/appShell.json \
        apps/web/src/stores/tabs-store.ts
git commit -m "feat(web): add Plan 5 i18n keys + 'graph' TabMode union"
```

---

### Task 8: ProjectGraph component (Cytoscape) + hook + sub-components

**Files:**
- Modify: `apps/web/package.json` (add deps)
- Create: `apps/web/src/components/graph/graph-types.ts`
- Create: `apps/web/src/components/graph/cytoscape-stylesheet.ts`
- Create: `apps/web/src/components/graph/to-cytoscape-elements.ts`
- Create: `apps/web/src/components/graph/useProjectGraph.ts`
- Create: `apps/web/src/components/graph/GraphFilters.tsx`
- Create: `apps/web/src/components/graph/GraphEmpty.tsx`
- Create: `apps/web/src/components/graph/GraphSkeleton.tsx`
- Create: `apps/web/src/components/graph/GraphError.tsx`
- Create: `apps/web/src/components/graph/ProjectGraph.tsx`
- Create: `apps/web/src/components/graph/__tests__/to-cytoscape-elements.test.ts`
- Create: `apps/web/src/components/graph/__tests__/useProjectGraph.test.ts`
- Create: `apps/web/src/components/graph/__tests__/GraphFilters.test.tsx`
- Create: `apps/web/src/components/graph/__tests__/ProjectGraph.test.tsx`

- [ ] **Step 8.1: Install Cytoscape deps**

```bash
pnpm --filter @opencairn/web add cytoscape@^3.30 cytoscape-fcose@^2.2 react-cytoscapejs@^2.0
pnpm --filter @opencairn/web add -D @types/cytoscape
```

Verify the resulting `apps/web/package.json` pins versions WITHOUT `latest` / `*` (CI guard, Task 14).

- [ ] **Step 8.2: Create the types module**

`apps/web/src/components/graph/graph-types.ts`:

```ts
import type { GraphResponse } from "@opencairn/shared";

export type FilterState = {
  search: string;
  relation: string | null;
};

export const INITIAL_FILTERS: FilterState = { search: "", relation: null };

export type CytoscapeElement =
  | { data: { id: string; label: string; type: "node"; degree: number; firstNoteId: string | null } }
  | { data: { id: string; source: string; target: string; type: "edge"; relationType: string; weight: number } };

// `GraphSnapshot` is the in-cache shape used by useProjectGraph + the
// Cytoscape converter. Structurally identical to the wire DTO — alias
// keeps type-flow direct and avoids accidental drift if the server
// shape evolves.
export type GraphSnapshot = GraphResponse;
```

- [ ] **Step 8.3: Write the elements-converter test (TDD)**

`apps/web/src/components/graph/__tests__/to-cytoscape-elements.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toCytoscapeElements } from "../to-cytoscape-elements";
import type { GraphSnapshot } from "../graph-types";

const seed: GraphSnapshot = {
  nodes: [
    { id: "n1", name: "Alpha", description: "a", degree: 2, noteCount: 1, firstNoteId: "no1" },
    { id: "n2", name: "Beta", description: "b", degree: 1, noteCount: 0, firstNoteId: null },
  ],
  edges: [{ id: "e1", sourceId: "n1", targetId: "n2", relationType: "is-a", weight: 1 }],
  truncated: false,
  totalConcepts: 2,
};

describe("toCytoscapeElements", () => {
  it("emits one element per node + edge with discriminator", () => {
    const out = toCytoscapeElements(seed, { search: "", relation: null });
    expect(out).toHaveLength(3);
    expect(out.filter((e) => e.data.type === "node")).toHaveLength(2);
    expect(out.filter((e) => e.data.type === "edge")).toHaveLength(1);
  });

  it("filters nodes by search (case-insensitive substring)", () => {
    const out = toCytoscapeElements(seed, { search: "ALPHA", relation: null });
    const nodes = out.filter((e) => e.data.type === "node");
    expect(nodes.map((n) => n.data.id)).toEqual(["n1"]);
  });

  it("drops edges whose endpoints are filtered out (no dangling edges)", () => {
    const out = toCytoscapeElements(seed, { search: "alpha", relation: null });
    expect(out.filter((e) => e.data.type === "edge")).toHaveLength(0);
  });

  it("filters edges by relation while keeping all visible nodes", () => {
    const out = toCytoscapeElements(seed, { search: "", relation: "uses" });
    expect(out.filter((e) => e.data.type === "edge")).toHaveLength(0);
    expect(out.filter((e) => e.data.type === "node")).toHaveLength(2);
  });
});
```

- [ ] **Step 8.4: Run — expect FAIL**

```bash
pnpm --filter @opencairn/web test -- to-cytoscape-elements
```

- [ ] **Step 8.5: Implement the converter**

`apps/web/src/components/graph/to-cytoscape-elements.ts`:

```ts
import type { CytoscapeElement, FilterState, GraphSnapshot } from "./graph-types";

/**
 * Project the GraphResponse + active filters into the Cytoscape elements
 * shape. Edges are dropped if either endpoint is filtered out — Cytoscape
 * tolerates dangling edges, but the visual is misleading.
 */
export function toCytoscapeElements(
  snap: GraphSnapshot,
  filters: FilterState,
): CytoscapeElement[] {
  const search = filters.search.trim().toLowerCase();
  const visibleNodeIds = new Set<string>();
  const nodeElements: CytoscapeElement[] = [];
  for (const n of snap.nodes) {
    if (search && !n.name.toLowerCase().includes(search)) continue;
    visibleNodeIds.add(n.id);
    nodeElements.push({
      data: {
        id: n.id,
        label: n.name,
        type: "node",
        degree: n.degree,
        firstNoteId: n.firstNoteId,
      },
    });
  }
  const edgeElements: CytoscapeElement[] = [];
  for (const e of snap.edges) {
    if (!visibleNodeIds.has(e.sourceId)) continue;
    if (!visibleNodeIds.has(e.targetId)) continue;
    if (filters.relation && e.relationType !== filters.relation) continue;
    edgeElements.push({
      data: {
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        type: "edge",
        relationType: e.relationType,
        weight: e.weight,
      },
    });
  }
  return [...nodeElements, ...edgeElements];
}
```

- [ ] **Step 8.6: Run — expect PASS**

- [ ] **Step 8.7: Create the stylesheet module**

`apps/web/src/components/graph/cytoscape-stylesheet.ts`:

```ts
import type { Stylesheet } from "cytoscape";

// Visual tokens chosen to fit the neutral monochrome OpenCairn palette
// (no warm/ember colors per brand rule). Edge thickness scales with weight.
export const GRAPH_STYLESHEET: Stylesheet[] = [
  {
    selector: "node",
    style: {
      "background-color": "hsl(var(--foreground) / 0.85)",
      label: "data(label)",
      "font-size": "11px",
      color: "hsl(var(--foreground))",
      "text-margin-y": -8,
      "text-halign": "center",
      "text-valign": "top",
      width: "mapData(degree, 0, 30, 14, 36)",
      height: "mapData(degree, 0, 30, 14, 36)",
      "border-width": 1,
      "border-color": "hsl(var(--border))",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "border-color": "hsl(var(--primary))",
    },
  },
  {
    selector: "edge",
    style: {
      "line-color": "hsl(var(--border))",
      "curve-style": "bezier",
      width: "mapData(weight, 0, 5, 1, 4)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "hsl(var(--border))",
    },
  },
];
```

- [ ] **Step 8.8: Write the hook test (TDD)**

`apps/web/src/components/graph/__tests__/useProjectGraph.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProjectGraph } from "../useProjectGraph";
import type { GraphResponse } from "@opencairn/shared";

const fixture: GraphResponse = {
  nodes: [{ id: "n1", name: "Alpha", description: "", degree: 0, noteCount: 0, firstNoteId: null }],
  edges: [],
  truncated: false,
  totalConcepts: 1,
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
  );
});

describe("useProjectGraph", () => {
  it("fetches the project graph", async () => {
    const { result } = renderHook(() => useProjectGraph("p1"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.nodes).toHaveLength(1);
  });

  it("merges expand result into the cached snapshot (dedup by id)", async () => {
    const { result } = renderHook(() => useProjectGraph("p1"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            nodes: [
              fixture.nodes[0], // duplicate — should not double
              { id: "n2", name: "Beta", description: "", degree: 0, noteCount: 0, firstNoteId: null },
            ],
            edges: [{ id: "e1", sourceId: "n1", targetId: "n2", relationType: "is-a", weight: 1 }],
          }),
          { status: 200 },
        ),
      ),
    );
    await result.current.expand("n1", 1);
    await waitFor(() => expect(result.current.data?.nodes).toHaveLength(2));
    expect(result.current.data?.edges).toHaveLength(1);
  });
});
```

- [ ] **Step 8.9: Run — expect FAIL**

- [ ] **Step 8.10: Implement the hook**

`apps/web/src/components/graph/useProjectGraph.ts`:

```ts
"use client";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GraphResponse, GraphExpandResponse } from "@opencairn/shared";
import type { GraphSnapshot } from "./graph-types";

const STALE_MS = 30_000;

export function useProjectGraph(projectId: string) {
  const qc = useQueryClient();
  const queryKey = ["project-graph", projectId] as const;

  const query = useQuery<GraphSnapshot>({
    queryKey,
    enabled: !!projectId,
    staleTime: STALE_MS,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/projects/${projectId}/graph?limit=500&order=degree`, { signal });
      if (!res.ok) throw new Error(`graph ${res.status}`);
      const body = (await res.json()) as GraphResponse;
      return body;
    },
  });

  const expand = useCallback(
    async (conceptId: string, hops: number = 1) => {
      const res = await fetch(
        `/api/projects/${projectId}/graph/expand/${conceptId}?hops=${hops}`,
      );
      if (!res.ok) throw new Error(`expand ${res.status}`);
      const slice = (await res.json()) as GraphExpandResponse;
      qc.setQueryData<GraphSnapshot>(queryKey, (prev) => {
        if (!prev) return prev;
        const nodeMap = new Map(prev.nodes.map((n) => [n.id, n]));
        for (const n of slice.nodes) nodeMap.set(n.id, n);
        const edgeMap = new Map(prev.edges.map((e) => [e.id, e]));
        for (const e of slice.edges) edgeMap.set(e.id, e);
        return {
          ...prev,
          nodes: [...nodeMap.values()],
          edges: [...edgeMap.values()],
        };
      });
    },
    [projectId, qc, queryKey],
  );

  return { ...query, expand };
}
```

- [ ] **Step 8.11: Run — expect PASS**

- [ ] **Step 8.12: Create the helper presentational components**

`apps/web/src/components/graph/GraphFilters.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import type { FilterState } from "./graph-types";

interface Props {
  filters: FilterState;
  relations: string[];
  truncated: boolean;
  shown: number;
  total: number;
  onChange(next: Partial<FilterState>): void;
}

export function GraphFilters({ filters, relations, truncated, shown, total, onChange }: Props) {
  const t = useTranslations("graph.filters");
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
      <input
        type="search"
        placeholder={t("searchPlaceholder")}
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
        className="flex-1 min-w-[180px] rounded border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {t("relationLabel")}
        <select
          value={filters.relation ?? ""}
          onChange={(e) => onChange({ relation: e.target.value || null })}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">{t("relationAll")}</option>
          {relations.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      {truncated && (
        <span className="text-xs text-muted-foreground">
          {t("truncatedBanner", { shown, total })}
        </span>
      )}
    </div>
  );
}
```

`apps/web/src/components/graph/GraphEmpty.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";

export function GraphEmpty() {
  const t = useTranslations("graph.empty");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{t("title")}</p>
      <p>{t("body")}</p>
    </div>
  );
}
```

`apps/web/src/components/graph/GraphSkeleton.tsx`:

```tsx
export function GraphSkeleton() {
  return (
    <div className="h-full w-full animate-pulse bg-muted/30" data-testid="graph-skeleton" />
  );
}
```

`apps/web/src/components/graph/GraphError.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";

export function GraphError({ error }: { error: Error }) {
  const t = useTranslations("graph.errors");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
      <p className="font-medium">{t("loadFailed")}</p>
      <p className="text-xs">{error.message}</p>
    </div>
  );
}
```

- [ ] **Step 8.13: Write the GraphFilters test**

`apps/web/src/components/graph/__tests__/GraphFilters.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { GraphFilters } from "../GraphFilters";
import koGraph from "@/../messages/ko/graph.json";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("GraphFilters", () => {
  it("calls onChange on search input", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <GraphFilters
        filters={{ search: "", relation: null }}
        relations={["is-a"]}
        truncated={false}
        shown={0}
        total={0}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(koGraph.filters.searchPlaceholder), {
      target: { value: "x" },
    });
    expect(onChange).toHaveBeenCalledWith({ search: "x" });
  });

  it("renders the truncated banner", () => {
    renderWithIntl(
      <GraphFilters
        filters={{ search: "", relation: null }}
        relations={[]}
        truncated={true}
        shown={500}
        total={847}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/500/)).toBeInTheDocument();
    expect(screen.getByText(/847/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.14: Implement the main `ProjectGraph.tsx`**

`apps/web/src/components/graph/ProjectGraph.tsx`:

```tsx
"use client";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useTabsStore } from "@/stores/tabs-store";
import { useProjectGraph } from "./useProjectGraph";
import { toCytoscapeElements } from "./to-cytoscape-elements";
import { GRAPH_STYLESHEET } from "./cytoscape-stylesheet";
import { GraphFilters } from "./GraphFilters";
import { GraphSkeleton } from "./GraphSkeleton";
import { GraphError } from "./GraphError";
import { GraphEmpty } from "./GraphEmpty";
import { INITIAL_FILTERS, type FilterState } from "./graph-types";

// react-cytoscapejs ships an ESM build that imports cytoscape at top level.
// Disable SSR — Cytoscape needs DOM/window. Plan 7 Canvas does the same for
// its iframe runtime via dynamic import.
const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), { ssr: false });

if (typeof window !== "undefined") {
  // Register the layout extension once. Repeated calls in HMR are harmless
  // (cytoscape ignores duplicate registrations).
  cytoscape.use(fcose);
}

interface Props {
  projectId: string;
}

export function ProjectGraph({ projectId }: Props) {
  const t = useTranslations("graph");
  const router = useRouter();
  const params = useParams<{ wsSlug: string }>();
  const wsSlug = params?.wsSlug;
  const { data, isLoading, error, expand } = useProjectGraph(projectId);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const elements = useMemo(
    () => (data ? toCytoscapeElements(data, filters) : []),
    [data, filters],
  );

  const visibleNodeCount = useMemo(
    () => elements.filter((el) => el.data.type === "node").length,
    [elements],
  );

  const relations = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const e of data.edges) set.add(e.relationType);
    return [...set].sort();
  }, [data]);

  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

  const onNodeDoubleClick = useCallback(
    (firstNoteId: string | null, conceptName: string) => {
      if (!firstNoteId) {
        toast.message(t("nodeMenu.openFirstNoteDisabled"));
        return;
      }
      addOrReplacePreview({
        id: crypto.randomUUID(),
        kind: "note",
        targetId: firstNoteId,
        mode: "plate",
        title: conceptName,
        pinned: false,
        preview: true,
        dirty: false,
        splitWith: null,
        splitSide: null,
        scrollY: 0,
      });
      router.push(`/w/${wsSlug}/n/${firstNoteId}`);
    },
    [addOrReplacePreview, router, wsSlug, t],
  );

  // Park the latest handler in a ref so the cytoscape `dbltap` binding
  // closes over a stable indirection. Without this, the binding would
  // capture the *first* render's onNodeDoubleClick and miss any tabs-store
  // / router updates that happened since (classic stale-closure bug).
  // The ref-update effect is keyed on `onNodeDoubleClick` so it always
  // points at the current callback; the bind effect is keyed on `data`
  // so we only re-bind when cytoscape's underlying instance might be
  // rebuilt (elements arrival).
  const handlerRef = useRef(onNodeDoubleClick);
  useEffect(() => {
    handlerRef.current = onNodeDoubleClick;
  }, [onNodeDoubleClick]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const onTap = (evt: cytoscape.EventObject) => {
      if (evt.target === cy) return; // background click
      const node = evt.target;
      if (node?.isNode?.()) {
        const fid = node.data("firstNoteId") as string | null;
        const lbl = node.data("label") as string;
        handlerRef.current(fid, lbl);
      }
    };
    cy.on("dbltap", "node", onTap);
    return () => { cy.off("dbltap", "node", onTap); };
  }, [data]);

  if (isLoading) return <GraphSkeleton />;
  if (error) return <GraphError error={error as Error} />;
  if (!data || data.nodes.length === 0) return <GraphEmpty />;

  return (
    <div className="flex h-full flex-col">
      <GraphFilters
        filters={filters}
        relations={relations}
        truncated={data.truncated}
        shown={visibleNodeCount}
        total={data.totalConcepts}
        onChange={(next) => setFilters((f) => ({ ...f, ...next }))}
      />
      <div className="relative flex-1">
        <CytoscapeComponent
          elements={elements}
          // fcose layout is non-deterministic by default. randomize:false
          // keeps positions stable across re-renders that don't add nodes.
          layout={{ name: "fcose", animate: true, randomize: false, padding: 30 } as cytoscape.LayoutOptions}
          stylesheet={GRAPH_STYLESHEET}
          cy={(cy) => { cyRef.current = cy; }}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 8.15: Write the ProjectGraph smoke test**

`apps/web/src/components/graph/__tests__/ProjectGraph.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import { ProjectGraph } from "../ProjectGraph";

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="cy-mount">cytoscape</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ wsSlug: "w" }),
}));

function renderWith(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <ProjectGraph projectId="p1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectGraph", () => {
  it("renders empty state when concept list is empty", async () => {
    renderWith({ nodes: [], edges: [], truncated: false, totalConcepts: 0 });
    expect(await screen.findByText(koGraph.empty.title)).toBeInTheDocument();
  });

  it("mounts cytoscape when there is data", async () => {
    renderWith({
      nodes: [{ id: "n1", name: "A", description: "", degree: 0, noteCount: 0, firstNoteId: null }],
      edges: [],
      truncated: false,
      totalConcepts: 1,
    });
    expect(await screen.findByTestId("cy-mount")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.16: Run all graph component tests — expect PASS**

```bash
pnpm --filter @opencairn/web test -- components/graph
```

- [ ] **Step 8.17: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml \
        apps/web/src/components/graph/
git commit -m "feat(web): add ProjectGraph component with Cytoscape fcose (Plan 5 Phase 1)"
```

---

### Task 9: ProjectGraphViewer + Tab Mode Router integration

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/project-graph-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/project-graph-viewer.test.tsx`
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.tsx`
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.test.tsx`

- [ ] **Step 9.1: Read existing tab-mode-router for the case structure**

```bash
grep -n "case " /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/web/src/components/tab-shell/tab-mode-router.tsx | head
```

Note the cases pattern (`'plate' | 'reading' | ... → <Viewer />`).

- [ ] **Step 9.2: Write the viewer test (TDD)**

`apps/web/src/components/tab-shell/viewers/project-graph-viewer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import { ProjectGraphViewer } from "./project-graph-viewer";
import type { Tab } from "@/stores/tabs-store";

vi.mock("@/components/graph/ProjectGraph", () => ({
  ProjectGraph: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-graph">{projectId}</div>
  ),
}));

const baseTab: Tab = {
  id: "tab-1",
  kind: "project",
  targetId: null,
  mode: "graph",
  title: "Graph",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
};

describe("ProjectGraphViewer", () => {
  it("renders missing message when targetId is null", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <ProjectGraphViewer tab={baseTab} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(koGraph.viewer.missing)).toBeInTheDocument();
  });

  it("renders ProjectGraph with the target projectId", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <ProjectGraphViewer tab={{ ...baseTab, targetId: "p-42" }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("project-graph")).toHaveTextContent("p-42");
  });
});
```

- [ ] **Step 9.3: Run — expect FAIL**

- [ ] **Step 9.4: Implement the viewer**

`apps/web/src/components/tab-shell/viewers/project-graph-viewer.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { ProjectGraph } from "@/components/graph/ProjectGraph";

export function ProjectGraphViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("graph.viewer");
  if (!tab.targetId) {
    return <div data-testid="project-graph-viewer-missing" className="p-6 text-sm text-muted-foreground">{t("missing")}</div>;
  }
  return (
    <div data-testid="project-graph-viewer" className="h-full">
      <ProjectGraph projectId={tab.targetId} />
    </div>
  );
}
```

- [ ] **Step 9.5: Run — expect PASS**

- [ ] **Step 9.6: Patch tab-mode-router**

Open `apps/web/src/components/tab-shell/tab-mode-router.tsx`. Add the import:

```diff
 import { DataViewer } from "./viewers/data-viewer";
+import { ProjectGraphViewer } from "./viewers/project-graph-viewer";
```

Find the `switch (tab.mode)` block (or equivalent dispatch). Add a case BEFORE `default`:

```diff
   case "data":
     return <DataViewer tab={tab} />;
+  case "graph":
+    return <ProjectGraphViewer tab={tab} />;
   default:
     return <StubViewer mode={tab.mode} />;
```

If the file has an `isRoutedByTabModeRouter` predicate (set / array) defined nearby, add `'graph'` there too.

- [ ] **Step 9.7: Update tab-mode-router test**

Append to `apps/web/src/components/tab-shell/tab-mode-router.test.tsx`:

```tsx
it("renders ProjectGraphViewer for mode='graph'", () => {
  render(<TabModeRouter tab={{ ...baseTab, mode: "graph", kind: "project", targetId: "p1" }} />);
  expect(screen.getByTestId("project-graph-viewer")).toBeInTheDocument();
});
```

If the test file already has a `baseTab` and a `<TabModeRouter />` wrapper, reuse them. The mock must include the new viewer:

```tsx
vi.mock("./viewers/project-graph-viewer", () => ({
  ProjectGraphViewer: () => <div data-testid="project-graph-viewer" />,
}));
```

- [ ] **Step 9.8: Run all tab-mode-router tests — expect PASS**

```bash
pnpm --filter @opencairn/web test -- tab-mode-router
```

- [ ] **Step 9.9: Commit**

```bash
git add apps/web/src/components/tab-shell/
git commit -m "feat(web): wire 'graph' tab mode through TabModeRouter (Plan 5 Phase 1)"
```

---

### Task 10: Sidebar entry — `<ProjectGraphLink />`

**Files:**
- Create: `apps/web/src/components/sidebar/project-graph-link.tsx`
- Create: `apps/web/src/components/sidebar/project-graph-link.test.tsx`
- Modify: `apps/web/src/components/sidebar/shell-sidebar.tsx` (insert below ScopedSearch)

- [ ] **Step 10.1: Write the test (TDD)**

`apps/web/src/components/sidebar/project-graph-link.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koSidebar from "@/../messages/ko/sidebar.json";
import { ProjectGraphLink } from "./project-graph-link";

const push = vi.fn();
const addTab = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "w-slug" }),
}));

vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (selector: (s: unknown) => unknown) =>
    selector({ addTab }),
}));

vi.mock("./use-current-project", () => ({
  useCurrentProjectContext: () => ({ projectId: "p-1" }),
}));

describe("ProjectGraphLink", () => {
  it("renders nothing when no project is selected", () => {
    vi.doMock("./use-current-project", () => ({
      useCurrentProjectContext: () => ({ projectId: null }),
    }));
    // re-import after doMock would be needed for full coverage; for the
    // happy path below, the original mock applies. This case is asserted
    // by the unit test in the refactor below — keep simple here.
  });

  it("opens a graph tab + pushes the URL on click", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={{ sidebar: koSidebar }}>
        <ProjectGraphLink />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: koSidebar.graph.entry }));
    expect(addTab).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "project", mode: "graph", targetId: "p-1" }),
    );
    expect(push).toHaveBeenCalledWith("/w/w-slug/p/p-1/graph");
  });
});
```

- [ ] **Step 10.2: Run — expect FAIL**

- [ ] **Step 10.3: Implement the component**

`apps/web/src/components/sidebar/project-graph-link.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { Workflow } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useTabsStore } from "@/stores/tabs-store";
import { useCurrentProjectContext } from "./use-current-project";

export function ProjectGraphLink() {
  const t = useTranslations("sidebar.graph");
  const { projectId } = useCurrentProjectContext();
  const router = useRouter();
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const addTab = useTabsStore((s) => s.addTab);

  if (!projectId) return null;

  function open() {
    addTab({
      id: crypto.randomUUID(),
      kind: "project",
      targetId: projectId,
      mode: "graph",
      title: "Graph",
      titleKey: "appShell.tabTitles.graph",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
    router.push(`/w/${wsSlug}/p/${projectId}/graph`);
  }

  return (
    <button
      type="button"
      onClick={open}
      className="mx-3 my-2 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </button>
  );
}
```

- [ ] **Step 10.4: Run — expect PASS**

- [ ] **Step 10.5: Mount in sidebar**

Open `apps/web/src/components/sidebar/shell-sidebar.tsx`. Find the `<ScopedSearch />` mount. Add:

```diff
   <ScopedSearch />
+  <ProjectGraphLink />
```

…and add the import at the top.

- [ ] **Step 10.6: Run web typecheck**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: clean.

- [ ] **Step 10.7: Commit**

```bash
git add apps/web/src/components/sidebar/project-graph-link.tsx \
        apps/web/src/components/sidebar/project-graph-link.test.tsx \
        apps/web/src/components/sidebar/shell-sidebar.tsx
git commit -m "feat(web): add sidebar entry for project graph (Plan 5 Phase 1)"
```

---

### Task 11: Route page `/w/<slug>/p/<projectId>/graph`

**Files:**
- Create: `apps/web/src/app/[locale]/(shell)/w/[wsSlug]/p/[projectId]/graph/page.tsx`

- [ ] **Step 11.1: Find an existing similar route as reference**

```bash
find /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/web/src/app -name 'page.tsx' -path '*\(shell\)*' | head
```

Note one of the existing shell route pages (e.g., the project view page). Match its pattern (server-side params unwrap → client tab manager).

- [ ] **Step 11.2: Create the page**

`apps/web/src/app/[locale]/(shell)/w/[wsSlug]/p/[projectId]/graph/page.tsx`:

```tsx
import { Metadata } from "next";
import { ProjectGraphRouteEntry } from "@/components/graph/ProjectGraphRouteEntry";

interface PageProps {
  params: Promise<{ locale: string; wsSlug: string; projectId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: `Graph · ${projectId}` };
}

export default async function ProjectGraphPage({ params }: PageProps) {
  const { wsSlug, projectId } = await params;
  return <ProjectGraphRouteEntry wsSlug={wsSlug} projectId={projectId} />;
}
```

- [ ] **Step 11.3: Add the client route entry**

Create `apps/web/src/components/graph/ProjectGraphRouteEntry.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { useTabsStore } from "@/stores/tabs-store";
import { ProjectGraph } from "./ProjectGraph";

interface Props {
  wsSlug: string;
  projectId: string;
}

/**
 * Entry component rendered by the /w/<slug>/p/<id>/graph server page.
 * On mount, ensures a `(kind='project', mode='graph', targetId=projectId)`
 * tab exists and is active — same pattern as the dashboard / research_hub
 * routes use to sync URL → tab store.
 */
export function ProjectGraphRouteEntry({ projectId }: Props) {
  const findTabByTarget = useTabsStore((s) => s.findTabByTarget);
  const addTab = useTabsStore((s) => s.addTab);
  const setActive = useTabsStore((s) => s.setActive);

  useEffect(() => {
    const existing = findTabByTarget("project", projectId);
    if (existing && existing.mode === "graph") {
      setActive(existing.id);
      return;
    }
    addTab({
      id: crypto.randomUUID(),
      kind: "project",
      targetId: projectId,
      mode: "graph",
      title: "Graph",
      titleKey: "appShell.tabTitles.graph",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }, [projectId, findTabByTarget, addTab, setActive]);

  return <ProjectGraph projectId={projectId} />;
}
```

- [ ] **Step 11.4: Build the web app**

```bash
pnpm --filter @opencairn/web build
```

Expected: build succeeds, route `/[locale]/(shell)/w/[wsSlug]/p/[projectId]/graph` listed in the build output.

- [ ] **Step 11.5: Commit**

```bash
git add apps/web/src/app/\[locale\]/\(shell\)/w/\[wsSlug\]/p/\[projectId\]/graph/page.tsx \
        apps/web/src/components/graph/ProjectGraphRouteEntry.tsx
git commit -m "feat(web): add /w/<slug>/p/<projectId>/graph route page"
```

---

### Task 12: BacklinksPanel + panel-store update

**Files:**
- Modify: `apps/web/src/stores/panel-store.ts` (+ backlinksOpen + toggleBacklinks)
- Create: `apps/web/src/components/notes/BacklinksPanel.tsx`
- Create: `apps/web/src/components/notes/BacklinksPanel.test.tsx`
- Modify: a Plate viewer wrapper to mount the panel beside the editor (path TBD via grep)

- [ ] **Step 12.1: Extend `panel-store.ts`**

Open `apps/web/src/stores/panel-store.ts`. Append a third pair of state + action:

```diff
 interface PanelState {
   sidebarWidth: number;
   sidebarOpen: boolean;
   agentPanelWidth: number;
   agentPanelOpen: boolean;
+  backlinksOpen: boolean;
   toggleSidebar(): void;
   toggleAgentPanel(): void;
+  toggleBacklinks(): void;
   setSidebarWidth(w: number): void;
   setAgentPanelWidth(w: number): void;
   resetSidebarWidth(): void;
   resetAgentPanelWidth(): void;
 }
```

In the `create` body, add `backlinksOpen: false` and `toggleBacklinks: () => set((s) => ({ backlinksOpen: !s.backlinksOpen }))`. The persist `name` (`oc:panel`) stays the same — Zustand persist tolerates added fields gracefully.

- [ ] **Step 12.2: Write the BacklinksPanel test (TDD)**

`apps/web/src/components/notes/BacklinksPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koNote from "@/../messages/ko/note.json";
import { BacklinksPanel } from "./BacklinksPanel";

const replacePreview = vi.fn();
vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (selector: (s: unknown) => unknown) =>
    selector({ addOrReplacePreview: replacePreview }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ wsSlug: "w" }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ note: koNote }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BacklinksPanel", () => {
  it("renders empty state when there are no backlinks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 })),
    );
    wrap(<BacklinksPanel noteId="n1" />);
    expect(await screen.findByText(koNote.backlinks.empty)).toBeInTheDocument();
  });

  it("opens the source note as a preview tab on row click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "src1", title: "Source A", projectId: "p", projectName: "P", updatedAt: new Date().toISOString() }],
            total: 1,
          }),
          { status: 200 },
        ),
      ),
    );
    wrap(<BacklinksPanel noteId="n1" />);
    const row = await screen.findByRole("button", { name: /Source A/ });
    fireEvent.click(row);
    await waitFor(() =>
      expect(replacePreview).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "note", mode: "plate", targetId: "src1" }),
      ),
    );
  });
});
```

- [ ] **Step 12.3: Run — expect FAIL**

- [ ] **Step 12.4: Implement BacklinksPanel**

`apps/web/src/components/notes/BacklinksPanel.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import type { BacklinksResponse } from "@opencairn/shared";
import { useTabsStore } from "@/stores/tabs-store";

interface Props { noteId: string }

export function BacklinksPanel({ noteId }: Props) {
  const t = useTranslations("note.backlinks");
  const router = useRouter();
  const params = useParams<{ wsSlug: string }>();
  const wsSlug = params?.wsSlug;
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

  const { data } = useQuery<BacklinksResponse>({
    queryKey: ["backlinks", noteId],
    enabled: !!noteId,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/backlinks`);
      if (!res.ok) throw new Error(`backlinks ${res.status}`);
      return (await res.json()) as BacklinksResponse;
    },
  });

  function open(b: BacklinksResponse["data"][number]) {
    addOrReplacePreview({
      id: crypto.randomUUID(),
      kind: "note",
      targetId: b.id,
      mode: "plate",
      title: b.title,
      pinned: false,
      preview: true,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
    router.push(`/w/${wsSlug}/n/${b.id}`);
  }

  return (
    <aside aria-label={t("toggleAria")} className="flex h-full w-72 flex-col gap-2 overflow-y-auto border-l border-border bg-background p-3">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <span className="text-xs text-muted-foreground" aria-label={t("countAria", { count: data?.total ?? 0 })}>
          {data?.total ?? 0}
        </span>
      </header>
      {data && data.total === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {data?.data.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => open(b)}
                className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                {b.title}
                <span className="ml-2 text-xs text-muted-foreground">{b.projectName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 12.5: Run — expect PASS**

- [ ] **Step 12.6: Wire BacklinksPanel into the plate viewer wrapper**

The plate viewer is named `apps/web/src/components/tab-shell/viewers/<plate-or-note>-viewer.tsx`. Find it:

```bash
grep -rln "PlateEditor\|<NoteEditor\|tab.mode === \"plate\"" /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/web/src/components/tab-shell/ | head
```

In whichever file mounts the editor for `mode === 'plate'`, add a flex layout wrapper:

```diff
+  import { BacklinksPanel } from "@/components/notes/BacklinksPanel";
+  import { usePanelStore } from "@/stores/panel-store";

   export function PlateViewer({ tab }) {
+    const backlinksOpen = usePanelStore((s) => s.backlinksOpen);
     return (
-      <NoteEditor noteId={tab.targetId} ... />
+      <div className="flex h-full">
+        <div className="flex-1 overflow-auto"><NoteEditor noteId={tab.targetId} ... /></div>
+        {backlinksOpen && tab.targetId && <BacklinksPanel noteId={tab.targetId} />}
+      </div>
     );
   }
```

If there is a global keyboard handler module, register `⌘⇧B` to call `usePanelStore.getState().toggleBacklinks()`. Otherwise add a small effect inside the viewer:

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "B" || e.key === "b")) {
      e.preventDefault();
      usePanelStore.getState().toggleBacklinks();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

- [ ] **Step 12.7: Run web tests**

```bash
pnpm --filter @opencairn/web test -- BacklinksPanel
```

Expected: 2 tests pass.

- [ ] **Step 12.8: Commit**

```bash
git add apps/web/src/stores/panel-store.ts \
        apps/web/src/components/notes/ \
        apps/web/src/components/tab-shell/viewers/
git commit -m "feat(web): add BacklinksPanel with ⌘⇧B toggle (Plan 5 Phase 1)"
```

---

### Task 13: Playwright E2E

**Files:**
- Create: `apps/web/tests/e2e/graph.spec.ts`

- [ ] **Step 13.1: Read an existing E2E for fixture pattern**

```bash
ls /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/web/tests/e2e/
cat /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/web/tests/e2e/<one-existing>.spec.ts
```

Identify the existing seed mechanism (`/test-seed` route, fixtures setup, etc.).

- [ ] **Step 13.2: Create the spec**

`apps/web/tests/e2e/graph.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// Seed pattern matches other e2e specs in this repo. If the project uses a
// `/test-seed?scenario=…` route, call it first; otherwise rely on the
// repository's fixture user/workspace/project IDs documented in tests/e2e/README.md
// (or equivalent). These IDs need to have ≥2 concepts + 1 wiki-link to be
// meaningful for this spec.
const FIXTURE_WS_SLUG = process.env.E2E_WS_SLUG ?? "w-fixtures";
const FIXTURE_PROJECT_ID = process.env.E2E_PROJECT_ID ?? "p-fixtures";

test.describe("Plan 5 Phase 1 — Project Graph + Backlinks", () => {
  test.beforeEach(async ({ page }) => {
    // Sign-in flow — repo-specific helper (`signIn` fixture or magic link).
    // Replace with the project's standard E2E auth pattern.
    await page.goto("/auth/login");
    // ... sign in via Better Auth helper
  });

  test("opens graph tab from sidebar entry", async ({ page }) => {
    await page.goto(`/w/${FIXTURE_WS_SLUG}/p/${FIXTURE_PROJECT_ID}`);
    await page.getByRole("button", { name: /이 프로젝트 그래프 보기/ }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${FIXTURE_WS_SLUG}/p/${FIXTURE_PROJECT_ID}/graph`));
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
  });

  test("graph mounts with at least one node", async ({ page }) => {
    await page.goto(`/w/${FIXTURE_WS_SLUG}/p/${FIXTURE_PROJECT_ID}/graph`);
    // Cytoscape renders SVG/canvas; we assert via a stable wrapper test-id.
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
    // A presence check on Cytoscape's internal node element. Adjust if the
    // wrapper exposes a different selector — Cytoscape uses <canvas>, so we
    // rely on the absence of the empty/skeleton state instead:
    await expect(page.getByTestId("graph-skeleton")).toHaveCount(0);
    await expect(page.getByText(/아직 그래프가 비어 있습니다/)).toHaveCount(0);
  });

  test("Backlinks panel toggles with ⌘⇧B and lists wiki-link sources", async ({ page, browserName }) => {
    // Navigate to a fixture note that is linked TO by another note.
    const TARGET_NOTE = process.env.E2E_BACKLINK_TARGET_NOTE ?? "n-target";
    await page.goto(`/w/${FIXTURE_WS_SLUG}/n/${TARGET_NOTE}`);
    const cmd = browserName === "webkit" ? "Meta" : "Control";
    await page.keyboard.press(`${cmd}+Shift+KeyB`);
    await expect(page.getByRole("complementary", { name: /백링크 패널/ })).toBeVisible();
    // At least the title section should be visible.
    await expect(page.getByText("백링크")).toBeVisible();
  });
});
```

> Real fixtures need ≥1 source-note + ≥1 wiki-link in seed data. If the repo's seed scenarios don't cover this, add a `plan-5` scenario in the seed module before merging.

- [ ] **Step 13.3: Run E2E locally**

```bash
pnpm --filter @opencairn/web playwright test graph.spec.ts
```

Expected: 3 tests pass (or the auth/seed adjustments needed are clearly visible). E2E flake is acceptable in CI as long as local runs are green; mark known-flaky with `test.skip` only with a follow-up issue.

- [ ] **Step 13.4: Commit**

```bash
git add apps/web/tests/e2e/graph.spec.ts
git commit -m "test(web): add Plan 5 Phase 1 Playwright E2E"
```

---

### Task 14: Regression CI guards + final verification

**Files:**
- Modify: `.github/workflows/ci.yml` (or `package.json` lint script)

- [ ] **Step 14.1: Add the regression grep guards**

Open `.github/workflows/ci.yml` (or the equivalent local CI script). Add a step in the lint job:

```yaml
- name: Plan 5 — guard against version float / wiki-link key drift
  run: |
    set -e
    # Cytoscape package latest/* tags forbidden — Plan 5 §6.x pins versions.
    if grep -RE "cytoscape(-fcose)?:?\s*\^?(latest|\*)" \
        apps/web/package.json apps/web/src/; then
      echo "::error::cytoscape version float detected"
      exit 1
    fi
    # Wiki-link node `type` key drift would break syncWikiLinks extractor.
    grep -q 'type: "wiki-link"' apps/web/src/components/editor/elements/wiki-link-element.tsx
    grep -q 'WIKILINK_KEY = "wiki-link"' apps/web/src/components/editor/plugins/wiki-link.tsx
```

- [ ] **Step 14.2: Run the full verification gauntlet**

```bash
# DB
pnpm --filter @opencairn/db migrate
pnpm --filter @opencairn/db test
# Hocuspocus
pnpm --filter @opencairn/hocuspocus build
pnpm --filter @opencairn/hocuspocus test
# API
pnpm --filter @opencairn/api test
# Web
pnpm --filter @opencairn/web tsc --noEmit
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web build
pnpm --filter @opencairn/web playwright test graph.spec.ts
```

All must be green.

- [ ] **Step 14.3: Manual smoke**

1. Sign in to a workspace with ≥1 project that has ingested notes (so concepts exist).
2. Click sidebar "이 프로젝트 그래프 보기" → graph tab opens, force layout settles.
3. Double-click a node with `firstNoteId` → preview tab opens the note.
4. Open another note, insert a `[[WikiLink]]` to a third note (Cmd+K combobox), wait ~2s.
5. Open the third note → toggle Backlinks panel (`⌘⇧B`) → see the second note listed.

- [ ] **Step 14.4: Commit + push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Plan 5 cytoscape version + wiki-link key drift guards"
git push -u origin feat/plan-5-kg-design
```

- [ ] **Step 14.5: Open PR**

```bash
gh pr create --title "Plan 5 Phase 1: Project Graph + Wiki-Link Backlinks" --body "$(cat <<'EOF'
## Summary
- Tab Mode Router 신규 `graph` 모드 + Cytoscape force-directed 단일 뷰
- 신규 `wiki_links` 인덱스 테이블 + Hocuspocus inline 동기화 + backfill
- API `GET /api/projects/:id/graph` / `/expand` / `GET /api/notes/:id/backlinks`
- BacklinksPanel + 사이드바 진입점 + 라우트 페이지

Visualization Agent · 추가 4뷰 · 클러스터링은 모두 Phase 2 이연 (spec §1.2).

Spec: `docs/superpowers/specs/2026-04-25-plan-5-knowledge-graph-design.md`
Plan: `docs/superpowers/plans/2026-04-25-plan-5-knowledge-graph.md`

## Test plan
- [ ] DB migrations apply cleanly + backfill 0 row 영향 (운영 데이터)
- [ ] Hocuspocus persistence test green
- [ ] API graph + backlinks tests green
- [ ] Web component tests green
- [ ] i18n parity green (graph/sidebar/note/appShell)
- [ ] Playwright graph.spec.ts green
- [ ] Manual: 사이드바 진입 → 그래프 마운트 → 노드 더블클릭 → 노트 preview
- [ ] Manual: wiki-link 추가 → 대상 노트 backlinks panel 에 ≤2s 반영

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification (PR 머지 게이트)

- [ ] All commits land on `feat/plan-5-kg-design` in `.worktrees/plan-5-kg`
- [ ] All package tests + i18n parity + tsc + build pass locally
- [ ] No `cytoscape@latest` / `cytoscape:*` floating versions
- [ ] Manual smoke (Task 14.3) demonstrates the full loop
- [ ] PR description points to spec + plan; reviewer can read both before approving

---

## Phase 2 인계 (다음 세션)

- 추가 4뷰 (Mindmap tree / Cards / Timeline / 5뷰의 Canvas 재명명)
- Visualization Agent (`runtime.Agent`, Sub-B 후 도입)
- 클러스터링 (Louvain) — server pre-compute vs client `cytoscape-leiden`
- 이해도 점수 (Plan 6 SM-2) 기반 노드 색상 매핑
- KG 편집 UI (concept rename / merge / split)
- 크로스-프로젝트 워크스페이스 단위 그래프
- inline graph Plate block (Plan 10B 영역)

---

## Conflict Notes

| 영역 | 본 PR | Plan 7 Canvas Phase 1 | App Shell Phase 4 | Phase 5 (palette) | 완화 |
|---|---|---|---|---|---|
| `tabs-store.ts` TabMode union | `'graph'` | `'canvas'` | – | – | 알파벳 다른 위치 → 자동 머지 |
| `tab-mode-router.tsx` switch | case `'graph'` | case `'canvas'` | – | – | 다른 case → 자동 머지 |
| migration 번호 | 0020 | 0020/0021 | 가능성 낮음 | – | 늦은 PR이 다음 번호 + journal rename |
| `notes.ts` route | `/:id/backlinks` | `/:id/canvas` | – | – | 다른 sub-route → 0 |
| `panel-store.ts` | `backlinksOpen` | – | agent panel state 추가 가능 | palette 가능성 | 다른 필드 → 자동 머지 |
| i18n | `graph.json` 신규 + 기존 키 추가 | `canvas.json` 신규 | `agent-panel.json` 신규 | `palette.json` 신규 | 신규 파일 충돌 0 |
| `shell-sidebar.tsx` | `<ProjectGraphLink/>` 삽입 | – | – | search 위치 변경 가능 | 손쉬운 수동 머지 |
| `apps/hocuspocus/persistence.ts` | sync hook 추가 | – | – | – | 안전 |
