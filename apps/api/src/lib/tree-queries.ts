// Unified folder-tree + note-leaf query helpers for the App Shell sidebar
// (ADR 009, spec §4.6.1). `folders` is the hierarchical dimension (ltree
// path); `notes` are flat leaves inside whichever folder contains them
// (folder_id). These helpers expose both shapes as a single discriminated
// TreeRow stream so the sidebar endpoint and drag-drop flows only have to
// speak one shape.

import { and, eq, sql, db, folders, notes } from "@opencairn/db";

/**
 * ltree labels may only contain [A-Za-z0-9_]. UUIDs include dashes, so we
 * normalize them with underscores both on insert and when rebuilding a
 * subtree prefix during move.
 */
export const labelFromId = (uuid: string): string => uuid.replace(/-/g, "_");

export interface TreeRow {
  kind: "folder" | "note" | "agent_file" | "code_workspace";
  id: string;
  parentId: string | null;
  label: string;
  pathText: string | null;
  childCount: number;
  fileKind?: string | null;
  mimeType?: string | null;
}

// Must satisfy `Record<string, unknown>` — drizzle's `db.execute<T>` constrains T.
type RawRow = {
  kind: "folder" | "note" | "agent_file" | "code_workspace";
  id: string;
  parentId: string | null;
  label: string;
  pathText: string | null;
  childCount: number;
  fileKind: string | null;
  mimeType: string | null;
} & Record<string, unknown>;

const projectScope = (projectId: string) =>
  sql`p.project_id = ${projectId}::uuid`;

// drizzle-orm on postgres-js sometimes returns the result as { rows: [...] }
// and sometimes as the raw array. Mirror the fallback pattern used in
// apps/api/src/routes/internal.ts (`const data = (r as ...).rows ?? r`).
function asRows<T>(result: unknown): T[] {
  const maybe = result as { rows?: T[] } | T[];
  if (Array.isArray(maybe)) return maybe;
  return maybe.rows ?? [];
}

/**
 * Direct children of `parentId` (null = project root) for a single project,
 * unioning folders (`folders.parent_id = parentId`) with notes
 * (`notes.folder_id = parentId`). Folders come first (sorted by ltree
 * path, which gives a stable left-to-right reading order); notes follow
 * (sorted by `position` then `created_at`).
 */
export async function listChildren(opts: {
  projectId: string;
  parentId: string | null;
}): Promise<TreeRow[]> {
  const folderParent = opts.parentId
    ? sql`p.parent_id = ${opts.parentId}::uuid`
    : sql`p.parent_id IS NULL`;
  const noteParent = opts.parentId
    ? sql`p.folder_id = ${opts.parentId}::uuid`
    : sql`p.folder_id IS NULL`;

  const result = await db.execute<RawRow>(sql`
    SELECT
      'folder'::text                                       AS "kind",
      p.id                                                 AS "id",
      p.parent_id                                          AS "parentId",
      p.name                                               AS "label",
      p.path::text                                         AS "pathText",
      (
        (SELECT COUNT(*)::int FROM folders c WHERE c.parent_id = p.id)
      + (SELECT COUNT(*)::int FROM notes cn
           WHERE cn.folder_id = p.id AND cn.deleted_at IS NULL)
      + (SELECT COUNT(*)::int FROM agent_files af
           WHERE af.folder_id = p.id AND af.deleted_at IS NULL)
      )                                                     AS "childCount",
      NULL                                                  AS "fileKind",
      NULL                                                  AS "mimeType",
      0                                                     AS "sortGroup",
      p.path::text                                          AS "sortKey"
    FROM folders p
    WHERE ${projectScope(opts.projectId)} AND ${folderParent}

    UNION ALL

    SELECT
      'note'::text,
      p.id,
      p.folder_id                                           AS "parentId",
      p.title                                               AS "label",
      NULL                                                  AS "pathText",
      0                                                     AS "childCount",
      NULL                                                  AS "fileKind",
      NULL                                                  AS "mimeType",
      1                                                     AS "sortGroup",
      lpad(
        coalesce(extract(epoch FROM p.created_at)::bigint::text, '0'),
        16,
        '0'
      )                                                     AS "sortKey"
    FROM notes p
    WHERE ${projectScope(opts.projectId)}
      AND ${noteParent}
      AND p.deleted_at IS NULL

    UNION ALL

    SELECT
      'agent_file'::text,
      p.id,
      p.folder_id                                           AS "parentId",
      p.title                                               AS "label",
      NULL                                                  AS "pathText",
      0                                                     AS "childCount",
      p.kind                                                AS "fileKind",
      p.mime_type                                           AS "mimeType",
      2                                                     AS "sortGroup",
      lpad(
        coalesce(extract(epoch FROM p.created_at)::bigint::text, '0'),
        16,
        '0'
      )                                                     AS "sortKey"
    FROM agent_files p
    WHERE ${projectScope(opts.projectId)}
      AND ${noteParent}
      AND p.deleted_at IS NULL

    UNION ALL

    SELECT
      'code_workspace'::text,
      p.id,
      NULL                                                  AS "parentId",
      p.name                                               AS "label",
      NULL                                                  AS "pathText",
      0                                                     AS "childCount",
      'code_workspace'::text                               AS "fileKind",
      NULL                                                  AS "mimeType",
      3                                                     AS "sortGroup",
      lpad(
        coalesce(extract(epoch FROM p.created_at)::bigint::text, '0'),
        16,
        '0'
      )                                                     AS "sortKey"
    FROM code_workspaces p
    WHERE ${projectScope(opts.projectId)}
      AND ${opts.parentId === null ? sql`p.deleted_at IS NULL` : sql`false`}

    ORDER BY "sortGroup", "sortKey"
  `);

  return asRows<RawRow>(result).map(stripSortFields);
}

/**
 * Batched variant of {@link listChildren}: one SQL round-trip returns the
 * children for N parent folders (no note parents — notes are leaves). The
 * sidebar endpoint uses this to prefetch grandchildren of every root it
 * returns without N+1 queries. Empty input short-circuits.
 */
export async function listChildrenForParents(opts: {
  projectId: string;
  parentIds: string[];
}): Promise<Map<string, TreeRow[]>> {
  const grouped = new Map<string, TreeRow[]>();
  if (opts.parentIds.length === 0) return grouped;

  const result = await db.execute<RawRow>(sql`
    SELECT
      'folder'::text                                       AS "kind",
      p.id                                                 AS "id",
      p.parent_id                                          AS "parentId",
      p.name                                               AS "label",
      p.path::text                                         AS "pathText",
      (
        (SELECT COUNT(*)::int FROM folders c WHERE c.parent_id = p.id)
      + (SELECT COUNT(*)::int FROM notes cn
           WHERE cn.folder_id = p.id AND cn.deleted_at IS NULL)
      + (SELECT COUNT(*)::int FROM agent_files af
           WHERE af.folder_id = p.id AND af.deleted_at IS NULL)
      )                                                     AS "childCount",
      NULL                                                  AS "fileKind",
      NULL                                                  AS "mimeType",
      0                                                     AS "sortGroup",
      p.path::text                                          AS "sortKey"
    FROM folders p
    WHERE ${projectScope(opts.projectId)}
      AND p.parent_id IN (${sql.join(opts.parentIds.map((id) => sql`${id}::uuid`), sql`, `)})

    UNION ALL

    SELECT
      'note'::text,
      p.id,
      p.folder_id,
      p.title,
      NULL,
      0,
      NULL,
      NULL,
      1,
      lpad(
        coalesce(extract(epoch FROM p.created_at)::bigint::text, '0'),
        16,
        '0'
      )
    FROM notes p
    WHERE ${projectScope(opts.projectId)}
      AND p.folder_id IN (${sql.join(opts.parentIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND p.deleted_at IS NULL

    UNION ALL

    SELECT
      'agent_file'::text,
      p.id,
      p.folder_id,
      p.title,
      NULL,
      0,
      p.kind,
      p.mime_type,
      2,
      lpad(
        coalesce(extract(epoch FROM p.created_at)::bigint::text, '0'),
        16,
        '0'
      )
    FROM agent_files p
    WHERE ${projectScope(opts.projectId)}
      AND p.folder_id IN (${sql.join(opts.parentIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND p.deleted_at IS NULL

    ORDER BY "sortGroup", "sortKey"
  `);

  for (const pid of opts.parentIds) grouped.set(pid, []);
  for (const raw of asRows<RawRow>(result)) {
    if (!raw.parentId) continue;
    const bucket = grouped.get(raw.parentId);
    if (bucket) bucket.push(stripSortFields(raw));
  }
  return grouped;
}

/**
 * Folder subtree rooted at `rootFolderId`, BFS ordering (by depth then
 * path). Notes are intentionally excluded — move operations only have to
 * rewrite folder paths, and higher-level callers fetch note leaves via
 * {@link listChildren} when they actually need them.
 */
export async function getFolderSubtree(opts: {
  projectId: string;
  rootFolderId: string;
}): Promise<TreeRow[]> {
  const result = await db.execute<RawRow>(sql`
    WITH root AS (
      SELECT path FROM folders
       WHERE id = ${opts.rootFolderId}::uuid
         AND project_id = ${opts.projectId}::uuid
    )
    SELECT
      'folder'::text AS "kind",
      f.id           AS "id",
      f.parent_id    AS "parentId",
      f.name         AS "label",
      f.path::text   AS "pathText",
      0              AS "childCount",
      NULL           AS "fileKind",
      NULL           AS "mimeType"
    FROM folders f, root r
    WHERE f.path <@ r.path
      AND f.project_id = ${opts.projectId}::uuid
    ORDER BY nlevel(f.path), f.path
  `);

  return asRows<RawRow>(result).map(({ kind, id, parentId, label, pathText, childCount, fileKind, mimeType }) => ({
    kind,
    id,
    parentId,
    label,
    pathText,
    childCount,
    fileKind,
    mimeType,
  }));
}

/**
 * Move a folder (and its entire subtree) under a new parent in the same
 * project. `newParentId = null` promotes it to a project-root folder.
 *
 * Transactional:
 * 1. Verify the folder exists in this project and capture its current path.
 * 2. If a parent is supplied, verify it's in the same project.
 * 3. Rewrite every descendant's path with a single UPDATE that concatenates
 *    the new prefix to each row's existing suffix.
 * 4. Update the scalar `parent_id` to match the ltree-reported parent.
 */
export async function moveFolder(opts: {
  projectId: string;
  folderId: string;
  newParentId: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [folder] = await tx
      .select({
        id: folders.id,
        path: folders.path,
        projectId: folders.projectId,
      })
      .from(folders)
      .where(
        and(
          eq(folders.id, opts.folderId),
          eq(folders.projectId, opts.projectId),
        ),
      );
    if (!folder) throw new Error("folder not found in this project");

    const oldPath = folder.path;

    let newPrefix: string;
    if (opts.newParentId) {
      const [parent] = await tx
        .select({ id: folders.id, path: folders.path })
        .from(folders)
        .where(
          and(
            eq(folders.id, opts.newParentId),
            eq(folders.projectId, opts.projectId),
          ),
        );
      if (!parent) throw new Error("cross-project parent or not found");
      newPrefix = `${parent.path}.${labelFromId(opts.folderId)}`;
    } else {
      newPrefix = labelFromId(opts.folderId);
    }

    // CASE handles the subtree root (path == oldPath) separately because
    // ltree's subpath(p, nlevel(p)) is out-of-bounds and raises "invalid
    // positions". For descendants, subpath(path, nlevel(oldPath)) yields
    // the suffix beneath oldPath that we preserve verbatim.
    await tx.execute(sql`
      UPDATE folders
         SET path = CASE
           WHEN path = ${oldPath}::ltree THEN ${newPrefix}::ltree
           ELSE ${newPrefix}::ltree
                || subpath(path, nlevel(${oldPath}::ltree))
         END
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
 * Move a note to a different folder within the same project. A null
 * `newFolderId` moves the note to the project root. Cross-project targets
 * are refused. No path math is involved.
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
        .where(
          and(
            eq(folders.id, opts.newFolderId),
            eq(folders.projectId, opts.projectId),
          ),
        );
      if (!parent) throw new Error("cross-project folder or not found");
    }

    await tx
      .update(notes)
      .set({ folderId: opts.newFolderId })
      .where(eq(notes.id, opts.noteId));
  });
}

function stripSortFields(raw: RawRow): TreeRow {
  return {
    kind: raw.kind,
    id: raw.id,
    parentId: raw.parentId,
    label: raw.label,
    pathText: raw.pathText,
    childCount: raw.childCount,
    fileKind: raw.fileKind,
    mimeType: raw.mimeType,
  };
}
