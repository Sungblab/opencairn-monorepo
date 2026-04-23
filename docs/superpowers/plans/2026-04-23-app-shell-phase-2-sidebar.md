# App Shell Phase 2 — Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1 placeholder sidebar with the real left-panel UI: workspace switcher dropdown, global nav (4 icons + "더보기"), project hero dropdown, scoped search shortcut, virtualized project-scoped tree with drag-drop + keyboard + inline rename, and a footer with user + notifications + workspace settings entry. Includes the backend tree API and SSE meta stream.

**Architecture:**
- Postgres `ltree` materialized-path column on `folders` only (ADR 009 decided in Task 1). Notes stay as `folder_id` leaves — no path column. Moving a folder rewrites the subtree's paths in one UPDATE; moving a note is a single `folder_id` write.
- `GET /api/projects/:id/tree?parent_id=X` returns folders + notes as discriminated nodes with one level of folder prefetch; `GET /api/projects/:id/permissions` batches project role + existing `page_permissions`(→`notes.id`) overrides; `GET /api/stream/projects/:id/tree` SSE streams `tree.folder_*` and `tree.note_*` events.
- Frontend: `react-arborist` for virtualization + keyboard + focus management; `@dnd-kit/core` for 3-way drag-drop and accessibility; `zustand` selectors to prevent reconciliation bombs; `@tanstack/react-query` for server state + SSE-driven invalidation.

**Tech Stack:** Drizzle ORM + `ltree`, Hono (API), React 19, `react-arborist`, `@dnd-kit/core` + `@dnd-kit/sortable`, Zustand, React Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §4 (Sidebar), §9 (workspace switch), §11.3–11.5 (API + migration).
**Depends on:** Phase 1 merged (stores, AppShell, route scaffolds).

---

## File Structure

**New files:**

```
docs/architecture/adr/009-page-tree-storage.md                # decision record
packages/db/drizzle/0018_folders_ltree_path.sql               # schema migration
packages/db/src/schema/folders.ts                             # +path column on folders (existing file)
packages/db/src/schema/custom-types.ts                        # +ltree customType (existing file)

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
packages/db/src/schema/folders.ts                             # +path column (ltree)
packages/db/src/schema/custom-types.ts                        # +ltree customType
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

Block dependency for the rest of Plan 2. Short decision document rather than a commit-worthy investigation. The spec's §4.6 already argues for `ltree`; this task formalizes the call and pins down the detail that the ltree column lives on **`folders` only**, not on a unified `pages` table (which does not exist — the real schema splits into `folders` + `notes`, see ADR 009 "Context").

**Files:**
- Create: `docs/architecture/adr/009-page-tree-storage.md`

- [ ] **Step 1.1: Write the ADR**

Author the ADR verbatim as committed in `docs/architecture/adr/009-page-tree-storage.md` (the canonical file — do not duplicate its body here in the plan; the plan should not drift from the real document).

Key points the ADR must pin:

- **Decision**: `ltree` path column on `folders`; notes stay flat under folders via `folder_id`.
- **Context**: schema realities (`folders` hierarchical, `notes` leaves) — the Notion-style unified `pages` table was never built and is out of scope for Phase 2.
- **Workload**: ≤ 5K nodes/project (folders + notes combined), typical folder subtree < 100, folder moves rare, note moves common but single-row.
- **Consequences**: `CREATE EXTENSION IF NOT EXISTS ltree` in the Task 2 migration; `folders.path` labels use `regexp_replace(id::text, '-', '_', 'g')` (ltree only accepts `[A-Za-z0-9_]`); move SQL shown; no schema change on notes.
- **Review trigger**: revisit if projects grow > 50K nodes AND folder moves cluster, OR if the product adds note-in-note nesting (which collapses the split into a unified `pages` table — new ADR at that point).

- [ ] **Step 1.2: Commit**

```bash
git add docs/architecture/adr/009-page-tree-storage.md
git commit -m "docs(adr): adopt postgres ltree for folder tree storage"
```

---

## Task 2: Add `folders.path` ltree column + GiST index

Notes are unaffected — they stay as `(folder_id, position)` leaves. Only `folders` get a materialized path (ADR 009).

**Files:**
- Modify: `packages/db/src/schema/custom-types.ts` — add `ltree` customType
- Modify: `packages/db/src/schema/folders.ts` — add `path` column + index
- Create: `packages/db/drizzle/0018_folders_ltree_path.sql`

- [ ] **Step 2.1: Add ltree custom type**

Open `packages/db/src/schema/custom-types.ts` and append:

```ts
export const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return "ltree";
  },
  toDriver(value: string): string {
    return value;
  },
  fromDriver(value: string): string {
    return value;
  },
});
```

- [ ] **Step 2.2: Add `path` column + index to `folders` schema**

Open `packages/db/src/schema/folders.ts`. Extend the existing `pgTable("folders", {...})`:

```ts
import { ltree } from "./custom-types";
// ...
export const folders = pgTable(
  "folders",
  {
    // ...existing columns
    path: ltree("path").notNull(),
  },
  (t) => [
    index("folders_project_id_idx").on(t.projectId),
    // Drizzle's `index(...).using("gist", col)` is supported via raw `.using`.
    // If the builder can't express GiST cleanly, keep the index declaration
    // minimal here (B-tree) and rely on the SQL migration to create the real
    // GiST index. The migration is authoritative.
  ]
);
```

Leave the GiST index definition in SQL — `pnpm db:generate` has known gaps around `USING gist` and `::ltree` casts, so we write the migration by hand and mark the schema file as consistent with it.

- [ ] **Step 2.3: Write the migration (by hand)**

`packages/db/drizzle/` already runs up through `0017_users_last_viewed_workspace.sql`. Next number is **0018**. Filename: `0018_folders_ltree_path.sql`.

```sql
-- Ensure ltree extension (idempotent — may already exist on older envs)
CREATE EXTENSION IF NOT EXISTS ltree;

-- Add nullable first so the backfill can run, then enforce NOT NULL.
ALTER TABLE "folders" ADD COLUMN "path" ltree;

-- Backfill: folder labels are folders.id with dashes replaced by underscores
-- (ltree labels accept only [A-Za-z0-9_]). Project id is not part of the
-- path — the tree is scoped per project at query time via project_id filter,
-- which keeps labels shorter and avoids redundant prefix storage.
WITH RECURSIVE walk AS (
  SELECT f.id,
         f.parent_id,
         f.project_id,
         (regexp_replace(f.id::text, '-', '_', 'g'))::ltree AS new_path
  FROM "folders" f
  WHERE f.parent_id IS NULL
  UNION ALL
  SELECT c.id,
         c.parent_id,
         c.project_id,
         (w.new_path || regexp_replace(c.id::text, '-', '_', 'g'))::ltree
  FROM "folders" c
  JOIN walk w ON c.parent_id = w.id AND c.project_id = w.project_id
)
UPDATE "folders" f SET "path" = w.new_path FROM walk w WHERE f.id = w.id;

-- Sanity: no NULLs left. If this fires, there is an orphaned folder (parent_id
-- pointing at a non-existent row) and the migration should abort.
DO $$
DECLARE null_count int;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "folders" WHERE "path" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'folders_ltree backfill left % NULL rows', null_count;
  END IF;
END$$;

ALTER TABLE "folders" ALTER COLUMN "path" SET NOT NULL;

CREATE INDEX "folders_path_gist" ON "folders" USING GIST ("path");
```

- [ ] **Step 2.4: Apply migration**

```bash
pnpm --filter @opencairn/db db:migrate
```

Expected: no errors. Verify via psql (or the project's `db:psql` shortcut if available):
```sql
\d folders
-- path column of type ltree, folders_path_gist index present
SELECT id, parent_id, path FROM folders LIMIT 5;
-- root folders have a single-label path (id_no_dashes)
-- child folders have concatenated labels matching their ancestry
```

- [ ] **Step 2.5: Commit**

```bash
git add packages/db/src/schema/custom-types.ts \
        packages/db/src/schema/folders.ts \
        packages/db/drizzle/0018_folders_ltree_path.sql \
        packages/db/drizzle/meta
git commit -m "feat(db): add ltree path column to folders with gist index"
```

---

## Task 3: Tree query helpers (`apps/api/src/lib/tree-queries.ts`)

Pure SQL wrappers that unify folders (ltree-backed) + notes (folder_id leaves) into a single discriminated node stream for the sidebar. Tests use the existing `seedWorkspace({role})` harness in `apps/api/tests/helpers/seed.ts` plus direct `db.insert(folders|notes)` for structure setup.

**Files:**
- Create: `apps/api/src/lib/tree-queries.ts`
- Create: `apps/api/tests/tree-queries.test.ts`

- [ ] **Step 3.1: Define the public surface**

```ts
// TreeRow returned by the listing helpers.
export interface TreeRow {
  kind: "folder" | "note";
  id: string;
  parentId: string | null;      // folder.parent_id OR note.folder_id
  label: string;                // folder.name OR note.title
  pathText: string | null;      // folders.path::text; null for notes
  childCount: number;           // folders: count(child folders) + count(notes in folder); notes: 0
}
```

Functions:

| Function | Purpose |
|----------|---------|
| `listChildren({projectId, parentId})` | Direct children of `parentId` (null = root). Returns folders first (`ORDER BY path`), then notes (`ORDER BY position`). |
| `listChildrenForParents({projectId, parentIds})` | Batch of the above, grouped by parent. Empty input → empty Map. |
| `getFolderSubtree({projectId, rootFolderId})` | Folder subtree via `path <@ root.path`, BFS order. Notes excluded — callers fetch notes per folder separately when needed. |
| `moveFolder({projectId, folderId, newParentId})` | Update `folders.path` for the subtree using `subpath(path, nlevel(oldPath))` concat. Refuses cross-project. |
| `moveNote({projectId, noteId, newFolderId})` | Single-row `UPDATE notes SET folder_id = :new`. `newFolderId` must belong to `projectId` or be null. |

- [ ] **Step 3.2: Write failing tests**

Create `apps/api/tests/tree-queries.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db, folders, notes, eq, sql } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed";
import {
  listChildren,
  listChildrenForParents,
  getFolderSubtree,
  moveFolder,
  moveNote,
} from "../src/lib/tree-queries";

// Inline folder insert — mirrors the production migration's label rule
// (UUIDs with dashes replaced by underscores). Keeps the test helper tight.
const label = (uuid: string) => uuid.replace(/-/g, "_");

async function insertFolder(opts: {
  projectId: string;
  parentId: string | null;
  name: string;
  parentPath?: string;
}): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const path = opts.parentPath
    ? `${opts.parentPath}.${label(id)}`
    : label(id);
  await db.insert(folders).values({
    id,
    projectId: opts.projectId,
    parentId: opts.parentId,
    name: opts.name,
    path,
  });
  return { id, path };
}

async function insertNote(opts: {
  projectId: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(notes).values({
    id,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    folderId: opts.folderId,
    title: opts.title,
  });
  return id;
}

describe("tree-queries", () => {
  let seed: SeedResult;
  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("listChildren returns folder children + note children of a folder", async () => {
    const root = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Root",
    });
    const childFolder = await insertFolder({
      projectId: seed.projectId,
      parentId: root.id,
      name: "Child",
      parentPath: root.path,
    });
    const noteId = await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: root.id,
      title: "Leaf note",
    });

    const rows = await listChildren({ projectId: seed.projectId, parentId: root.id });
    const kinds = rows.map((r) => `${r.kind}:${r.id}`);
    expect(kinds).toContain(`folder:${childFolder.id}`);
    expect(kinds).toContain(`note:${noteId}`);
    expect(rows.find((r) => r.id === childFolder.id)?.childCount).toBe(0);
    expect(rows.find((r) => r.id === noteId)?.childCount).toBe(0);
  });

  it("listChildren at root returns root folders + root notes", async () => {
    const rootFolder = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "R",
    });
    const rootNote = await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: null,
      title: "root-level note",
    });
    // seedWorkspace creates seed.noteId with folderId null — also expected in result.

    const rows = await listChildren({ projectId: seed.projectId, parentId: null });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(rootFolder.id);
    expect(ids).toContain(rootNote);
    expect(ids).toContain(seed.noteId);
    // folders come first, notes after
    const firstNoteIdx = rows.findIndex((r) => r.kind === "note");
    const firstFolderIdx = rows.findIndex((r) => r.kind === "folder");
    expect(firstFolderIdx).toBeLessThan(firstNoteIdx);
  });

  it("folder childCount includes both subfolders and direct notes", async () => {
    const root = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Root",
    });
    await insertFolder({
      projectId: seed.projectId,
      parentId: root.id,
      name: "sub1",
      parentPath: root.path,
    });
    await insertFolder({
      projectId: seed.projectId,
      parentId: root.id,
      name: "sub2",
      parentPath: root.path,
    });
    await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: root.id,
      title: "n1",
    });

    const [row] = await listChildren({ projectId: seed.projectId, parentId: null }).then(
      (rows) => rows.filter((r) => r.id === root.id),
    );
    expect(row.childCount).toBe(3); // 2 subfolders + 1 note
  });

  it("listChildrenForParents batches many parents in one pass", async () => {
    const r1 = await insertFolder({ projectId: seed.projectId, parentId: null, name: "R1" });
    const r2 = await insertFolder({ projectId: seed.projectId, parentId: null, name: "R2" });
    await insertFolder({ projectId: seed.projectId, parentId: r1.id, name: "a", parentPath: r1.path });
    await insertFolder({ projectId: seed.projectId, parentId: r1.id, name: "b", parentPath: r1.path });
    await insertNote({ projectId: seed.projectId, workspaceId: seed.workspaceId, folderId: r2.id, title: "n" });

    const grouped = await listChildrenForParents({
      projectId: seed.projectId,
      parentIds: [r1.id, r2.id],
    });
    expect(grouped.get(r1.id)?.filter((r) => r.kind === "folder")).toHaveLength(2);
    expect(grouped.get(r2.id)?.filter((r) => r.kind === "note")).toHaveLength(1);
  });

  it("listChildrenForParents returns empty map for empty input", async () => {
    const grouped = await listChildrenForParents({ projectId: seed.projectId, parentIds: [] });
    expect(grouped.size).toBe(0);
  });

  it("getFolderSubtree returns folders only, BFS order", async () => {
    const root = await insertFolder({ projectId: seed.projectId, parentId: null, name: "Root" });
    const a = await insertFolder({
      projectId: seed.projectId, parentId: root.id, name: "A", parentPath: root.path,
    });
    const a1 = await insertFolder({
      projectId: seed.projectId, parentId: a.id, name: "A1", parentPath: a.path,
    });

    const subtree = await getFolderSubtree({ projectId: seed.projectId, rootFolderId: root.id });
    const ids = subtree.map((r) => r.id);
    expect(ids[0]).toBe(root.id);
    expect(ids.slice(1).sort()).toEqual([a.id, a1.id].sort());
  });

  it("moveFolder reparents folder and rewrites descendant paths", async () => {
    const f1 = await insertFolder({ projectId: seed.projectId, parentId: null, name: "F1" });
    const f2 = await insertFolder({ projectId: seed.projectId, parentId: null, name: "F2" });
    const child = await insertFolder({
      projectId: seed.projectId, parentId: f1.id, name: "child", parentPath: f1.path,
    });
    const grand = await insertFolder({
      projectId: seed.projectId, parentId: child.id, name: "grand", parentPath: child.path,
    });

    await moveFolder({
      projectId: seed.projectId,
      folderId: child.id,
      newParentId: f2.id,
    });

    const afterSub = await getFolderSubtree({
      projectId: seed.projectId, rootFolderId: f2.id,
    });
    expect(afterSub.map((r) => r.id).sort()).toEqual(
      [f2.id, child.id, grand.id].sort(),
    );
  });

  it("moveFolder refuses cross-project moves", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const folderHere = await insertFolder({
        projectId: seed.projectId, parentId: null, name: "here",
      });

      await expect(
        moveFolder({
          projectId: other.projectId,           // wrong project
          folderId: folderHere.id,
          newParentId: null,
        }),
      ).rejects.toThrow(/cross-project|not found/);
    } finally {
      await other.cleanup();
    }
  });

  it("moveNote updates folder_id and rejects cross-project targets", async () => {
    const f1 = await insertFolder({ projectId: seed.projectId, parentId: null, name: "F1" });
    const f2 = await insertFolder({ projectId: seed.projectId, parentId: null, name: "F2" });
    const noteId = await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: f1.id,
      title: "n",
    });

    await moveNote({ projectId: seed.projectId, noteId, newFolderId: f2.id });
    const [moved] = await db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(moved.folderId).toBe(f2.id);

    // Cross-project target folder → refused.
    const other = await seedWorkspace({ role: "owner" });
    try {
      const otherFolder = await insertFolder({
        projectId: other.projectId, parentId: null, name: "outside",
      });
      await expect(
        moveNote({
          projectId: seed.projectId,
          noteId,
          newFolderId: otherFolder.id,
        }),
      ).rejects.toThrow(/cross-project|not found/);
    } finally {
      await other.cleanup();
    }
  });
});
```

- [ ] **Step 3.3: Run — expect failure**

```bash
pnpm --filter @opencairn/api test tree-queries
```

Expected: module-missing error.

- [ ] **Step 3.4: Implement**

Create `apps/api/src/lib/tree-queries.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { db, folders, notes } from "@opencairn/db";

const label = (uuid: string) => uuid.replace(/-/g, "_");

export interface TreeRow {
  kind: "folder" | "note";
  id: string;
  parentId: string | null;   // folders.parent_id OR notes.folder_id
  label: string;             // folders.name OR notes.title
  pathText: string | null;   // folders.path::text; null for notes
  childCount: number;        // folders: child folders + direct notes; notes: 0
}

/**
 * Return all direct children of `parentId` (null = root) in a single query,
 * unioning folders and notes. Ordering: folders first (by ltree path), then
 * notes (by `position` then `created_at`). The sidebar renders them in this
 * order without further client-side sorting.
 */
export async function listChildren(opts: {
  projectId: string;
  parentId: string | null;
}): Promise<TreeRow[]> {
  const folderParent = opts.parentId
    ? sql`f.parent_id = ${opts.parentId}::uuid`
    : sql`f.parent_id IS NULL`;
  const noteParent = opts.parentId
    ? sql`n.folder_id = ${opts.parentId}::uuid`
    : sql`n.folder_id IS NULL`;

  const rows = await db.execute<TreeRow>(sql`
    SELECT
      'folder'::text AS "kind",
      f.id,
      f.parent_id AS "parentId",
      f.name AS "label",
      f.path::text AS "pathText",
      (
        (SELECT COUNT(*)::int FROM folders c WHERE c.parent_id = f.id)
        + (SELECT COUNT(*)::int FROM notes cn
           WHERE cn.folder_id = f.id AND cn.deleted_at IS NULL)
      ) AS "childCount",
      0 AS "sortGroup",
      f.path::text AS "sortKey"
    FROM folders f
    WHERE f.project_id = ${opts.projectId}::uuid
      AND ${folderParent}
    UNION ALL
    SELECT
      'note'::text,
      n.id,
      n.folder_id AS "parentId",
      n.title AS "label",
      NULL AS "pathText",
      0 AS "childCount",
      1 AS "sortGroup",
      lpad(
        coalesce(extract(epoch FROM n.created_at)::bigint::text, '0'),
        16,
        '0'
      ) AS "sortKey"
    FROM notes n
    WHERE n.project_id = ${opts.projectId}::uuid
      AND ${noteParent}
      AND n.deleted_at IS NULL
    ORDER BY "sortGroup", "sortKey"
  `);
  return rows.rows.map(({ kind, id, parentId, label, pathText, childCount }) => ({
    kind, id, parentId, label, pathText, childCount,
  }));
}

/**
 * Batch version of listChildren for N parents in one query. Used by the tree
 * endpoint to prefetch one level of grandchildren without N+1.
 * Empty input short-circuits to an empty Map.
 */
export async function listChildrenForParents(opts: {
  projectId: string;
  parentIds: string[];
}): Promise<Map<string, TreeRow[]>> {
  const grouped = new Map<string, TreeRow[]>();
  if (opts.parentIds.length === 0) return grouped;

  // parentIds here are always folder ids (notes can't have children).
  // Callers must filter kind="folder" before passing.
  const rows = await db.execute<TreeRow>(sql`
    SELECT
      'folder'::text AS "kind",
      f.id,
      f.parent_id AS "parentId",
      f.name AS "label",
      f.path::text AS "pathText",
      (
        (SELECT COUNT(*)::int FROM folders c WHERE c.parent_id = f.id)
        + (SELECT COUNT(*)::int FROM notes cn
           WHERE cn.folder_id = f.id AND cn.deleted_at IS NULL)
      ) AS "childCount",
      0 AS "sortGroup",
      f.path::text AS "sortKey"
    FROM folders f
    WHERE f.project_id = ${opts.projectId}::uuid
      AND f.parent_id = ANY(${opts.parentIds}::uuid[])
    UNION ALL
    SELECT
      'note'::text, n.id, n.folder_id, n.title, NULL, 0,
      1, lpad(coalesce(extract(epoch FROM n.created_at)::bigint::text, '0'), 16, '0')
    FROM notes n
    WHERE n.project_id = ${opts.projectId}::uuid
      AND n.folder_id = ANY(${opts.parentIds}::uuid[])
      AND n.deleted_at IS NULL
    ORDER BY "sortGroup", "sortKey"
  `);

  for (const pid of opts.parentIds) grouped.set(pid, []);
  for (const row of rows.rows) {
    if (row.parentId) {
      const bucket = grouped.get(row.parentId);
      if (bucket) {
        bucket.push({
          kind: row.kind,
          id: row.id,
          parentId: row.parentId,
          label: row.label,
          pathText: row.pathText,
          childCount: row.childCount,
        });
      }
    }
  }
  return grouped;
}

/**
 * Folder-only subtree (notes excluded). Used by move operations to rewrite
 * descendant paths, and by integrity checks. BFS order (nlevel, path).
 */
export async function getFolderSubtree(opts: {
  projectId: string;
  rootFolderId: string;
}): Promise<TreeRow[]> {
  const rows = await db.execute<TreeRow>(sql`
    WITH root AS (
      SELECT path FROM folders
       WHERE id = ${opts.rootFolderId}::uuid
         AND project_id = ${opts.projectId}::uuid
    )
    SELECT
      'folder'::text AS "kind",
      f.id,
      f.parent_id AS "parentId",
      f.name AS "label",
      f.path::text AS "pathText",
      0 AS "childCount"
    FROM folders f, root r
    WHERE f.path <@ r.path
      AND f.project_id = ${opts.projectId}::uuid
    ORDER BY nlevel(f.path), f.path
  `);
  return rows.rows;
}

/**
 * Move a folder (and by extension its entire subtree) under a new parent in
 * the same project. Refuses cross-project moves — if `newParentId` belongs to
 * a different project, the parent lookup returns no row and this throws.
 */
export async function moveFolder(opts: {
  projectId: string;
  folderId: string;
  newParentId: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [folder] = await tx
      .select({ id: folders.id, path: folders.path, projectId: folders.projectId })
      .from(folders)
      .where(and(
        eq(folders.id, opts.folderId),
        eq(folders.projectId, opts.projectId),
      ));
    if (!folder) throw new Error("folder not found in this project");

    const oldPath = folder.path;

    let newPrefix: string;
    if (opts.newParentId) {
      const [parent] = await tx
        .select({ id: folders.id, path: folders.path })
        .from(folders)
        .where(and(
          eq(folders.id, opts.newParentId),
          eq(folders.projectId, opts.projectId),
        ));
      if (!parent) throw new Error("cross-project parent or not found");
      newPrefix = `${parent.path}.${label(opts.folderId)}`;
    } else {
      newPrefix = label(opts.folderId);
    }

    // Rewrite paths for the whole subtree in one UPDATE. For a subtree rooted
    // at `oldPath` with nlevel=N, each descendant path of length M gets
    // replaced with `newPrefix || subpath(path, N)`.
    await tx.execute(sql`
      UPDATE folders
      SET path = (${newPrefix}::ltree
                  || subpath(path, nlevel(${oldPath}::ltree)))
      WHERE path <@ ${oldPath}::ltree
        AND project_id = ${opts.projectId}::uuid
    `);

    await tx
      .update(folders)
      .set({ parentId: opts.newParentId })
      .where(eq(folders.id, opts.folderId));
  });
}

/**
 * Move a note across folders. Single row update — no path math.
 * `newFolderId = null` moves the note to project root.
 */
export async function moveNote(opts: {
  projectId: string;
  noteId: string;
  newFolderId: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [note] = await tx
      .select({ projectId: notes.projectId })
      .from(notes)
      .where(eq(notes.id, opts.noteId));
    if (!note || note.projectId !== opts.projectId) {
      throw new Error("note not found in this project");
    }

    if (opts.newFolderId) {
      const [parent] = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(and(
          eq(folders.id, opts.newFolderId),
          eq(folders.projectId, opts.projectId),
        ));
      if (!parent) throw new Error("cross-project folder or not found");
    }

    await tx
      .update(notes)
      .set({ folderId: opts.newFolderId })
      .where(eq(notes.id, opts.noteId));
  });
}
```

- [ ] **Step 3.5: Re-run**

```bash
pnpm --filter @opencairn/api test tree-queries
```

Expected: all pass.

- [ ] **Step 3.6: Commit**

```bash
git add apps/api/src/lib/tree-queries.ts apps/api/tests/tree-queries.test.ts
git commit -m "feat(api): add folder ltree + note leaf tree query helpers"
```

---

## Task 4: `GET /api/projects/:id/tree` endpoint

Returns direct children (folders + notes, discriminated) with one level of grandchild prefetch (spec §4.6.1, §11.3). Auth: existing `canRead({type: "project", id})` helper from `apps/api/src/lib/permissions.ts`.

**Files:**
- Create: `apps/api/src/routes/projects-tree.ts`
- Modify: `apps/api/src/index.ts` — mount the new route (same Hono app root as other routes)
- Create: `apps/api/tests/projects-tree.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `apps/api/tests/projects-tree.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db, folders, notes } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed";
import { installTestSession } from "./helpers/session"; // same pattern as notes.test.ts
import { app } from "../src/index"; // test app instance
// Note: existing tests build the request via `installTestSession(app, userId).fetch(url)` —
// copy whichever harness call the existing test files use.

const label = (id: string) => id.replace(/-/g, "_");

async function mkFolder(projectId: string, parentId: string | null, name: string, parentPath?: string) {
  const id = randomUUID();
  const path = parentPath ? `${parentPath}.${label(id)}` : label(id);
  await db.insert(folders).values({ id, projectId, parentId, name, path });
  return { id, path };
}

async function mkNote(projectId: string, workspaceId: string, folderId: string | null, title: string) {
  const id = randomUUID();
  await db.insert(notes).values({ id, projectId, workspaceId, folderId, title });
  return id;
}

describe("GET /api/projects/:id/tree", () => {
  let seed: SeedResult;
  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns root folders + root notes as discriminated nodes", async () => {
    const root = await mkFolder(seed.projectId, null, "Root folder");
    // seed.noteId already exists at root (folder_id=null)

    const res = await fetch(`/api/projects/${seed.projectId}/tree`, {
      headers: await installTestSession(seed.userId),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.nodes.map((n: any) => n.id);
    expect(ids).toContain(root.id);
    expect(ids).toContain(seed.noteId);
    const rootKind = body.nodes.find((n: any) => n.id === root.id).kind;
    expect(rootKind).toBe("folder");
    const noteKind = body.nodes.find((n: any) => n.id === seed.noteId).kind;
    expect(noteKind).toBe("note");
  });

  it("prefetches one level of folder children (folders + notes)", async () => {
    const root = await mkFolder(seed.projectId, null, "Root");
    const subFolder = await mkFolder(seed.projectId, root.id, "sub", root.path);
    const subNote = await mkNote(seed.projectId, seed.workspaceId, root.id, "sub note");

    const res = await fetch(`/api/projects/${seed.projectId}/tree`, {
      headers: await installTestSession(seed.userId),
    });
    const body = await res.json();
    const rootNode = body.nodes.find((n: any) => n.id === root.id);
    const childIds = rootNode.children.map((c: any) => c.id);
    expect(childIds).toContain(subFolder.id);
    expect(childIds).toContain(subNote);
  });

  it("parent_id=<folderId> returns that folder's children only", async () => {
    const root = await mkFolder(seed.projectId, null, "Root");
    await mkFolder(seed.projectId, root.id, "a", root.path);
    await mkNote(seed.projectId, seed.workspaceId, root.id, "n");

    const res = await fetch(`/api/projects/${seed.projectId}/tree?parent_id=${root.id}`, {
      headers: await installTestSession(seed.userId),
    });
    const body = await res.json();
    const ids = body.nodes.map((n: any) => n.id);
    expect(ids).not.toContain(seed.noteId); // seed's root-level note is NOT included
    expect(body.nodes).toHaveLength(2);
  });

  it("rejects parent_id when it refers to a note", async () => {
    const res = await fetch(`/api/projects/${seed.projectId}/tree?parent_id=${seed.noteId}`, {
      headers: await installTestSession(seed.userId),
    });
    expect(res.status).toBe(400);
  });

  it("403 for non-members", async () => {
    const outsider = await seedWorkspace({ role: "owner" });
    try {
      const res = await fetch(`/api/projects/${seed.projectId}/tree`, {
        headers: await installTestSession(outsider.userId),
      });
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });

  it("cross-project parent_id returns 400/404 (folder belongs to another project)", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const otherFolder = await mkFolder(other.projectId, null, "outside");
      const res = await fetch(
        `/api/projects/${seed.projectId}/tree?parent_id=${otherFolder.id}`,
        { headers: await installTestSession(seed.userId) },
      );
      expect([400, 404]).toContain(res.status);
    } finally {
      await other.cleanup();
    }
  });
});
```

Adapt harness calls (`installTestSession`, `fetch`, `app.request`) to whatever pattern `notes.test.ts` / `comments.test.ts` already use — the test file is the authoritative reference.

- [ ] **Step 4.2: Run — expect failure**

```bash
pnpm --filter @opencairn/api test projects-tree
```

- [ ] **Step 4.3: Implement**

Create `apps/api/src/routes/projects-tree.ts`:

```ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db, folders } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import {
  listChildren,
  listChildrenForParents,
  type TreeRow,
} from "../lib/tree-queries";
import type { AppEnv } from "../lib/types";

export const projectsTreeRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:projectId/tree", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);

    if (!(await canRead(user.id, { type: "project", id: projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const parentIdRaw = c.req.query("parent_id");
    let parentId: string | null = null;
    if (parentIdRaw !== undefined) {
      if (!isUuid(parentIdRaw)) return c.json({ error: "Bad Request" }, 400);
      // parent_id must refer to a folder in THIS project.
      const [folder] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, parentIdRaw), eq(folders.projectId, projectId)));
      if (!folder) {
        return c.json(
          { error: "parent_id must be a folder in this project" },
          400,
        );
      }
      parentId = parentIdRaw;
    }

    const roots: TreeRow[] = await listChildren({ projectId, parentId });

    // Only folders can have children — prefetch one level of grandchildren
    // for any folder with childCount > 0. Notes are leaves.
    const parentIds = roots
      .filter((r) => r.kind === "folder" && r.childCount > 0)
      .map((r) => r.id);
    const grouped = await listChildrenForParents({ projectId, parentIds });

    return c.json({
      nodes: roots.map((r) => ({
        kind: r.kind,
        id: r.id,
        parent_id: r.parentId,
        label: r.label,
        child_count: r.childCount,
        children:
          r.kind === "folder"
            ? (grouped.get(r.id) ?? []).map((ch) => ({
                kind: ch.kind,
                id: ch.id,
                parent_id: ch.parentId,
                label: ch.label,
                child_count: ch.childCount,
              }))
            : [],
      })),
    });
  });
```

Mount in `apps/api/src/index.ts` alongside other `projects`-prefixed routes (use the same `.route("/api/projects", ...)` base the existing code uses — locate by grepping for the existing `projects` mount).

- [ ] **Step 4.4: Re-run**

```bash
pnpm --filter @opencairn/api test projects-tree
```

Expected: all pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/routes/projects-tree.ts \
        apps/api/src/index.ts \
        apps/api/tests/projects-tree.test.ts
git commit -m "feat(api): add project tree endpoint with 1-level prefetch (folders+notes)"
```

---

## Task 5: `GET /api/projects/:id/permissions` (batched)

Returns the caller's effective project role + a map of `page_permissions` overrides the caller has (keyed by `pageId` → `notes.id`). Client uses this to skip per-node permission checks during render (spec §4.6.1, §4.10).

Folders do **not** have per-folder permissions in v1 — they inherit the project role (noted in ADR 009 consequences).

**Files:**
- Create: `apps/api/src/routes/projects-permissions.ts`
- Modify: `apps/api/src/index.ts` — mount
- Create: `apps/api/tests/projects-permissions.test.ts`

- [ ] **Step 5.1: Failing test**

Use `seedWorkspace` + the project's actual role (owner / editor / viewer — `seedWorkspace({role})` handles all three via `projectPermissions` inserts) and `setPagePermission(userId, noteId, role)` from `helpers/seed.ts`.

```ts
// apps/api/tests/projects-permissions.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { seedWorkspace, setPagePermission, type SeedResult } from "./helpers/seed";
import { installTestSession } from "./helpers/session";

describe("GET /api/projects/:id/permissions", () => {
  const cleanups: SeedResult[] = [];
  afterEach(async () => {
    for (const s of cleanups.splice(0)) await s.cleanup();
  });

  it("returns owner role for workspace owner", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);

    const res = await fetch(`/api/projects/${seed.projectId}/permissions`, {
      headers: await installTestSession(seed.userId),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("owner");
    expect(body.overrides).toEqual({});
  });

  it("returns viewer role + page-level overrides", async () => {
    const seed = await seedWorkspace({ role: "viewer" });
    cleanups.push(seed);
    // viewer has projectPermissions row role="viewer" — seed.noteId is readable via
    // inheritParent=true. Grant an explicit editor override on the seed note:
    await setPagePermission(seed.userId, seed.noteId, "editor");

    const res = await fetch(`/api/projects/${seed.projectId}/permissions`, {
      headers: await installTestSession(seed.userId),
    });
    const body = await res.json();
    expect(body.role).toBe("viewer");
    expect(body.overrides[seed.noteId]).toBe("editor");
  });

  it("403 for non-members", async () => {
    const inside = await seedWorkspace({ role: "owner" });
    const outside = await seedWorkspace({ role: "owner" });
    cleanups.push(inside, outside);

    const res = await fetch(`/api/projects/${inside.projectId}/permissions`, {
      headers: await installTestSession(outside.userId),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 5.2: Implement**

```ts
// apps/api/src/routes/projects-permissions.ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  db,
  projects,
  projectPermissions,
  pagePermissions,
  workspaceMembers,
  workspaces,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

export const projectsPermissionsRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:projectId/permissions", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);

    const [proj] = await db
      .select({ id: projects.id, workspaceId: projects.workspaceId, defaultRole: projects.defaultRole })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!proj) return c.json({ error: "Not found" }, 404);

    // Resolve the effective role. Precedence: workspace owner > workspace admin >
    // projectPermissions row > workspace member (→ project defaultRole) > forbidden.
    type Role = "owner" | "admin" | "editor" | "commenter" | "viewer";
    let role: Role | null = null;

    const [ws] = await db
      .select({ ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, proj.workspaceId));

    if (ws?.ownerId === user.id) {
      role = "owner";
    } else {
      const [wm] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, proj.workspaceId),
          eq(workspaceMembers.userId, user.id),
        ));
      if (wm?.role === "admin") {
        role = "admin";
      } else if (wm) {
        const [pp] = await db
          .select({ role: projectPermissions.role })
          .from(projectPermissions)
          .where(and(
            eq(projectPermissions.projectId, projectId),
            eq(projectPermissions.userId, user.id),
          ));
        role = (pp?.role as Role) ?? (proj.defaultRole as Role) ?? null;
      }
    }

    if (!role) return c.json({ error: "Forbidden" }, 403);

    const overrideRows = await db
      .select({ pageId: pagePermissions.pageId, role: pagePermissions.role })
      .from(pagePermissions)
      .where(eq(pagePermissions.userId, user.id));

    const overrides: Record<string, string> = {};
    for (const row of overrideRows) overrides[row.pageId] = row.role;

    return c.json({ role, overrides });
  });
```

Mount in `apps/api/src/index.ts` alongside the tree route.

- [ ] **Step 5.3: Run + commit**

```bash
pnpm --filter @opencairn/api test projects-permissions
git add apps/api/src/routes/projects-permissions.ts \
        apps/api/src/index.ts \
        apps/api/tests/projects-permissions.test.ts
git commit -m "feat(api): batch project permissions with page-level overrides"
```

---

## Task 6: SSE tree stream `/api/stream/projects/:id/tree`

Sends `tree.folder_*` and `tree.note_*` events. Uses an in-process event bus tied to the existing folder/note CRUD routes. Response pattern matches `apps/api/src/routes/import.ts` (native `ReadableStream` + `Response` with `text/event-stream`).

**Files:**
- Create: `apps/api/src/lib/tree-events.ts`
- Create: `apps/api/src/routes/stream-projects-tree.ts`
- Modify: `apps/api/src/routes/folders.ts` — emit on POST/PATCH (name/parent_id)/DELETE
- Modify: `apps/api/src/routes/notes.ts` — emit on POST/PATCH (title/folder_id)/DELETE (soft) + a `restore` surface if Phase 2 needs it (else defer the `tree.note_restored` wire-up to the tab/trash plan and document it as a TODO)
- Create: `apps/api/tests/stream-projects-tree.test.ts`

- [ ] **Step 6.1: Event bus**

Create `apps/api/src/lib/tree-events.ts`:

```ts
import { EventEmitter } from "node:events";

export type TreeEventKind =
  | "tree.folder_created"
  | "tree.folder_renamed"
  | "tree.folder_moved"
  | "tree.folder_deleted"
  | "tree.note_created"
  | "tree.note_renamed"
  | "tree.note_moved"
  | "tree.note_deleted"
  | "tree.note_restored";

// Shape matches §11.3 TreeNode minus `children` (clients just invalidate
// the relevant subtree in React Query cache — no need to ship the body).
export interface TreeEvent {
  kind: TreeEventKind;
  projectId: string;
  id: string;                 // folder id or note id
  parentId: string | null;    // folders.parent_id or notes.folder_id
  label?: string;             // folder.name or note.title (present on created/renamed)
  at: string;
}

class TreeEventBus extends EventEmitter {
  emitEvent(e: TreeEvent): void {
    this.emit(`project:${e.projectId}`, e);
  }
  subscribe(projectId: string, handler: (e: TreeEvent) => void): () => void {
    const ch = `project:${e.projectId}`; // eslint-disable-line — replaced below
    return this.off.bind(this, ch, handler) as () => void;
  }
}

// ^ The shorthand above is intentional pseudo-code to keep the README short;
// the real implementation below avoids the EventBus closure capture bug and
// uses a plain EventEmitter with subscribe/unsubscribe helpers:

export const treeEventBus = new EventEmitter();
treeEventBus.setMaxListeners(1000);

export function emitTreeEvent(e: TreeEvent): void {
  treeEventBus.emit(`project:${e.projectId}`, e);
}

export function subscribeTreeEvents(
  projectId: string,
  handler: (e: TreeEvent) => void,
): () => void {
  const ch = `project:${projectId}`;
  treeEventBus.on(ch, handler);
  return () => {
    treeEventBus.off(ch, handler);
  };
}
```

(Implementation note: favor `emitTreeEvent` / `subscribeTreeEvents` free functions over a class — tests mock them more cleanly and there's no per-bus state worth encapsulating.)

- [ ] **Step 6.2: Wire existing CRUD handlers to emit**

**`apps/api/src/routes/folders.ts`** — after each successful mutation:

- `POST /` → `tree.folder_created` with `{ projectId: body.projectId, id: folder.id, parentId: folder.parentId, label: folder.name }`
- `PATCH /:id` → compare the pre/post row and emit:
  - `tree.folder_renamed` if `name` changed
  - `tree.folder_moved` if `parent_id` changed (this one also implies the plan's `moveFolder` path rewrite — see Task 3; for Phase 2, the existing PATCH handler updates only `parent_id` scalar, so extend it to call `moveFolder` when `parent_id` changes so paths stay consistent)
- `DELETE /:id` → `tree.folder_deleted`. If the folder had children, hard-delete cascades via FK; the policy decision is in spec §14 open question.

**`apps/api/src/routes/notes.ts`** — at each success path:

- `POST /` → `tree.note_created` with `{ projectId: body.projectId, id: note.id, parentId: note.folderId, label: note.title }`
- `PATCH /:id` → `tree.note_renamed` if `title` changed; `tree.note_moved` if `folder_id` changed
- `DELETE /:id` → `tree.note_deleted` (soft delete via `deleted_at`). `tree.note_restored` is **not** emitted in v1 — mark with `// TODO(phase-later): emit tree.note_restored from trash-restore endpoint` at the spot the restore surface would live.

Pattern for each site:

```ts
import { emitTreeEvent } from "../lib/tree-events";
// ...after the DB commit:
emitTreeEvent({
  kind: "tree.folder_created",
  projectId,
  id: folder.id,
  parentId: folder.parentId,
  label: folder.name,
  at: new Date().toISOString(),
});
```

Emit **after** the transaction commits — never from inside a drizzle `transaction` callback, to avoid clients seeing an event for a mutation that gets rolled back.

- [ ] **Step 6.3: SSE route**

Create `apps/api/src/routes/stream-projects-tree.ts` — follow the `import.ts` pattern (native `ReadableStream` + `Response`) to stay consistent with other SSE routes in this codebase.

```ts
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { subscribeTreeEvents, type TreeEvent } from "../lib/tree-events";
import type { AppEnv } from "../lib/types";

const PING_INTERVAL_MS = 30_000;

export const streamProjectsTreeRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:projectId/tree", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        const unsub = subscribeTreeEvents(projectId, (e: TreeEvent) => {
          try { send(e.kind, e); } catch { /* client closed */ }
        });

        const pingTimer: NodeJS.Timeout = setInterval(() => {
          try { send("ping", { at: new Date().toISOString() }); } catch {}
        }, PING_INTERVAL_MS);

        signal.addEventListener("abort", () => {
          clearInterval(pingTimer);
          unsub();
          try { controller.close(); } catch {}
        });

        // Send an immediate "ready" so clients know the stream is open.
        send("ready", { projectId });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
```

Mount in `apps/api/src/index.ts` at `/api/stream/projects`.

- [ ] **Step 6.4: Integration test**

```ts
// apps/api/tests/stream-projects-tree.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { seedWorkspace, type SeedResult } from "./helpers/seed";
import { installTestSession } from "./helpers/session";
import { emitTreeEvent } from "../src/lib/tree-events";

describe("GET /api/stream/projects/:id/tree", () => {
  const cleanups: SeedResult[] = [];
  afterEach(async () => {
    for (const s of cleanups.splice(0)) await s.cleanup();
  });

  it("streams a folder_created event after a folder POST", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);

    const headers = await installTestSession(seed.userId);
    const controller = new AbortController();
    const res = await fetch(`/api/stream/projects/${seed.projectId}/tree`, {
      headers,
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const received: string[] = [];
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const readLoop = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value).split("\n")) {
          if (line.startsWith("event: ")) received.push(line.slice(7));
        }
      }
    })();

    // Emit directly via the bus — avoids needing the full POST /folders harness.
    emitTreeEvent({
      kind: "tree.folder_created",
      projectId: seed.projectId,
      id: "00000000-0000-0000-0000-000000000001",
      parentId: null,
      label: "new",
      at: new Date().toISOString(),
    });

    await vi.waitFor(
      () => expect(received).toContain("tree.folder_created"),
      { timeout: 2000 },
    );

    controller.abort();
    await readLoop.catch(() => {});
  });
});
```

The `emitTreeEvent` bus write is hermetic — it avoids wiring a full CRUD request in this test and lets you exercise the stream in isolation. End-to-end coverage (POST /folders → SSE event) lives in the Playwright sidebar spec (Task 15).

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/lib/tree-events.ts \
        apps/api/src/routes/stream-projects-tree.ts \
        apps/api/src/routes/folders.ts \
        apps/api/src/routes/notes.ts \
        apps/api/src/index.ts \
        apps/api/tests/stream-projects-tree.test.ts
git commit -m "feat(api): SSE stream for folder+note tree events"
```

---

## Task 7: `useProjectTree` React Query + SSE hook

Frontend hook that fetches `/api/projects/:id/tree`, subscribes to `/api/stream/projects/:id/tree`, and maps tree events onto selective React Query cache invalidations. Tree nodes carry a `kind` discriminator so the tree component can render folders and notes differently without re-deriving the model.

**Files:**
- Create: `apps/web/src/hooks/use-project-tree.ts`
- Create: `apps/web/src/hooks/use-project-tree.test.tsx`

- [ ] **Step 7.1: Failing test**

```tsx
// apps/web/src/hooks/use-project-tree.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useProjectTree, type TreeNode } from "./use-project-tree";

const mkQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

afterEach(() => fetchMock.mockReset());

describe("useProjectTree", () => {
  it("loads root nodes on mount (folders + notes)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async (): Promise<{ nodes: TreeNode[] }> => ({
        nodes: [
          { kind: "folder", id: "f1", parent_id: null, label: "Folder A", child_count: 0, children: [] },
          { kind: "note",   id: "n1", parent_id: null, label: "Root note",  child_count: 0 },
        ],
      }),
    });
    const qc = mkQc();
    const { result } = renderHook(() => useProjectTree({ projectId: "x" }), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.roots).toHaveLength(2));
    expect(result.current.roots[0].kind).toBe("folder");
    expect(result.current.roots[1].kind).toBe("note");
  });
});
```

(Full SSE integration is covered by the e2e spec in Task 15. The unit test here just pins the fetch wiring + shape.)

- [ ] **Step 7.2: Implement**

```ts
// apps/web/src/hooks/use-project-tree.ts
"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface TreeNode {
  kind: "folder" | "note";
  id: string;
  parent_id: string | null;   // folder.parent_id OR note.folder_id
  label: string;              // folder.name OR note.title
  child_count: number;        // 0 for notes
  children?: TreeNode[];      // folders only, prefetched one level
}

interface TreeResponse { nodes: TreeNode[] }

const treeKey = (projectId: string, parentId: string | null) =>
  ["project-tree", projectId, parentId ?? "root"] as const;

async function fetchTree(projectId: string, parentId: string | null): Promise<TreeNode[]> {
  const url = parentId
    ? `/api/projects/${projectId}/tree?parent_id=${parentId}`
    : `/api/projects/${projectId}/tree`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`tree ${r.status}`);
  const body = (await r.json()) as TreeResponse;
  return body.nodes;
}

export function useProjectTree(opts: { projectId: string }) {
  const qc = useQueryClient();
  const rootQuery = useQuery({
    queryKey: treeKey(opts.projectId, null),
    queryFn: () => fetchTree(opts.projectId, null),
  });

  useEffect(() => {
    const src = new EventSource(`/api/stream/projects/${opts.projectId}/tree`);

    // Per-event handlers so we can invalidate the smallest useful subtree.
    // Event payloads carry `parentId` (from tree-events.ts), which tells us
    // exactly which parent's children list is stale.
    const invalidateParent = (raw: MessageEvent) => {
      try {
        const evt = JSON.parse(raw.data) as { parentId: string | null };
        qc.invalidateQueries({
          queryKey: treeKey(opts.projectId, evt.parentId ?? null),
        });
      } catch {
        // Malformed payload — fall back to full tree invalidation.
        qc.invalidateQueries({ queryKey: ["project-tree", opts.projectId] });
      }
    };

    // For moves, both old and new parents have stale children lists. The
    // event does not carry the old parent, so `tree.*_moved` invalidates
    // every cached tree page for this project.
    const invalidateAll = () =>
      qc.invalidateQueries({ queryKey: ["project-tree", opts.projectId] });

    const created = ["tree.folder_created", "tree.note_created"] as const;
    const renamed = ["tree.folder_renamed", "tree.note_renamed"] as const;
    const moved   = ["tree.folder_moved", "tree.note_moved"] as const;
    const deleted = ["tree.folder_deleted", "tree.note_deleted", "tree.note_restored"] as const;

    for (const ev of created)  src.addEventListener(ev, invalidateParent);
    for (const ev of renamed)  src.addEventListener(ev, invalidateParent);
    for (const ev of moved)    src.addEventListener(ev, invalidateAll);
    for (const ev of deleted)  src.addEventListener(ev, invalidateParent);

    return () => src.close();
  }, [opts.projectId, qc]);

  async function loadChildren(parentId: string): Promise<TreeNode[]> {
    return qc.fetchQuery({
      queryKey: treeKey(opts.projectId, parentId),
      queryFn: () => fetchTree(opts.projectId, parentId),
    });
  }

  return {
    roots: rootQuery.data ?? [],
    isLoading: rootQuery.isLoading,
    loadChildren,
  };
}
```

- [ ] **Step 7.3: Run + commit**

```bash
pnpm --filter @opencairn/web test use-project-tree
git add apps/web/src/hooks/use-project-tree.ts apps/web/src/hooks/use-project-tree.test.tsx
git commit -m "feat(web): add useProjectTree hook with folder+note SSE invalidation"
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
    // Folders: toggle-open is handled by react-arborist; click on the row
    // beyond the chevron does nothing. Notes: open in a tab.
    if (node.data.kind === "folder") return;
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

  const hasChildren = node.data.kind === "folder" && node.data.child_count > 0;

  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 rounded px-1 text-sm hover:bg-accent"
    >
      {hasChildren ? (
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
      {/* Phase 2 has no per-node icon column in the DB; render a type-based
          default. Folder emoji/icon support is a Phase 2 follow-up (spec §14). */}
      {node.data.kind === "folder" ? (
        <Folder className="h-3.5 w-3.5 text-muted-foreground" />
      ) : (
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="truncate">{node.data.label}</span>
      {hasChildren ? (
        <span className="ml-auto text-[10px] text-muted-foreground">
          {node.data.child_count}
        </span>
      ) : null}
    </div>
  );
}
```

(Import `Folder` alongside `FileText` from `lucide-react`.)

- [ ] **Step 10.4: Commit**

```bash
git add apps/web/src/components/sidebar/project-tree*.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add virtualized project tree (react-arborist)"
```

---

## Task 11: Drag-drop move via dnd-kit

Hook into react-arborist's `onMove`. A dragged node carries its `kind` so the client picks the right endpoint: folders → `PATCH /api/folders/:id` (parent_id + position), notes → `PATCH /api/notes/:id/move` (folder_id). Respect 3-way drop zones and project boundaries. Notes cannot be drop *targets* (they're leaves) — the drop slot on a note row treats it as an insertion point relative to its folder.

**Files:**
- Modify: `apps/web/src/components/sidebar/project-tree.tsx` — add `onMove` handler
- Create: `apps/web/src/hooks/use-tree-drag-drop.ts`
- Modify: `apps/api/src/routes/folders.ts` — extend existing PATCH to emit `tree.folder_moved` and call `moveFolder` when parent_id changes; add `position` field to `updateFolderSchema` in `@opencairn/shared` if missing
- Modify: `apps/api/src/routes/notes.ts` — add `PATCH /:id/move` that calls `moveNote` and emits `tree.note_moved`. A move-only endpoint keeps the "title/content" PATCH unchanged and side-steps Yjs coupling.

- [ ] **Step 11.1: Client move handler**

Edit `project-tree.tsx` to pass `onMove`:

```tsx
async function onMove({
  dragIds, dragNodes, parentId, index,
}: {
  dragIds: string[];
  dragNodes: Array<{ data: TreeNode }>;
  parentId: string | null;  // null → root
  index: number;
}) {
  for (const node of dragNodes) {
    const body = node.data.kind === "folder"
      ? { parent_id: parentId, position: index }
      : { folder_id: parentId };
    const url = node.data.kind === "folder"
      ? `/api/folders/${node.data.id}`
      : `/api/notes/${node.data.id}/move`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("이동에 실패했습니다");
      qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
    }
  }
}
```

Optimistic UI: react-arborist reorders immediately; on failure we re-fetch.

- [ ] **Step 11.2: Server move endpoints**

**folders.ts** — extend the existing `.patch("/:id", ...)` handler:

```ts
// apps/api/src/routes/folders.ts
.patch("/:id", zValidator("json", updateFolderSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
  const [existing] = await db
    .select({ projectId: folders.projectId, parentId: folders.parentId, name: folders.name })
    .from(folders)
    .where(eq(folders.id, id));
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!(await canWrite(user.id, { type: "project", id: existing.projectId }))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = c.req.valid("json");
  const movingParent =
    body.parent_id !== undefined && body.parent_id !== existing.parentId;
  const renaming = body.name !== undefined && body.name !== existing.name;

  if (movingParent) {
    // Path rewrite lives in moveFolder — call it instead of a raw UPDATE so
    // descendant paths stay consistent.
    await moveFolder({
      projectId: existing.projectId,
      folderId: id,
      newParentId: body.parent_id ?? null,
    });
  }

  if (renaming || body.position !== undefined) {
    const nextSet: Partial<typeof folders.$inferInsert> = {};
    if (renaming) nextSet.name = body.name!;
    if (body.position !== undefined) nextSet.position = body.position;
    await db.update(folders).set(nextSet).where(eq(folders.id, id));
  }

  const [after] = await db.select().from(folders).where(eq(folders.id, id));

  // Emit AFTER all writes commit.
  if (movingParent) {
    emitTreeEvent({
      kind: "tree.folder_moved",
      projectId: existing.projectId,
      id,
      parentId: after.parentId,
      label: after.name,
      at: new Date().toISOString(),
    });
  }
  if (renaming) {
    emitTreeEvent({
      kind: "tree.folder_renamed",
      projectId: existing.projectId,
      id,
      parentId: after.parentId,
      label: after.name,
      at: new Date().toISOString(),
    });
  }

  return c.json(after);
});
```

**notes.ts** — add a dedicated move endpoint so it doesn't collide with the Yjs-bound PATCH that rejects `content`:

```ts
.patch("/:id/move", zValidator("json", z.object({
  folder_id: z.string().uuid().nullable(),
})), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
  const [note] = await db
    .select({ projectId: notes.projectId })
    .from(notes)
    .where(eq(notes.id, id));
  if (!note) return c.json({ error: "Not found" }, 404);
  if (!(await canWrite(user.id, { type: "note", id }))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const { folder_id } = c.req.valid("json");
  try {
    await moveNote({ projectId: note.projectId, noteId: id, newFolderId: folder_id });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  emitTreeEvent({
    kind: "tree.note_moved",
    projectId: note.projectId,
    id,
    parentId: folder_id,
    at: new Date().toISOString(),
  });
  return c.json({ ok: true });
});
```

- [ ] **Step 11.3: Test moves**

Add two cases to `apps/api/tests/projects-tree.test.ts` (or a dedicated `moves.test.ts`):

- Folder move: PATCH `/api/folders/:id` with a new `parent_id` → subtree reappears under the new parent on the tree endpoint.
- Note move: PATCH `/api/notes/:id/move` with `folder_id` → `notes.folder_id` updated, `tree.note_moved` emitted.

Use the helpers from Task 3/4 (direct `db.insert` + `seedWorkspace`).

- [ ] **Step 11.4: Commit**

```bash
git add apps/web/src/components/sidebar/project-tree.tsx \
        apps/api/src/routes/folders.ts \
        apps/api/src/routes/notes.ts \
        apps/api/tests/projects-tree.test.ts
git commit -m "feat(web,api): folder+note drag-drop move with optimistic ui"
```

---

## Task 12: Inline rename + context menu

Double-click or F2 starts rename (contentEditable row). Enter confirms PATCH title, Esc cancels. Right-click and `⋯` button both open the same context menu.

**Files:**
- Modify: `apps/web/src/components/sidebar/project-tree-node.tsx`
- Create: `apps/web/src/components/sidebar/tree-context-menu.tsx`

- [ ] **Step 12.1: Extend row to support rename state**

Add a `renamingId` signal in `project-tree.tsx` (lift state up). Pass `isRenaming` + `onStartRename` + `onCommitRename(id, kind, newLabel | null)` to `ProjectTreeNode`. In the node, conditionally render `<input>` vs `<span>`.

```tsx
// inside ProjectTreeNode (pseudo-diff)
{isRenaming ? (
  <input
    autoFocus
    defaultValue={node.data.label}
    className="flex-1 bg-transparent text-sm outline-none"
    onKeyDown={(e) => {
      if (e.key === "Enter") onCommitRename(node.data.id, node.data.kind, e.currentTarget.value);
      if (e.key === "Escape") onCommitRename(node.data.id, node.data.kind, null);
    }}
    onBlur={(e) => onCommitRename(node.data.id, node.data.kind, e.currentTarget.value)}
  />
) : (
  <span className="truncate">{node.data.label}</span>
)}
```

`onCommitRename(id, kind, null)` = cancel. Non-null commits:

- `kind === "folder"` → `PATCH /api/folders/:id` with `{ name: newLabel }`
- `kind === "note"`   → `PATCH /api/notes/:id` with `{ title: newLabel }` (the existing note PATCH handler already omits `content` — Yjs is canonical)

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
  if (!confirm(`"${focused.data.label}"을(를) 삭제할까요?`)) return;
  const url = focused.data.kind === "folder"
    ? `/api/folders/${focused.data.id}`
    : `/api/notes/${focused.data.id}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) toast.error("삭제에 실패했습니다");
  // SSE (tree.folder_deleted / tree.note_deleted) will invalidate the cache.
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
- Create: `apps/web/tests/e2e/fixtures/seed-5k-nodes.ts`

- [ ] **Step 15.1: Fixtures**

`seed-5k-nodes.ts` — helper that seeds 5000 tree nodes (mix of folders + notes, e.g. 500 folders ~3 levels deep, 4500 notes distributed) into a fresh workspace/project for the perf run. Used only in the tagged perf test below.

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

  test("shows new folder via SSE after POST /folders", async ({ page }) => {
    const { slug, projectId, workspaceId } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    const before = await page.getByTestId("project-tree").getByRole("treeitem").count();
    await page.request.post(`/api/folders`, {
      data: { projectId, name: "new-folder", parentId: null },
    });
    await expect(async () => {
      const n = await page.getByTestId("project-tree").getByRole("treeitem").count();
      expect(n).toBe(before + 1);
    }).toPass({ timeout: 3000 });
  });

  test("shows new note via SSE after POST /notes", async ({ page }) => {
    const { slug, projectId, workspaceId } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    const before = await page.getByTestId("project-tree").getByRole("treeitem").count();
    await page.request.post(`/api/notes`, {
      data: { projectId, workspaceId, title: "new-note-from-api", folderId: null },
    });
    await expect(async () => {
      const n = await page.getByTestId("project-tree").getByRole("treeitem").count();
      expect(n).toBe(before + 1);
    }).toPass({ timeout: 3000 });
  });

  test("double-click enters rename, Enter commits (note)", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    // The seeded note is at root — first treeitem.
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
  test("renders 5K nodes under 300ms @perf", async ({ page }) => {
    test.slow();
    const { seed5kNodes } = await import("./fixtures/seed-5k-nodes");
    const { slug } = await seed5kNodes();
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
        apps/web/tests/e2e/fixtures/seed-5k-nodes.ts
git commit -m "test(web): e2e sidebar coverage and 5k-node perf smoke"
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
- [ ] `folders.path` migrated + backfilled (notes unchanged)
- [ ] Tree API (list, perms, SSE) tests green — folders + notes as discriminated nodes
- [ ] react-arborist + dnd-kit tree renders both folders and notes, supports drag-drop (folder move via ltree, note move via `folder_id`), rename, keyboard
- [ ] Workspace switcher + project hero + global nav + footer wired
- [ ] Empty state when no projects
- [ ] E2E sidebar spec passes, 5K-node perf test under 300ms
- [ ] Manual smoke: open workspace → tree loads → POST /folders and POST /notes in another tab via API → SSE pushes both into sidebar live

## What's NOT in this plan

| Item | Phase |
|------|-------|
| Tab bar, preview mode, split pane, viewers | 3 |
| Agent panel, threads DB/API, composer | 4 |
| Dashboard/project/research views, palette, notifications drawer, account settings | 5 |
| Multi-select rows + Shift-click range selection | 5 (hooked to palette context) |
| `⌘Shift D` daily notes | separate backlog |
