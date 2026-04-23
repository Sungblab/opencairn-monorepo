# ADR 009 — Page Tree Storage

**Date:** 2026-04-23
**Status:** Accepted
**Context spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §4.6
**Implementation plan:** `docs/superpowers/plans/2026-04-23-app-shell-phase-2-sidebar.md`

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

- Requires `CREATE EXTENSION ltree;` on prod + dev DBs. The sidebar migration emits `CREATE EXTENSION IF NOT EXISTS ltree` at its head so existing environments pick it up idempotently.
- Drizzle custom column definition needed (`ltree`). Wrap in `customType` helper.
- Move operation must update descendant paths in a single transaction:
  ```sql
  UPDATE pages SET path = :newPrefix || subpath(path, nlevel(:oldPrefix))
  WHERE path <@ :oldPrefix;
  ```
- `ltree` labels only accept `[A-Za-z0-9_]`, so UUIDs must have dashes replaced with underscores when encoding into path labels.

## Review trigger

Revisit if a project grows > 50K pages AND move operations cluster (e.g., batch reorganization features).
