# App Shell Phase 2 — Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1 placeholder sidebar with the real left-panel UI: workspace switcher dropdown, global nav (4 icons + "더보기"), project hero dropdown, scoped search shortcut, virtualized project-scoped tree with drag-drop + keyboard + inline rename, and a footer with user + notifications + workspace settings entry. Includes the backend tree API and SSE meta stream.

**Architecture:**
- Postgres `ltree` materialized-path column on `pages` (ADR 009 decided in Task 1) for `O(log n)` tree queries and move operations.
- `GET /api/projects/:id/tree?parent_id=X` returns 2-depth prefetch; `GET /api/projects/:id/permissions` batches project-level permissions; `GET /api/stream/projects/:id/tree` SSE streams `page.created/renamed/moved/deleted/restored` events.
- Frontend: `react-arborist` for virtualization + keyboard + focus management; `@dnd-kit/core` for 3-way drag-drop and accessibility; `zustand` selectors to prevent reconciliation bombs; `@tanstack/react-query` for server state + SSE-driven invalidation.

**Tech Stack:** Drizzle ORM + `ltree`, Hono (API), React 19, `react-arborist`, `@dnd-kit/core` + `@dnd-kit/sortable`, Zustand, React Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §4 (Sidebar), §9 (workspace switch), §11.3–11.5 (API + migration).
**Depends on:** Phase 1 merged (stores, AppShell, route scaffolds).

---

## File Structure

**New files:**

```
docs/architecture/adr/009-page-tree-storage.md                # decision record
packages/db/drizzle/NNNN_pages_ltree.sql                      # schema migration
packages/db/src/schema/pages.ts                               # +path column (likely existing file)

apps/api/src/routes/
├── projects-tree.ts                                          # GET /api/projects/:id/tree
├── projects-permissions.ts                                   # GET /api/projects/:id/permissions
└── stream-projects-tree.ts                                   # SSE

apps/api/src/lib/
├── tree-queries.ts                                           # ltree CRUD helpers
└── tree-events.ts                                            # event bus + SSE fanout

apps/web/src/components/sidebar/
├── sidebar.tsx                                               # replaces PlaceholderSidebar
├── workspace-switcher.tsx
├── global-nav.tsx
├── more-menu.tsx                                             # ⋯ popover
├── project-hero.tsx
├── project-switcher.tsx                                      # dropdown body
├── scoped-search.tsx
├── project-tree.tsx                                          # react-arborist wrapper
├── project-tree-node.tsx                                     # custom row renderer
├── tree-context-menu.tsx                                     # right-click + ⋯ button
├── sidebar-footer.tsx
└── sidebar-empty-state.tsx                                   # no-projects state

apps/web/src/hooks/
├── use-project-tree.ts                                       # React Query + SSE
├── use-tree-drag-drop.ts                                     # dnd-kit orchestration
└── use-tree-keyboard.ts                                      # ↑↓→←/Enter/F2/Space/⌘Del
```

**Modified files:**

```
apps/web/src/components/shell/app-shell.tsx                   # import real Sidebar
apps/api/src/routes/index.ts                                  # mount new routes
packages/db/src/schema/pages.ts                               # +path column
messages/ko/sidebar.json, messages/en/sidebar.json            # i18n strings
```

**Tests:**

```
apps/api/tests/projects-tree.test.ts
apps/api/tests/projects-permissions.test.ts
apps/api/tests/stream-projects-tree.test.ts
apps/api/tests/tree-queries.test.ts
apps/web/src/components/sidebar/*.test.tsx                    # component-level
apps/web/src/hooks/use-project-tree.test.tsx
apps/web/src/hooks/use-tree-keyboard.test.tsx
apps/web/tests/e2e/sidebar.spec.ts
```

---

## Task 1: ADR 009 — page tree storage (`ltree` vs closure table)

Block dependency for the rest of Plan 2. Short decision document rather than a commit-worthy investigation; the spec already argues for `ltree` on read-heavy + small-move workloads. This task formalizes the call.

**Files:**
- Create: `docs/architecture/adr/009-page-tree-storage.md`

- [ ] **Step 1.1: Write the ADR**

```markdown
# ADR 009 — Page Tree Storage

**Date:** 2026-04-23
**Status:** Accepted
**Context spec:** 2026-04-23-app-shell-redesign-design.md §4.6

## Decision

Use Postgres `ltree` materialized-path column on `pages`.

## Options considered

| Option | Read (subtree) | Write (move) | Schema cost | Ecosystem |
|--------|----------------|--------------|-------------|-----------|
| `ltree` | `path <@ ancestor` uses GiST, O(log n) | Update subtree paths on move, bounded by subtree size | 1 column + GiST index | Postgres native, `drizzle-orm/pg-core` supports custom column |
| Closure table | Join on (ancestor, descendant), O(1) per pair | Insert/delete all ancestor rows on move, O(depth × subtree) | Extra table, 2 FKs, triggers to maintain | ORM-agnostic |
| `parent_id` only | Recursive CTE, O(depth) | Single row update | Already present | Built-in |

Workload facts (from product): 5K pages per project, typical subtree size < 100, moves are rare (< 1/user/session), list-and-expand is constant traffic. `ltree` fits.

## Consequences

- Requires `CREATE EXTENSION ltree;` on prod + dev DBs (already enabled per 2026-03 migration 0007).
- Drizzle custom column definition needed (`ltree`). Wrap in `customType` helper.
- Move operation must update descendant paths in a single transaction:
  ```sql
  UPDATE pages SET path = :newPrefix || subpath(path, nlevel(:oldPrefix))
  WHERE path <@ :oldPrefix;
  ```

## Review trigger

Revisit if a project grows > 50K pages AND move operations cluster (e.g., batch reorganization features).
```

- [ ] **Step 1.2: Commit**

```bash
git add docs/architecture/adr/009-page-tree-storage.md
git commit -m "docs(adr): adopt postgres ltree for page tree storage"
```

---

## Task 2: Add `pages.path` column + `ltree` custom type

**Files:**
- Modify: `packages/db/src/schema/pages.ts`
- Create: `packages/db/src/custom-types.ts` edit (or new) — `ltree` customType
- Create: migration (auto-numbered by Drizzle)

- [ ] **Step 2.1: Add ltree custom type**

Open `packages/db/src/custom-types.ts` (exists per schema listing). Add:

```ts
import { customType } from "drizzle-orm/pg-core";

export const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => "ltree",
  toDriver: (value) => value,
  fromDriver: (value) => value,
});
```

- [ ] **Step 2.2: Add `path` column to `pages` schema**

Open `packages/db/src/schema/pages.ts`. Add inside the existing `pgTable("pages", {...})`:

```ts
path: ltree("path").notNull(),
```

Also add an index definition in the second arg:
```ts
(t) => [
  // ...existing indices
  index("pages_path_gist").using("gist", t.path),
]
```

Import `ltree` from `"../custom-types"` and `index` from `"drizzle-orm/pg-core"` if not already imported.

- [ ] **Step 2.3: Write the migration by hand**

`pnpm db:generate` does not emit `USING gist` nor `::ltree` casts cleanly. Create the migration manually. Find the current highest number in `packages/db/drizzle/`, use `N+1`. Filename body: `pages_ltree_path`.

```sql
-- Ensure extension (idempotent)
CREATE EXTENSION IF NOT EXISTS ltree;

-- Add column nullable first, backfill, then enforce NOT NULL
ALTER TABLE "pages" ADD COLUMN "path" ltree;

-- Backfill: path = project_id::text || '.' || id::text with dashes replaced.
-- ltree labels only allow [A-Za-z0-9_], so UUIDs need dashes removed.
UPDATE "pages" SET "path" = (
  regexp_replace("project_id"::text, '-', '_', 'g')
  || '.'
  || regexp_replace("id"::text, '-', '_', 'g')
)::ltree
WHERE "parent_id" IS NULL;

-- Parent-ed rows: recursive CTE fills in reverse breadth order.
-- Since pages.parent_id forms a DAG rooted at parent_id IS NULL, this converges.
WITH RECURSIVE walk AS (
  SELECT p.id, (
    regexp_replace(p.project_id::text, '-', '_', 'g')
    || '.' || regexp_replace(p.id::text, '-', '_', 'g')
  )::ltree AS new_path
  FROM "pages" p WHERE p.parent_id IS NULL
  UNION ALL
  SELECT c.id, (w.new_path || regexp_replace(c.id::text, '-', '_', 'g'))::ltree
  FROM "pages" c JOIN walk w ON c.parent_id = w.id
)
UPDATE "pages" p SET "path" = w.new_path FROM walk w WHERE p.id = w.id;

ALTER TABLE "pages" ALTER COLUMN "path" SET NOT NULL;

CREATE INDEX "pages_path_gist" ON "pages" USING gist ("path");
```

- [ ] **Step 2.4: Apply migration**

```bash
pnpm --filter @opencairn/db db:migrate
```

Expected: no errors. Verify:
```sql
\d pages
-- path column of type ltree, pages_path_gist index present
SELECT path FROM pages LIMIT 3;
-- paths look like "proj_uuid_no_dashes.page_uuid_no_dashes"
```

- [ ] **Step 2.5: Commit**

```bash
git add packages/db/src/custom-types.ts \
        packages/db/src/schema/pages.ts \
        packages/db/drizzle/
git commit -m "feat(db): add ltree path column to pages with gist index"
```

---

## Task 3: Tree query helpers (`apps/api/src/lib/tree-queries.ts`)

Pure SQL wrappers for: list children of a parent, get subtree, move subtree, delete subtree. Tests hit a live test DB (existing harness in `apps/api/tests/`).

**Files:**
- Create: `apps/api/src/lib/tree-queries.ts`
- Create: `apps/api/tests/tree-queries.test.ts`

- [ ] **Step 3.1: Write failing test**

Create `apps/api/tests/tree-queries.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { seedProject, seedPage, resetDb } from "./helpers";
import {
  listChildren,
  listChildrenForParents,
  getSubtree,
  movePage,
} from "../src/lib/tree-queries";

describe("tree-queries", () => {
  beforeEach(resetDb);

  it("listChildren returns direct children with counts", async () => {
    const project = await seedProject();
    const root = await seedPage({ projectId: project.id, parentId: null, title: "Root" });
    const a = await seedPage({ projectId: project.id, parentId: root.id, title: "A" });
    const b = await seedPage({ projectId: project.id, parentId: root.id, title: "B" });
    await seedPage({ projectId: project.id, parentId: a.id, title: "A1" });

    const rows = await listChildren({ projectId: project.id, parentId: root.id });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === a.id)?.childCount).toBe(1);
    expect(rows.find((r) => r.id === b.id)?.childCount).toBe(0);
  });

  it("listChildrenForParents batches children of many parents in one query", async () => {
    const project = await seedProject();
    const r1 = await seedPage({ projectId: project.id, parentId: null, title: "R1" });
    const r2 = await seedPage({ projectId: project.id, parentId: null, title: "R2" });
    const r3 = await seedPage({ projectId: project.id, parentId: null, title: "R3" });
    const r1a = await seedPage({ projectId: project.id, parentId: r1.id, title: "R1.A" });
    const r1b = await seedPage({ projectId: project.id, parentId: r1.id, title: "R1.B" });
    const r2a = await seedPage({ projectId: project.id, parentId: r2.id, title: "R2.A" });

    const grouped = await listChildrenForParents({
      projectId: project.id,
      parentIds: [r1.id, r2.id, r3.id],
    });

    expect(grouped.get(r1.id)?.map((r) => r.id).sort()).toEqual([r1a.id, r1b.id].sort());
    expect(grouped.get(r2.id)?.map((r) => r.id)).toEqual([r2a.id]);
    expect(grouped.get(r3.id)).toEqual([]); // no children, still present
  });

  it("listChildrenForParents returns empty map for empty input", async () => {
    const project = await seedProject();
    const grouped = await listChildrenForParents({ projectId: project.id, parentIds: [] });
    expect(grouped.size).toBe(0);
  });

  it("getSubtree returns depth-first including the root", async () => {
    const project = await seedProject();
    const root = await seedPage({ projectId: project.id, parentId: null });
    const a = await seedPage({ projectId: project.id, parentId: root.id });
    const a1 = await seedPage({ projectId: project.id, parentId: a.id });

    const ids = (await getSubtree({ projectId: project.id, rootId: root.id })).map((r) => r.id);
    expect(ids).toEqual([root.id, a.id, a1.id]);
  });

  it("movePage reparents node and updates descendant paths", async () => {
    const project = await seedProject();
    const p1 = await seedPage({ projectId: project.id, parentId: null });
    const p2 = await seedPage({ projectId: project.id, parentId: null });
    const child = await seedPage({ projectId: project.id, parentId: p1.id });
    const grand = await seedPage({ projectId: project.id, parentId: child.id });

    await movePage({ projectId: project.id, pageId: child.id, newParentId: p2.id });

    const subtreeOfP2 = await getSubtree({ projectId: project.id, rootId: p2.id });
    expect(subtreeOfP2.map((r) => r.id)).toEqual([p2.id, child.id, grand.id]);
  });

  it("movePage refuses moves that cross project boundaries", async () => {
    const pA = await seedProject();
    const pB = await seedProject();
    const page = await seedPage({ projectId: pA.id, parentId: null });

    await expect(
      movePage({ projectId: pA.id, pageId: page.id, newParentId: null, newProjectId: pB.id }),
    ).rejects.toThrow(/cross-project/);
  });
});
```

- [ ] **Step 3.2: Run — expect failure**

```bash
pnpm --filter @opencairn/api test tree-queries
```

Expected: all fail (module missing).

- [ ] **Step 3.3: Implement**

Create `apps/api/src/lib/tree-queries.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { db, pages } from "@opencairn/db";

function label(uuid: string): string {
  return uuid.replace(/-/g, "_");
}

export interface TreeRow {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  pathText: string;
  childCount: number;
}

export async function listChildren(opts: {
  projectId: string;
  parentId: string | null;
}): Promise<TreeRow[]> {
  const parentClause = opts.parentId
    ? sql`parent_id = ${opts.parentId}`
    : sql`parent_id IS NULL`;

  const rows = await db.execute<TreeRow>(sql`
    SELECT
      p.id,
      p.parent_id AS "parentId",
      p.title,
      p.icon,
      p.path::text AS "pathText",
      (
        SELECT COUNT(*)::int
        FROM pages c
        WHERE c.parent_id = p.id
      ) AS "childCount"
    FROM pages p
    WHERE p.project_id = ${opts.projectId}
      AND ${parentClause}
      AND p.deleted_at IS NULL
    ORDER BY p.position ASC NULLS LAST, p.created_at ASC
  `);
  return rows.rows;
}

/**
 * Batch sibling fetch: returns every direct child of the given parent ids in
 * one query, grouped by parentId. Avoids N+1 when the `/projects/:id/tree`
 * endpoint needs to prefetch grandchildren for every root. Parent ids must
 * all belong to `opts.projectId` — the caller is responsible for that check.
 * An empty `parentIds` returns an empty Map.
 */
export async function listChildrenForParents(opts: {
  projectId: string;
  parentIds: string[];
}): Promise<Map<string, TreeRow[]>> {
  const grouped = new Map<string, TreeRow[]>();
  if (opts.parentIds.length === 0) return grouped;

  const rows = await db.execute<TreeRow>(sql`
    SELECT
      p.id,
      p.parent_id AS "parentId",
      p.title,
      p.icon,
      p.path::text AS "pathText",
      (
        SELECT COUNT(*)::int
        FROM pages c
        WHERE c.parent_id = p.id
      ) AS "childCount"
    FROM pages p
    WHERE p.project_id = ${opts.projectId}
      AND p.parent_id = ANY(${opts.parentIds}::uuid[])
      AND p.deleted_at IS NULL
    ORDER BY p.position ASC NULLS LAST, p.created_at ASC
  `);

  for (const pid of opts.parentIds) grouped.set(pid, []);
  for (const row of rows.rows) {
    if (row.parentId) grouped.get(row.parentId)?.push(row);
  }
  return grouped;
}

export async function getSubtree(opts: {
  projectId: string;
  rootId: string;
}): Promise<TreeRow[]> {
  const rows = await db.execute<TreeRow>(sql`
    WITH root AS (
      SELECT path FROM pages WHERE id = ${opts.rootId} AND project_id = ${opts.projectId}
    )
    SELECT
      p.id,
      p.parent_id AS "parentId",
      p.title,
      p.icon,
      p.path::text AS "pathText",
      0 AS "childCount"
    FROM pages p, root r
    WHERE p.path <@ r.path
      AND p.project_id = ${opts.projectId}
      AND p.deleted_at IS NULL
    ORDER BY nlevel(p.path), p.position ASC NULLS LAST, p.created_at ASC
  `);
  return rows.rows;
}

export async function movePage(opts: {
  projectId: string;
  pageId: string;
  newParentId: string | null;
  newProjectId?: string;
}): Promise<void> {
  if (opts.newProjectId && opts.newProjectId !== opts.projectId) {
    throw new Error("cross-project move not allowed");
  }

  await db.transaction(async (tx) => {
    const [page] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.id, opts.pageId), eq(pages.projectId, opts.projectId)));
    if (!page) throw new Error("page not found");

    const oldPathText = page.path;

    let newPrefix: string;
    if (opts.newParentId) {
      const [parent] = await tx
        .select()
        .from(pages)
        .where(and(eq(pages.id, opts.newParentId), eq(pages.projectId, opts.projectId)));
      if (!parent) throw new Error("new parent not found");
      newPrefix = `${parent.path}.${label(opts.pageId)}`;
    } else {
      newPrefix = `${label(opts.projectId)}.${label(opts.pageId)}`;
    }

    await tx.execute(sql`
      UPDATE pages SET path = (${newPrefix}::ltree || subpath(path, nlevel(${oldPathText}::ltree)))
      WHERE path <@ ${oldPathText}::ltree AND project_id = ${opts.projectId}
    `);

    await tx
      .update(pages)
      .set({ parentId: opts.newParentId })
      .where(eq(pages.id, opts.pageId));
  });
}
```

- [ ] **Step 3.4: Re-run**

```bash
pnpm --filter @opencairn/api test tree-queries
```

Expected: four pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/lib/tree-queries.ts apps/api/tests/tree-queries.test.ts
git commit -m "feat(api): add ltree-based tree query helpers"
```

---

## Task 4: `GET /api/projects/:id/tree` endpoint

Returns direct children with 1-level grandchild prefetch (spec §4.6.1). Auth: project membership.

**Files:**
- Create: `apps/api/src/routes/projects-tree.ts`
- Modify: `apps/api/src/routes/index.ts` (mount)
- Create: `apps/api/tests/projects-tree.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `apps/api/tests/projects-tree.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestClient, seedUser, seedProject, seedPage, addMember, resetDb } from "./helpers";

describe("GET /api/projects/:id/tree", () => {
  beforeEach(resetDb);

  it("returns top-level children when parent_id omitted", async () => {
    const user = await seedUser();
    const project = await seedProject({ ownerId: user.id });
    await seedPage({ projectId: project.id, parentId: null, title: "Root 1" });
    await seedPage({ projectId: project.id, parentId: null, title: "Root 2" });

    const client = createTestClient({ userId: user.id });
    const res = await client.get(`/api/projects/${project.id}/tree`);
    expect(res.status).toBe(200);
    expect(res.body.pages).toHaveLength(2);
    expect(res.body.pages[0].title).toBe("Root 1");
  });

  it("prefetches one level of grandchildren", async () => {
    const user = await seedUser();
    const project = await seedProject({ ownerId: user.id });
    const r = await seedPage({ projectId: project.id, parentId: null });
    await seedPage({ projectId: project.id, parentId: r.id, title: "child" });

    const client = createTestClient({ userId: user.id });
    const res = await client.get(`/api/projects/${project.id}/tree`);
    expect(res.body.pages[0].children).toHaveLength(1);
    expect(res.body.pages[0].children[0].title).toBe("child");
  });

  it("requires project membership", async () => {
    const owner = await seedUser();
    const outsider = await seedUser();
    const project = await seedProject({ ownerId: owner.id });

    const client = createTestClient({ userId: outsider.id });
    const res = await client.get(`/api/projects/${project.id}/tree`);
    expect(res.status).toBe(403);
  });

  it("parent_id query filters to direct children of that parent", async () => {
    const user = await seedUser();
    const project = await seedProject({ ownerId: user.id });
    const r = await seedPage({ projectId: project.id, parentId: null });
    await seedPage({ projectId: project.id, parentId: r.id, title: "c1" });
    await seedPage({ projectId: project.id, parentId: r.id, title: "c2" });

    const client = createTestClient({ userId: user.id });
    const res = await client.get(`/api/projects/${project.id}/tree?parent_id=${r.id}`);
    expect(res.body.pages).toHaveLength(2);
  });
});
```

- [ ] **Step 4.2: Run — expect failure**

- [ ] **Step 4.3: Implement**

Create `apps/api/src/routes/projects-tree.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { listChildren, listChildrenForParents } from "../lib/tree-queries";
import { requireSession } from "../lib/auth";
import { requireProjectMember } from "../lib/permissions";

const query = z.object({ parent_id: z.string().uuid().optional() });

export const projectsTreeRoute = new Hono()
  .get(
    "/projects/:projectId/tree",
    zValidator("query", query),
    async (c) => {
      const session = await requireSession(c);
      const projectId = c.req.param("projectId");
      await requireProjectMember(session.userId, projectId);
      const { parent_id } = c.req.valid("query");

      const roots = await listChildren({ projectId, parentId: parent_id ?? null });

      // Batch-fetch grandchildren in a single query to avoid N+1. We only
      // query for roots that actually have children — the childCount sub-
      // select above is already paid for, so reuse it as a filter.
      const parentsWithChildren = roots.filter((r) => r.childCount > 0).map((r) => r.id);
      const grouped = await listChildrenForParents({
        projectId,
        parentIds: parentsWithChildren,
      });

      return c.json({
        pages: roots.map((r) => ({
          id: r.id,
          parent_id: r.parentId,
          title: r.title,
          icon: r.icon,
          child_count: r.childCount,
          children: (grouped.get(r.id) ?? []).map((ch) => ({
            id: ch.id,
            parent_id: ch.parentId,
            title: ch.title,
            icon: ch.icon,
            child_count: ch.childCount,
          })),
        })),
      });
    },
  );
```

Mount in `apps/api/src/routes/index.ts`:
```ts
.route("/", projectsTreeRoute)
```

Ensure `requireProjectMember` exists in `apps/api/src/lib/permissions.ts`; if not, add it alongside existing workspace helpers — throws 403 on non-member, returns `void` otherwise.

- [ ] **Step 4.4: Re-run**

```bash
pnpm --filter @opencairn/api test projects-tree
```

Expected: four pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/routes/projects-tree.ts \
        apps/api/src/routes/index.ts \
        apps/api/src/lib/permissions.ts \
        apps/api/tests/projects-tree.test.ts
git commit -m "feat(api): add project tree endpoint with 2-level prefetch"
```

---

## Task 5: `GET /api/projects/:id/permissions` (batched perms)

Returns one object collapsing the caller's role + per-branch overrides so the sidebar never checks permissions per-node (spec §4.6.1, §4.10).

**Files:**
- Create: `apps/api/src/routes/projects-permissions.ts`
- Create: `apps/api/tests/projects-permissions.test.ts`

- [ ] **Step 5.1: Failing test**

```ts
// apps/api/tests/projects-permissions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestClient, seedUser, seedProject, setProjectRole, setPagePermission, resetDb,
} from "./helpers";

describe("GET /api/projects/:id/permissions", () => {
  beforeEach(resetDb);

  it("returns role=owner for the project owner", async () => {
    const owner = await seedUser();
    const project = await seedProject({ ownerId: owner.id });
    const client = createTestClient({ userId: owner.id });
    const res = await client.get(`/api/projects/${project.id}/permissions`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("owner");
    expect(res.body.overrides).toEqual({});
  });

  it("collapses page-level overrides into a keyed map", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const project = await seedProject({ ownerId: owner.id });
    await setProjectRole({ projectId: project.id, userId: member.id, role: "viewer" });
    const pageId = crypto.randomUUID();
    await setPagePermission({ pageId, userId: member.id, role: "editor" });

    const client = createTestClient({ userId: member.id });
    const res = await client.get(`/api/projects/${project.id}/permissions`);
    expect(res.body.role).toBe("viewer");
    expect(res.body.overrides[pageId]).toBe("editor");
  });

  it("403 for non-members", async () => {
    const outsider = await seedUser();
    const project = await seedProject({ ownerId: (await seedUser()).id });
    const client = createTestClient({ userId: outsider.id });
    expect((await client.get(`/api/projects/${project.id}/permissions`)).status).toBe(403);
  });
});
```

- [ ] **Step 5.2: Implement**

```ts
// apps/api/src/routes/projects-permissions.ts
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, projects, projectPermissions, pagePermissions,
} from "@opencairn/db";
import { requireSession } from "../lib/auth";

export const projectsPermissionsRoute = new Hono().get(
  "/projects/:projectId/permissions",
  async (c) => {
    const session = await requireSession(c);
    const projectId = c.req.param("projectId");

    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!proj) return c.json({ error: "not_found" }, 404);

    let role: "owner" | "admin" | "editor" | "commenter" | "viewer" | null = null;
    if (proj.ownerId === session.userId) role = "owner";
    else {
      const [pp] = await db
        .select()
        .from(projectPermissions)
        .where(and(
          eq(projectPermissions.projectId, projectId),
          eq(projectPermissions.userId, session.userId),
        ));
      role = (pp?.role as typeof role) ?? null;
    }

    if (!role) return c.json({ error: "forbidden" }, 403);

    const overrides = await db
      .select()
      .from(pagePermissions)
      .where(eq(pagePermissions.userId, session.userId));

    const map: Record<string, string> = {};
    for (const row of overrides) map[row.pageId] = row.role;

    return c.json({ role, overrides: map });
  },
);
```

Mount in `routes/index.ts`.

- [ ] **Step 5.3: Run, adjust, commit**

```bash
pnpm --filter @opencairn/api test projects-permissions
git add apps/api/src/routes/projects-permissions.ts \
        apps/api/src/routes/index.ts \
        apps/api/tests/projects-permissions.test.ts
git commit -m "feat(api): batch project permissions with page-level overrides"
```

---

## Task 6: SSE tree stream `/api/stream/projects/:id/tree`

Sends `page.created`, `renamed`, `moved`, `deleted`, `restored` events. Uses an in-process event bus tied to page CRUD routes.

**Files:**
- Create: `apps/api/src/lib/tree-events.ts`
- Create: `apps/api/src/routes/stream-projects-tree.ts`
- Modify: existing page CRUD handlers to call `treeEventBus.emit(...)`.
- Create: `apps/api/tests/stream-projects-tree.test.ts`

- [ ] **Step 6.1: Event bus**

Create `apps/api/src/lib/tree-events.ts`:

```ts
import { EventEmitter } from "node:events";

export type TreeEventKind =
  | "page.created" | "page.renamed" | "page.moved" | "page.deleted" | "page.restored";

export interface TreeEvent {
  kind: TreeEventKind;
  projectId: string;
  pageId: string;
  parentId: string | null;
  title?: string;
  icon?: string | null;
  at: string;
}

class TreeEventBus extends EventEmitter {
  emitEvent(e: TreeEvent) {
    this.emit(`project:${e.projectId}`, e);
  }
  subscribe(projectId: string, handler: (e: TreeEvent) => void): () => void {
    const ch = `project:${projectId}`;
    this.on(ch, handler);
    return () => this.off(ch, handler);
  }
}

export const treeEventBus = new TreeEventBus();
treeEventBus.setMaxListeners(1000);
```

- [ ] **Step 6.2: Wire existing page CRUD to emit**

Grep existing `apps/api/src/routes/` for page CRUD routes. At each mutation success, call:

```ts
import { treeEventBus } from "../lib/tree-events";
treeEventBus.emitEvent({
  kind: "page.created", // or renamed/moved/deleted/restored per handler
  projectId,
  pageId,
  parentId,
  title, icon,
  at: new Date().toISOString(),
});
```

Add at the last success path, after the DB transaction commits.

- [ ] **Step 6.3: SSE route**

Create `apps/api/src/routes/stream-projects-tree.ts`:

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { treeEventBus } from "../lib/tree-events";
import { requireSession } from "../lib/auth";
import { requireProjectMember } from "../lib/permissions";

export const streamProjectsTreeRoute = new Hono().get(
  "/stream/projects/:projectId/tree",
  async (c) => {
    const session = await requireSession(c);
    const projectId = c.req.param("projectId");
    await requireProjectMember(session.userId, projectId);

    return streamSSE(c, async (stream) => {
      const unsub = treeEventBus.subscribe(projectId, (e) => {
        stream.writeSSE({ event: e.kind, data: JSON.stringify(e) });
      });
      c.req.raw.signal.addEventListener("abort", () => unsub());
      const ka = setInterval(() => stream.writeSSE({ event: "ping", data: "1" }), 30_000);
      try {
        await new Promise<void>((resolve) =>
          c.req.raw.signal.addEventListener("abort", () => resolve()),
        );
      } finally {
        clearInterval(ka);
        unsub();
      }
    });
  },
);
```

Mount in `routes/index.ts`.

- [ ] **Step 6.4: Integration test**

```ts
// apps/api/tests/stream-projects-tree.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestClient, seedUser, seedProject, createPage, resetDb } from "./helpers";

describe("GET /api/stream/projects/:id/tree", () => {
  beforeEach(resetDb);

  it("receives page.created event", async () => {
    const user = await seedUser();
    const project = await seedProject({ ownerId: user.id });
    const client = createTestClient({ userId: user.id });

    const events: string[] = [];
    const controller = new AbortController();
    const ready = client.sse(`/api/stream/projects/${project.id}/tree`, {
      signal: controller.signal,
      onMessage: (e) => events.push(e.type),
    });
    await ready;

    await createPage({ projectId: project.id, parentId: null, title: "new", userId: user.id });

    await vi.waitFor(() => expect(events).toContain("page.created"), { timeout: 2000 });
    controller.abort();
  });
});
```

Adjust `client.sse` to whatever the existing harness exposes; if none, use the `EventSource` ponyfill pattern already in other SSE tests (search `apps/api/tests` for `streamSSE` consumers).

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/lib/tree-events.ts \
        apps/api/src/routes/stream-projects-tree.ts \
        apps/api/src/routes/index.ts \
        apps/api/src/routes/<pages-crud files> \
        apps/api/tests/stream-projects-tree.test.ts
git commit -m "feat(api): SSE stream for project tree events"
```

---

## Task 7: `useProjectTree` React Query + SSE hook

Frontend hook that fetches `/api/projects/:id/tree`, subscribes to `/api/stream/projects/:id/tree`, and fans out events into React Query cache updates.

**Files:**
- Create: `apps/web/src/hooks/use-project-tree.ts`
- Create: `apps/web/src/hooks/use-project-tree.test.tsx`

- [ ] **Step 7.1: Failing test**

```tsx
// apps/web/src/hooks/use-project-tree.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useProjectTree } from "./use-project-tree";

const mkQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

afterEach(() => fetchMock.mockReset());

describe("useProjectTree", () => {
  it("loads root pages on mount", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pages: [{ id: "p1", parent_id: null, title: "Root", icon: null, child_count: 0, children: [] }],
      }),
    });
    const qc = mkQc();
    const { result } = renderHook(() => useProjectTree({ projectId: "x" }), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.roots).toHaveLength(1));
    expect(result.current.roots[0].title).toBe("Root");
  });
});
```

(Full SSE integration is covered by e2e Task 15. The unit test here just ensures fetch wiring.)

- [ ] **Step 7.2: Implement**

```ts
// apps/web/src/hooks/use-project-tree.ts
"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface TreeNode {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  child_count: number;
  children?: TreeNode[];
}

const treeKey = (projectId: string, parentId: string | null) =>
  ["project-tree", projectId, parentId ?? "root"] as const;

export function useProjectTree(opts: { projectId: string }) {
  const qc = useQueryClient();
  const rootQuery = useQuery({
    queryKey: treeKey(opts.projectId, null),
    queryFn: async () => {
      const r = await fetch(`/api/projects/${opts.projectId}/tree`);
      if (!r.ok) throw new Error(`tree ${r.status}`);
      const body = (await r.json()) as { pages: TreeNode[] };
      return body.pages;
    },
  });

  useEffect(() => {
    const src = new EventSource(`/api/stream/projects/${opts.projectId}/tree`);
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: ["project-tree", opts.projectId] });
    src.addEventListener("page.created", invalidate);
    src.addEventListener("page.renamed", invalidate);
    src.addEventListener("page.moved", invalidate);
    src.addEventListener("page.deleted", invalidate);
    src.addEventListener("page.restored", invalidate);
    return () => src.close();
  }, [opts.projectId, qc]);

  async function loadChildren(parentId: string): Promise<TreeNode[]> {
    return await qc.fetchQuery({
      queryKey: treeKey(opts.projectId, parentId),
      queryFn: async () => {
        const r = await fetch(`/api/projects/${opts.projectId}/tree?parent_id=${parentId}`);
        if (!r.ok) throw new Error(`tree ${r.status}`);
        const body = (await r.json()) as { pages: TreeNode[] };
        return body.pages;
      },
    });
  }

  return { roots: rootQuery.data ?? [], isLoading: rootQuery.isLoading, loadChildren };
}
```

- [ ] **Step 7.3: Run + commit**

```bash
pnpm --filter @opencairn/web test use-project-tree
git add apps/web/src/hooks/use-project-tree.ts apps/web/src/hooks/use-project-tree.test.tsx
git commit -m "feat(web): add useProjectTree hook with SSE invalidation"
```

---

## Task 8: Workspace switcher component

Top-of-sidebar dropdown. Lists workspaces from `/api/workspaces/me`, shows pending invites, exposes "새 워크스페이스".

**Files:**
- Create: `apps/web/src/components/sidebar/workspace-switcher.tsx`
- Create: `apps/web/src/components/sidebar/workspace-switcher.test.tsx`

- [ ] **Step 8.1: Test (happy path + role badge + switch)**

```tsx
// apps/web/src/components/sidebar/workspace-switcher.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcher } from "./workspace-switcher";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

const mkQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("WorkspaceSwitcher", () => {
  it("opens menu and renders role badges", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { id: "1", slug: "acme", name: "ACME", role: "owner" },
          { id: "2", slug: "beta", name: "Beta", role: "viewer" },
        ],
        invites: [],
      }),
    }) as unknown as typeof fetch;

    const qc = mkQc();
    render(
      <QueryClientProvider client={qc}>
        <WorkspaceSwitcher />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /ACME/ }));
    expect(await screen.findByText(/Beta/)).toBeInTheDocument();
    expect(screen.getByText(/Owner/)).toBeInTheDocument();
    expect(screen.getByText(/Viewer/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.2: Implement**

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface Ws {
  id: string; slug: string; name: string; role: "owner" | "admin" | "editor" | "viewer";
}
interface Invite { id: string; workspace: { name: string }; }

export function WorkspaceSwitcher() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["workspaces-me"],
    queryFn: async () => {
      const r = await fetch("/api/workspaces/me");
      if (!r.ok) throw new Error();
      return (await r.json()) as { workspaces: Ws[]; invites: Invite[] };
    },
  });

  const current = data?.workspaces.find((w) => w.slug === wsSlug);
  const initial = (current?.name ?? "").charAt(0).toUpperCase() || "W";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left hover:bg-accent">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-semibold">
          {initial}
        </span>
        <span className="flex-1 truncate text-sm font-semibold">{current?.name ?? "..."}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>워크스페이스</DropdownMenuLabel>
        {data?.workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onSelect={() => router.push(`/ko/app/w/${w.slug}/`)}
            className="flex items-center justify-between"
          >
            <span className="truncate">{w.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {w.role}
            </span>
          </DropdownMenuItem>
        ))}
        {data?.invites.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>초대</DropdownMenuLabel>
            {data.invites.map((i) => (
              <DropdownMenuItem key={i.id} onSelect={() => router.push(`/ko/invites/${i.id}`)}>
                {i.workspace.name}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/ko/workspaces/new")}>
          + 새 워크스페이스
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

*Uses existing shadcn `dropdown-menu`; add via `pnpm dlx shadcn add dropdown-menu` if missing.*

- [ ] **Step 8.3: Hardcode locale fix later**

The `/ko/app/...` hardcode is a Phase 2 shortcut. Use `useLocale()` from `next-intl` if already imported elsewhere. Revise to `` `/${locale}/app/w/...` ``.

- [ ] **Step 8.4: Commit**

```bash
git add apps/web/src/components/sidebar/workspace-switcher.tsx \
        apps/web/src/components/sidebar/workspace-switcher.test.tsx \
        apps/web/src/components/ui/dropdown-menu.tsx
git commit -m "feat(web): add workspace switcher dropdown"
```

---

## Task 9: Global nav + "더보기" popover + project hero + footer

Four small components with repetitive structure. One task, multiple commits at the end.

**Files:**
- Create: `apps/web/src/components/sidebar/global-nav.tsx`
- Create: `apps/web/src/components/sidebar/more-menu.tsx`
- Create: `apps/web/src/components/sidebar/project-hero.tsx`
- Create: `apps/web/src/components/sidebar/project-switcher.tsx`
- Create: `apps/web/src/components/sidebar/sidebar-footer.tsx`
- Create: `apps/web/src/components/sidebar/scoped-search.tsx`

- [ ] **Step 9.1: Global nav**

```tsx
// apps/web/src/components/sidebar/global-nav.tsx
"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Home, FlaskConical, DownloadCloud } from "lucide-react";
import { MoreMenu } from "./more-menu";

export function GlobalNav() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const base = `/ko/app/w/${wsSlug}`;
  const items = [
    { href: `${base}/`, label: "대시보드", Icon: Home },
    { href: `${base}/research`, label: "Deep Research", Icon: FlaskConical },
    { href: `${base}/import`, label: "가져오기", Icon: DownloadCloud },
  ] as const;

  return (
    <nav className="flex items-center gap-1 border-b border-border px-2 py-1">
      {items.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          title={label}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-accent"
        >
          <Icon className="h-4 w-4" />
        </Link>
      ))}
      <MoreMenu base={base} />
    </nav>
  );
}
```

- [ ] **Step 9.2: More menu popover**

```tsx
// apps/web/src/components/sidebar/more-menu.tsx
"use client";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function MoreMenu({ base }: { base: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded hover:bg-accent">
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild><a href={`${base}/settings`}>워크스페이스 설정</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={`${base}/templates`}>템플릿 갤러리</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={`${base}/shared-links`}>공유 링크 관리</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={`${base}/trash`}>휴지통</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href="/feedback" target="_blank" rel="noreferrer">피드백 보내기</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href="/changelog" target="_blank" rel="noreferrer">무엇이 새로운가</a></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 9.3: Project hero + project switcher**

```tsx
// apps/web/src/components/sidebar/project-hero.tsx
"use client";
import { ChevronDown } from "lucide-react";
import { useCurrentProject } from "./use-current-project";
import { ProjectSwitcher } from "./project-switcher";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

export function ProjectHero() {
  const { project } = useCurrentProject();
  return (
    <Popover>
      <PopoverTrigger className="flex w-full items-center justify-between px-3 py-2 hover:bg-accent">
        <span className="truncate text-sm font-semibold">{project?.name ?? "프로젝트를 만들어 시작하세요"}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <ProjectSwitcher />
      </PopoverContent>
    </Popover>
  );
}
```

```tsx
// apps/web/src/components/sidebar/project-switcher.tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";

interface Project { id: string; name: string; last_activity_at: string | null; }

export function ProjectSwitcher() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["projects", wsSlug],
    queryFn: async () => {
      const r = await fetch(`/api/workspaces/${wsSlug}/projects`);
      if (!r.ok) throw new Error();
      return (await r.json()) as { projects: Project[] };
    },
  });

  return (
    <div className="flex max-h-80 flex-col overflow-auto p-1">
      {data?.projects.map((p) => (
        <button
          key={p.id}
          onClick={() => router.push(`/ko/app/w/${wsSlug}/p/${p.id}`)}
          className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        >
          {p.name}
        </button>
      ))}
      <button
        className="mt-1 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
        onClick={() => router.push(`/ko/app/w/${wsSlug}/new-project`)}
      >
        + 새 프로젝트
      </button>
    </div>
  );
}
```

Add a small `use-current-project.ts` co-located helper that reads `wsSlug`+`projectId` from params or from the tab store.

- [ ] **Step 9.4: Sidebar footer**

```tsx
// apps/web/src/components/sidebar/sidebar-footer.tsx
"use client";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { Bell, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Me { id: string; name: string; plan: "free" | "pro" | "byok"; credits_krw: number; }

export function SidebarFooter() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await fetch("/api/users/me")).json() as Promise<Me>,
  });

  if (!data) return null;
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2">
      <Link href="/settings/profile" className="flex items-center gap-2 truncate">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px]">
          {data.name.charAt(0)}
        </span>
        <span className="flex flex-col">
          <span className="truncate text-xs font-medium">{data.name}</span>
          <span className="text-[10px] text-muted-foreground">
            {data.plan.toUpperCase()} · ₩{data.credits_krw.toLocaleString()}
          </span>
        </span>
      </Link>
      <div className="flex gap-1">
        <button aria-label="알림" className="rounded p-1 hover:bg-accent">
          <Bell className="h-4 w-4" />
        </button>
        <Link href={`/ko/app/w/${wsSlug}/settings`} aria-label="워크스페이스 설정" className="rounded p-1 hover:bg-accent">
          <Settings className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 9.5: Scoped search (palette shortcut)**

```tsx
// apps/web/src/components/sidebar/scoped-search.tsx
"use client";
import { Search } from "lucide-react";
import { usePaletteStore } from "@/stores/palette-store";

export function ScopedSearch() {
  const open = usePaletteStore((s) => s.open);
  return (
    <button
      onClick={open}
      className="mx-3 my-2 flex w-[calc(100%-24px)] items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="flex-1">이 프로젝트에서 검색</span>
      <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
    </button>
  );
}
```

Palette itself is Phase 5; the button just opens the (yet empty) palette store.

- [ ] **Step 9.6: Commit**

```bash
git add apps/web/src/components/sidebar/{global-nav,more-menu,project-hero,project-switcher,sidebar-footer,scoped-search,use-current-project}.tsx \
        apps/web/src/components/ui/popover.tsx
git commit -m "feat(web): add sidebar nav/hero/switcher/footer components"
```

---

## Task 10: Project tree component (`react-arborist` + `@dnd-kit`)

The heart of the sidebar. Virtualized rows, keyboard navigation, drag-drop, inline rename.

**Files:**
- Create: `apps/web/src/components/sidebar/project-tree.tsx`
- Create: `apps/web/src/components/sidebar/project-tree-node.tsx`
- Create: `apps/web/src/components/sidebar/tree-context-menu.tsx`

- [ ] **Step 10.1: Install deps**

```bash
pnpm --filter @opencairn/web add react-arborist @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 10.2: Implement tree wrapper**

```tsx
// apps/web/src/components/sidebar/project-tree.tsx
"use client";
import { useMemo } from "react";
import { Tree, NodeApi } from "react-arborist";
import { useProjectTree, TreeNode } from "@/hooks/use-project-tree";
import { ProjectTreeNode } from "./project-tree-node";
import { useSidebarStore } from "@/stores/sidebar-store";

export function ProjectTree({ projectId }: { projectId: string }) {
  const { roots, loadChildren } = useProjectTree({ projectId });
  const expanded = useSidebarStore((s) => s.expanded);

  const data = useMemo(() => toArboristData(roots, expanded), [roots, expanded]);

  async function onToggle(id: string) {
    const state = useSidebarStore.getState();
    state.toggleExpanded(id);
    if (!state.isExpanded(id)) return;
    await loadChildren(id);
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden" data-testid="project-tree">
      <Tree
        data={data}
        rowHeight={28}
        openByDefault={false}
        width="100%"
        height={600}
        onToggle={(id) => onToggle(id)}
      >
        {ProjectTreeNode as any}
      </Tree>
    </div>
  );
}

function toArboristData(
  roots: TreeNode[],
  expanded: Set<string>,
): Array<TreeNode & { children?: TreeNode[] }> {
  return roots.map((r) => ({
    ...r,
    children: r.children && expanded.has(r.id) ? r.children : r.child_count > 0 ? [] : undefined,
  }));
}
```

- [ ] **Step 10.3: Row renderer**

```tsx
// apps/web/src/components/sidebar/project-tree-node.tsx
"use client";
import { type NodeRendererProps } from "react-arborist";
import { ChevronRight, FileText } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useTabsStore } from "@/stores/tabs-store";

export function ProjectTreeNode({ node, style, dragHandle }: NodeRendererProps<TreeNode>) {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const router = useRouter();

  function onClick() {
    const tabs = useTabsStore.getState();
    const existing = tabs.findTabByTarget("note", node.data.id);
    if (existing) {
      tabs.setActive(existing.id);
      router.push(`/ko/app/w/${wsSlug}/n/${node.data.id}`);
      return;
    }
    // preview-mode promotion handled in Phase 3 Tab store
    router.push(`/ko/app/w/${wsSlug}/n/${node.data.id}`);
  }

  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 rounded px-1 text-sm hover:bg-accent"
    >
      {node.data.child_count > 0 ? (
        <ChevronRight
          className={`h-3 w-3 transition-transform ${node.isOpen ? "rotate-90" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
          }}
        />
      ) : (
        <span className="h-3 w-3" />
      )}
      {node.data.icon ? (
        <span>{node.data.icon}</span>
      ) : (
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="truncate">{node.data.title}</span>
      {node.data.child_count > 0 ? (
        <span className="ml-auto text-[10px] text-muted-foreground">
          {node.data.child_count}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 10.4: Commit**

```bash
git add apps/web/src/components/sidebar/project-tree*.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add virtualized project tree (react-arborist)"
```

---

## Task 11: Drag-drop move via dnd-kit

Hook into react-arborist's `onMove` to PATCH `/api/pages/:id` with new parent. Respect 3-way drop zones and project boundaries.

**Files:**
- Modify: `apps/web/src/components/sidebar/project-tree.tsx` — add `onMove` handler
- Create: `apps/web/src/hooks/use-tree-drag-drop.ts`
- Modify: `apps/api/src/routes/pages.ts` (if PATCH route missing)

- [ ] **Step 11.1: Client move handler**

Edit `project-tree.tsx` to pass `onMove`:

```tsx
async function onMove({
  dragIds, parentId, index,
}: { dragIds: string[]; parentId: string | null; index: number }) {
  for (const id of dragIds) {
    const res = await fetch(`/api/pages/${id}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parent_id: parentId, position: index }),
    });
    if (!res.ok) {
      toast.error("이동에 실패했습니다");
      qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
    }
  }
}
```

Optimistic UI: react-arborist reorders rows immediately; on failure we re-fetch from server.

- [ ] **Step 11.2: Server move endpoint**

Search for existing page PATCH route. If `/api/pages/:id/move` not present, add:

```ts
// apps/api/src/routes/pages.ts (existing file)
.patch("/pages/:id/move", zValidator("json", z.object({
  parent_id: z.string().uuid().nullable(),
  position: z.number().int().nonnegative().optional(),
})), async (c) => {
  const session = await requireSession(c);
  const pageId = c.req.param("id");
  const { parent_id, position } = c.req.valid("json");

  const [page] = await db.select().from(pages).where(eq(pages.id, pageId));
  if (!page) return c.json({ error: "not_found" }, 404);
  await requireProjectMember(session.userId, page.projectId);

  if (parent_id) {
    const [parent] = await db.select().from(pages).where(eq(pages.id, parent_id));
    if (!parent || parent.projectId !== page.projectId) {
      return c.json({ error: "cross_project" }, 400);
    }
  }

  await movePage({ projectId: page.projectId, pageId, newParentId: parent_id });
  if (position !== undefined) {
    await db.update(pages).set({ position }).where(eq(pages.id, pageId));
  }

  treeEventBus.emitEvent({
    kind: "page.moved",
    projectId: page.projectId,
    pageId,
    parentId: parent_id,
    at: new Date().toISOString(),
  });

  return c.json({ ok: true });
});
```

- [ ] **Step 11.3: Test move**

Add to `apps/api/tests/projects-tree.test.ts` a case:

```ts
it("PATCH /pages/:id/move updates parent and fires page.moved", async () => {
  const user = await seedUser();
  const project = await seedProject({ ownerId: user.id });
  const p1 = await seedPage({ projectId: project.id, parentId: null });
  const p2 = await seedPage({ projectId: project.id, parentId: null });
  const child = await seedPage({ projectId: project.id, parentId: p1.id });

  const client = createTestClient({ userId: user.id });
  const res = await client.patch(`/api/pages/${child.id}/move`, {
    body: { parent_id: p2.id },
  });
  expect(res.status).toBe(200);

  const tree = await client.get(`/api/projects/${project.id}/tree?parent_id=${p2.id}`);
  expect(tree.body.pages.map((r: any) => r.id)).toContain(child.id);
});
```

- [ ] **Step 11.4: Commit**

```bash
git add apps/web/src/components/sidebar/project-tree.tsx \
        apps/api/src/routes/pages.ts \
        apps/api/tests/projects-tree.test.ts
git commit -m "feat(web,api): support tree drag-drop move with optimistic ui"
```

---

## Task 12: Inline rename + context menu

Double-click or F2 starts rename (contentEditable row). Enter confirms PATCH title, Esc cancels. Right-click and `⋯` button both open the same context menu.

**Files:**
- Modify: `apps/web/src/components/sidebar/project-tree-node.tsx`
- Create: `apps/web/src/components/sidebar/tree-context-menu.tsx`

- [ ] **Step 12.1: Extend row to support rename state**

Add a `renamingId` signal in `project-tree.tsx` (lift state up). Pass `isRenaming` + `onStartRename` + `onCommitRename` to `ProjectTreeNode`. In the node, conditionally render `<input>` vs `<span>`.

```tsx
// inside ProjectTreeNode (pseudo-diff)
{isRenaming ? (
  <input
    autoFocus
    defaultValue={node.data.title}
    className="flex-1 bg-transparent text-sm outline-none"
    onKeyDown={(e) => {
      if (e.key === "Enter") onCommitRename(node.data.id, e.currentTarget.value);
      if (e.key === "Escape") onCommitRename(node.data.id, null);
    }}
    onBlur={(e) => onCommitRename(node.data.id, e.currentTarget.value)}
  />
) : (
  <span className="truncate">{node.data.title}</span>
)}
```

`onCommitRename(id, null)` = cancel. Non-null = PATCH `/api/pages/:id` with `{ title }`.

- [ ] **Step 12.2: Context menu**

```tsx
// apps/web/src/components/sidebar/tree-context-menu.tsx
"use client";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from "@/components/ui/context-menu";

export function TreeContextMenu({
  onRename, onDelete, onDuplicate, onCopyLink, children,
}: {
  onRename(): void; onDelete(): void; onDuplicate(): void; onCopyLink(): void;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={onRename}>이름 바꾸기 (F2)</ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicate}>복제</ContextMenuItem>
        <ContextMenuItem onSelect={onCopyLink}>링크 복사</ContextMenuItem>
        <ContextMenuItem onSelect={onDelete} className="text-destructive">
          삭제 (⌘Del)
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

Wrap each row in `<TreeContextMenu ...>`. Use shadcn `context-menu` (add if missing).

- [ ] **Step 12.3: Commit**

```bash
git add apps/web/src/components/sidebar/project-tree.tsx \
        apps/web/src/components/sidebar/project-tree-node.tsx \
        apps/web/src/components/sidebar/tree-context-menu.tsx \
        apps/web/src/components/ui/context-menu.tsx
git commit -m "feat(web): inline rename and right-click context menu on tree"
```

---

## Task 13: Keyboard shortcuts (↑↓→← / Enter / F2 / ⌘Del / type-ahead)

react-arborist gives most of this via its own keyboard plugin. Supplement with type-ahead and `⌘Del`.

**Files:**
- Create: `apps/web/src/hooks/use-tree-keyboard.ts`
- Modify: `apps/web/src/components/sidebar/project-tree.tsx`

- [ ] **Step 13.1: Type-ahead implementation sketch**

```ts
"use client";
import { useEffect, useRef } from "react";

export function useTypeAhead(onJump: (prefix: string) => void) {
  const buf = useRef("");
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      buf.current += e.key.toLowerCase();
      onJump(buf.current);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => (buf.current = ""), 700);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onJump]);
}
```

- [ ] **Step 13.2: ⌘Del shortcut**

Inside `project-tree.tsx`:

```tsx
useKeyboardShortcut("mod+delete", async () => {
  const focused = treeRef.current?.focusedNode;
  if (!focused) return;
  if (!confirm(`"${focused.data.title}"을(를) 삭제할까요?`)) return;
  await fetch(`/api/pages/${focused.data.id}`, { method: "DELETE" });
});
```

- [ ] **Step 13.3: Commit**

```bash
git add apps/web/src/hooks/use-tree-keyboard.ts \
        apps/web/src/components/sidebar/project-tree.tsx
git commit -m "feat(web): type-ahead jump and cmd+del delete on tree"
```

---

## Task 14: Sidebar assembly + replace placeholder

Tie all previous components together and swap in to AppShell.

**Files:**
- Create: `apps/web/src/components/sidebar/sidebar.tsx`
- Modify: `apps/web/src/components/shell/app-shell.tsx`

- [ ] **Step 14.1: Assemble**

```tsx
// apps/web/src/components/sidebar/sidebar.tsx
"use client";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { GlobalNav } from "./global-nav";
import { ProjectHero } from "./project-hero";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarEmptyState } from "./sidebar-empty-state";
import { useCurrentProject } from "./use-current-project";

export function Sidebar() {
  const { project } = useCurrentProject();
  return (
    <aside data-testid="app-shell-sidebar" className="flex h-full flex-col border-r border-border bg-background">
      <WorkspaceSwitcher />
      <GlobalNav />
      <ProjectHero />
      <ScopedSearch />
      {project ? <ProjectTree projectId={project.id} /> : <SidebarEmptyState />}
      <SidebarFooter />
    </aside>
  );
}
```

- [ ] **Step 14.2: Empty state**

```tsx
// apps/web/src/components/sidebar/sidebar-empty-state.tsx
"use client";
import { useRouter, useParams } from "next/navigation";

export function SidebarEmptyState() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const router = useRouter();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm text-muted-foreground">프로젝트를 만들어 시작하세요</p>
      <button
        onClick={() => router.push(`/ko/app/w/${wsSlug}/new-project`)}
        className="rounded border border-border px-3 py-1 text-xs hover:bg-accent"
      >
        + 프로젝트 만들기
      </button>
    </div>
  );
}
```

- [ ] **Step 14.3: Swap into AppShell**

Edit `apps/web/src/components/shell/app-shell.tsx`: replace `PlaceholderSidebar` import and usage with the new `Sidebar`. Keep `data-testid="app-shell-sidebar"` compatibility (the Sidebar's root already carries it).

- [ ] **Step 14.4: Commit**

```bash
git add apps/web/src/components/sidebar/sidebar.tsx \
        apps/web/src/components/sidebar/sidebar-empty-state.tsx \
        apps/web/src/components/shell/app-shell.tsx
git commit -m "feat(web): assemble full sidebar and swap into app shell"
```

---

## Task 15: E2E sidebar spec + performance smoke

Covers: render, workspace switch, project switch, tree expand, rename, drag-drop, context menu, empty state, SSE refresh.

**Files:**
- Create: `apps/web/tests/e2e/sidebar.spec.ts`
- Create: `apps/web/tests/e2e/fixtures/seed-5k-pages.ts`

- [ ] **Step 15.1: Fixtures**

`seed-5k-pages.ts` — helper that posts 5000 pages to the test API for perf runs; used only in the tagged perf test below.

- [ ] **Step 15.2: Spec**

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithFirstProject } from "./helpers";

test.describe("Sidebar", () => {
  test.beforeEach(async ({ page }) => loginAsTestUser(page));

  test("renders sidebar sections", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await expect(page.getByRole("button", { name: /대시보드|Deep Research|가져오기/ })).toBeVisible();
  });

  test("switches workspaces via dropdown", async ({ page }) => {
    const a = await seedWorkspaceWithFirstProject("WS-A");
    const b = await seedWorkspaceWithFirstProject("WS-B");
    await page.goto(`/ko/app/w/${a.slug}/`);
    await page.getByRole("button", { name: new RegExp(a.name) }).click();
    await page.getByRole("menuitem", { name: new RegExp(b.name) }).click();
    await page.waitForURL(new RegExp(`/ko/app/w/${b.slug}/`));
  });

  test("expands folder and shows children via SSE after create", async ({ page }) => {
    const { slug, projectId } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    const before = await page.getByTestId("project-tree").getByRole("treeitem").count();
    await page.request.post(`/api/projects/${projectId}/pages`, {
      data: { title: "new-from-api", parent_id: null },
    });
    await expect(async () => {
      const n = await page.getByTestId("project-tree").getByRole("treeitem").count();
      expect(n).toBe(before + 1);
    }).toPass({ timeout: 3000 });
  });

  test("double-click enters rename, Enter commits", async ({ page }) => {
    const { slug, pageId } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    const row = page.getByRole("treeitem").first();
    await row.dblclick();
    const input = row.getByRole("textbox");
    await input.fill("renamed");
    await input.press("Enter");
    await expect(row).toContainText("renamed");
  });

  test("empty state when no projects", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject({ withoutProject: true });
    await page.goto(`/ko/app/w/${slug}/`);
    await expect(page.getByText("프로젝트를 만들어 시작하세요")).toBeVisible();
  });
});

test.describe("Sidebar performance", () => {
  test("renders 5K pages under 300ms @perf", async ({ page }) => {
    test.slow();
    const { slug } = await import("./fixtures/seed-5k-pages");
    await seedWorkspaceWithFirstProject();
    const t0 = Date.now();
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByTestId("project-tree").getByRole("treeitem").first().waitFor();
    expect(Date.now() - t0).toBeLessThan(300);
  });
});
```

- [ ] **Step 15.3: Commit**

```bash
git add apps/web/tests/e2e/sidebar.spec.ts \
        apps/web/tests/e2e/fixtures/seed-5k-pages.ts
git commit -m "test(web): e2e sidebar coverage and 5k-page perf smoke"
```

---

## Task 16: Post-feature check + docs

- [ ] **Step 16.1: Full suite**

```bash
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web test:e2e -g "Sidebar"
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web lint
pnpm --filter @opencairn/web typecheck
```

All green. Move any hardcoded Korean strings to `messages/{ko,en}/sidebar.json`.

- [ ] **Step 16.2: Plans-status update**

Mark Plan Phase 2 complete in `docs/contributing/plans-status.md`. Record HEAD SHA.

- [ ] **Step 16.3: Memory**

Write memory entry `project_plan_app_shell_phase_2_complete.md`.

- [ ] **Step 16.4: Commit**

```bash
git add docs/contributing/plans-status.md
git commit -m "docs(docs): mark app shell phase 2 complete"
```

---

## Completion Criteria

- [ ] ADR 009 committed
- [ ] `pages.path` migrated + backfilled
- [ ] Tree API (list, perms, SSE) tests green
- [ ] react-arborist + dnd-kit tree renders, supports drag-drop, rename, keyboard
- [ ] Workspace switcher + project hero + global nav + footer wired
- [ ] Empty state when no projects
- [ ] E2E sidebar spec passes, 5K-page perf test under 300ms
- [ ] Manual smoke: open workspace → tree loads → create page in another tab via API → SSE pushes it into sidebar live

## What's NOT in this plan

| Item | Phase |
|------|-------|
| Tab bar, preview mode, split pane, viewers | 3 |
| Agent panel, threads DB/API, composer | 4 |
| Dashboard/project/research views, palette, notifications drawer, account settings | 5 |
| Multi-select rows + Shift-click range selection | 5 (hooked to palette context) |
| `⌘Shift D` daily notes | separate backlog |
