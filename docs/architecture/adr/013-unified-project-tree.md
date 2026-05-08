# ADR 013 — Unified Project Tree

**Date:** 2026-05-08
**Status:** Accepted
**Supersedes:** ADR 009 for sidebar hierarchy reads and writes

## Context

ADR 009 kept hierarchy in `folders.path` and treated notes/files as leaves.
That was enough for folder navigation, but not for the product model where an
uploaded PDF expands into original file, parsed markdown, page artifacts,
figures, analysis, and AI notes.

## Decision

Add `project_tree_nodes` as the hierarchy and ordering source of truth. Each
visible project object gets a tree node. Content tables stay authoritative for
their own data:

- `folders` own folder compatibility fields.
- `notes` own editor state, source metadata, and page permissions.
- `agent_files` own stored bytes and versions.
- `code_workspaces` own code workspace manifests and snapshots.

Tree nodes may parent other tree nodes regardless of target table. The first
container kinds are `folder`, `note`, `source_bundle`, `artifact_group`, and
`code_workspace`.

Legacy columns remain as mirrors during transition. Moves through the unified
tree update `project_tree_nodes` first, then mirror old folder columns only when
the new parent is folder-backed.

## Consequences

- `/api/projects/:projectId/tree` reads from `project_tree_nodes`.
- `/api/tree/nodes/:id/move` handles reorder and re-parent operations.
- PDF upload creates a `source_bundle` before Temporal starts.
- Worker callbacks materialize parsed artifacts and notes under that bundle.
- Existing note/file/code workspace routes remain the content access boundary.
- No independent tree-node permission model is introduced in this cut.
