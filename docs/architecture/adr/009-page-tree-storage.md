# ADR 009 — Page Tree Storage

**Date:** 2026-04-23
**Status:** Accepted
**Context spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §4.6
**Implementation plan:** `docs/superpowers/plans/2026-04-23-app-shell-phase-2-sidebar.md`

## Context

The App Shell Redesign spec §4 describes a sidebar "tree". The real
schema (established in Plan 1/2A/2B/3/4) splits that tree across two
tables rather than a Notion-style unified `pages` table:

- `folders` — hierarchical via `folders.parent_id` self-reference, carry
  `name` + `position`. No content, no permissions of their own (they
  inherit project-level access).
- `notes` — leaves attached to a folder via `notes.folder_id` (nullable
  for root-level notes). Carry `title`, Plate `content`, embeddings,
  Yjs document. Subject to per-note overrides in `page_permissions`
  (which already uses `pageId → notes.id`).

So the "tree" the sidebar renders is:

```
folder (parent_id) ─┬─ folder (parent_id) ─┬─ note (folder_id)
                    │                      └─ note (folder_id)
                    └─ note (folder_id)
```

The hierarchical dimension lives entirely in `folders`. Notes are
flat within whichever folder contains them.

## Decision

Add a Postgres `ltree` materialized-path column to **`folders` only**.
Notes continue to reference their container via `folder_id` and do not
need a path column — moving a note is a single-row `UPDATE notes SET
folder_id = :new`.

## Options considered (for folder tree storage)

| Option | Read (subtree) | Write (move) | Schema cost | Ecosystem |
|--------|----------------|--------------|-------------|-----------|
| `ltree` on `folders` | `path <@ ancestor` uses GiST, O(log n) | Update subtree paths on move, bounded by subtree size | 1 column + GiST index on `folders` | Postgres native, `drizzle-orm/pg-core` supports custom column |
| Closure table | Join on (ancestor, descendant), O(1) per pair | Insert/delete all ancestor rows on move, O(depth × subtree) | Extra table, 2 FKs, triggers to maintain | ORM-agnostic |
| `parent_id` only (current) | Recursive CTE, O(depth) | Single row update | Already present | Built-in |

Workload facts (from product):
- ≤ 5K nodes per project (folders + notes combined). Folder count
  typically a small fraction (< 500).
- Typical folder subtree size < 100.
- Folder moves are rare (< 1/user/session); note moves are frequent
  but are single-row and don't involve `ltree`.
- "List children" (folder + note leaves of a given parent) is the
  dominant read pattern.

`ltree` on folders fits — the hierarchical reads scale without recursive
CTEs, and moves stay bounded by the subtree size.

## Consequences

### For folders
- `ALTER TABLE folders ADD COLUMN path ltree NOT NULL` + GiST index.
- `CREATE EXTENSION IF NOT EXISTS ltree` emitted at the head of the
  migration (idempotent).
- Drizzle `customType` for `ltree` lives in
  `packages/db/src/schema/custom-types.ts`.
- Label encoding: `ltree` accepts only `[A-Za-z0-9_]`, so UUIDs have
  dashes replaced with underscores (`regexp_replace(id::text, '-',
  '_', 'g')`).
- Move operation updates all descendant paths in a single transaction:
  ```sql
  UPDATE folders
  SET path = :newPrefix || subpath(path, nlevel(:oldPrefix))
  WHERE path <@ :oldPrefix;
  ```

### For notes
- No schema change. Notes remain `(folder_id, position)` ordered leaves.
- Moving a note across folders is `UPDATE notes SET folder_id = :new` —
  no path math, no subtree walk.
- A note's "depth" in the UI tree is derived from its folder's path.
  The API ships notes grouped by `folder_id` so the client never
  computes this.

### For the tree API
- `GET /api/projects/:id/tree?parent_id=X` returns a discriminated
  node list:
  - Folders with `parent_id = X` (using `folders.path` for ordering
    by `path ASC, position ASC`)
  - Notes with `folder_id = X` (ordered by `position ASC, created_at ASC`)
- `parent_id = null` returns root-level folders + root-level notes.

### For permissions
- Existing `page_permissions` (a `notes.id` override table) remains
  authoritative for note-level access. Folders inherit project-level
  access — no new permission surface in Phase 2.

## Review trigger

Revisit if a project grows > 50K nodes AND folder moves become clustered
(batch reorganization features), OR if the product introduces
note-inside-note nesting (at which point notes also need ltree and the
split collapses into a unified `pages` table — planned as a separate
migration with its own ADR).
