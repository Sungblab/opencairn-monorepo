import { createHash, randomUUID } from "node:crypto";
import {
  and,
  agentFiles,
  codeWorkspaces,
  db,
  eq,
  folders,
  notes,
  projectTreeNodes,
  projects,
  sql,
  type DB,
  type Tx,
} from "@opencairn/db";
import { labelFromId } from "./tree-queries";

export type ProjectTreeNodeKind =
  | "folder"
  | "note"
  | "agent_file"
  | "code_workspace"
  | "source_bundle"
  | "artifact_group"
  | "artifact";

export type ProjectTreeTargetTable =
  | "folders"
  | "notes"
  | "agent_files"
  | "code_workspaces";

export interface ProjectTreeRow {
  kind: ProjectTreeNodeKind;
  id: string;
  parentId: string | null;
  label: string;
  pathText: string;
  childCount: number;
  targetTable: ProjectTreeTargetTable | null;
  targetId: string | null;
  icon: string | null;
  metadata: Record<string, unknown>;
  fileKind: string | null;
  mimeType: string | null;
}

type Conn = DB | Tx;

type RawProjectTreeRow = {
  kind: ProjectTreeNodeKind;
  id: string;
  parentId: string | null;
  label: string;
  pathText: string;
  childCount: number;
  targetTable: ProjectTreeTargetTable | null;
  targetId: string | null;
  icon: string | null;
  metadata: Record<string, unknown>;
  fileKind: string | null;
  mimeType: string | null;
} & Record<string, unknown>;

function asRows<T>(result: unknown): T[] {
  const maybe = result as { rows?: T[] } | T[];
  if (Array.isArray(maybe)) return maybe;
  return maybe.rows ?? [];
}

export async function ensureProjectTreeBackfill(
  projectId: string,
  conn: Conn = db,
): Promise<void> {
  await conn.execute(sql`
    INSERT INTO project_tree_nodes (
      id, workspace_id, project_id, parent_id, kind, target_table, target_id,
      label, icon, position, path, metadata, created_at, updated_at, deleted_at
    )
    SELECT
      f.id,
      p.workspace_id,
      f.project_id,
      f.parent_id,
      'folder',
      'folders',
      f.id,
      f.name,
      'folder',
      f.position,
      f.path,
      '{}'::jsonb,
      f.created_at,
      f.updated_at,
      NULL
    FROM folders f
    JOIN projects p ON p.id = f.project_id
    WHERE f.project_id = ${projectId}::uuid
    ON CONFLICT DO NOTHING
  `);

  await conn.execute(sql`
    INSERT INTO project_tree_nodes (
      id, workspace_id, project_id, parent_id, kind, target_table, target_id,
      label, icon, position, path, metadata, created_at, updated_at, deleted_at
    )
    SELECT
      n.id,
      n.workspace_id,
      n.project_id,
      n.folder_id,
      'note',
      'notes',
      n.id,
      n.title,
      'file-text',
      0,
      CASE
        WHEN n.folder_id IS NULL THEN replace(n.id::text, '-', '_')::ltree
        ELSE parent.path || replace(n.id::text, '-', '_')::ltree
      END,
      jsonb_build_object('sourceType', n.source_type, 'noteType', n.type),
      n.created_at,
      n.updated_at,
      n.deleted_at
    FROM notes n
    LEFT JOIN folders parent ON parent.id = n.folder_id
    WHERE n.project_id = ${projectId}::uuid
      AND n.deleted_at IS NULL
    ON CONFLICT DO NOTHING
  `);

  await conn.execute(sql`
    INSERT INTO project_tree_nodes (
      id, workspace_id, project_id, parent_id, kind, target_table, target_id,
      label, icon, position, path, source_workflow_id, source_object_key,
      metadata, created_at, updated_at, deleted_at
    )
    SELECT
      af.id,
      af.workspace_id,
      af.project_id,
      af.folder_id,
      'agent_file',
      'agent_files',
      af.id,
      af.title,
      CASE
        WHEN af.mime_type = 'application/pdf' THEN 'file-pdf'
        WHEN af.kind = 'image' THEN 'image'
        ELSE 'file'
      END,
      0,
      CASE
        WHEN af.folder_id IS NULL THEN replace(af.id::text, '-', '_')::ltree
        ELSE parent.path || replace(af.id::text, '-', '_')::ltree
      END,
      af.ingest_workflow_id,
      af.object_key,
      jsonb_build_object('fileKind', af.kind, 'mimeType', af.mime_type, 'filename', af.filename),
      af.created_at,
      af.updated_at,
      af.deleted_at
    FROM agent_files af
    LEFT JOIN folders parent ON parent.id = af.folder_id
    WHERE af.project_id = ${projectId}::uuid
      AND af.deleted_at IS NULL
    ON CONFLICT DO NOTHING
  `);

  await conn.execute(sql`
    INSERT INTO project_tree_nodes (
      id, workspace_id, project_id, parent_id, kind, target_table, target_id,
      label, icon, position, path, metadata, created_at, updated_at, deleted_at
    )
    SELECT
      cw.id,
      cw.workspace_id,
      cw.project_id,
      NULL,
      'code_workspace',
      'code_workspaces',
      cw.id,
      cw.name,
      'code',
      0,
      replace(cw.id::text, '-', '_')::ltree,
      jsonb_build_object('language', cw.language, 'framework', cw.framework),
      cw.created_at,
      cw.updated_at,
      cw.deleted_at
    FROM code_workspaces cw
    WHERE cw.project_id = ${projectId}::uuid
      AND cw.deleted_at IS NULL
    ON CONFLICT DO NOTHING
  `);

  await conn.execute(sql`
    WITH misplaced AS (
      SELECT
        source_note.id AS source_note_id,
        analysis.id AS analysis_group_id,
        analysis.path AS analysis_group_path
      FROM project_tree_nodes source_note
      JOIN project_tree_nodes parsed
        ON parsed.id = source_note.parent_id
       AND parsed.kind = 'artifact_group'
       AND parsed.metadata->>'role' = 'parsed'
       AND parsed.deleted_at IS NULL
      JOIN project_tree_nodes analysis
        ON analysis.parent_id = parsed.parent_id
       AND analysis.kind = 'artifact_group'
       AND analysis.metadata->>'role' = 'analysis'
       AND analysis.deleted_at IS NULL
      WHERE source_note.project_id = ${projectId}::uuid
        AND source_note.deleted_at IS NULL
        AND source_note.metadata->>'role' = 'source_note'
    )
    UPDATE project_tree_nodes node
       SET parent_id = misplaced.analysis_group_id,
           path = misplaced.analysis_group_path || replace(node.id::text, '-', '_')::ltree,
           label = CASE
             WHEN node.label IN ('full_extract_note', '전체 추출 노트', '생성된 노트') THEN 'generated_note'
             ELSE node.label
           END,
           updated_at = now()
      FROM misplaced
     WHERE node.id = misplaced.source_note_id
  `);
}

export async function listTreeChildren(input: {
  projectId: string;
  parentId: string | null;
}): Promise<ProjectTreeRow[]> {
  await ensureProjectTreeBackfill(input.projectId);
  const parentPredicate = input.parentId
    ? sql`n.parent_id = ${input.parentId}::uuid`
    : sql`n.parent_id IS NULL`;
  const result = await db.execute<RawProjectTreeRow>(sql`
    WITH visible_nodes AS (
      SELECT n.*
      FROM project_tree_nodes n
      WHERE n.project_id = ${input.projectId}::uuid
        AND n.deleted_at IS NULL
        AND NOT (n.kind = 'agent_file' AND n.metadata->>'role' = 'original')
        AND n.kind <> 'artifact_group'
        AND n.kind <> 'artifact'
        AND NOT (n.kind = 'note' AND n.metadata->>'role' = 'source_note')
    ),
    child_counts AS (
      SELECT parent_id, COUNT(*)::int AS child_count
      FROM visible_nodes
      WHERE parent_id IS NOT NULL
      GROUP BY parent_id
    )
    SELECT
      n.kind::text AS "kind",
      n.id AS "id",
      n.parent_id AS "parentId",
      COALESCE(
        CASE
          WHEN n.kind = 'note' AND n.metadata->>'role' = 'source_note' THEN NULLIF(n.label, '')
          ELSE NULL
        END,
        NULLIF(nt.title, ''),
        NULLIF(f.name, ''),
        NULLIF(af.title, ''),
        NULLIF(cw.name, ''),
        n.label
      ) AS "label",
      n.path::text AS "pathText",
      COALESCE(cc.child_count, 0) AS "childCount",
      CASE
        WHEN n.kind = 'source_bundle' AND original_af.id IS NOT NULL THEN 'agent_files'
        ELSE n.target_table::text
      END AS "targetTable",
      CASE
        WHEN n.kind = 'source_bundle' AND original_af.id IS NOT NULL THEN original_af.id
        ELSE n.target_id
      END AS "targetId",
      n.icon AS "icon",
      n.metadata AS "metadata",
      CASE
        WHEN n.target_table = 'agent_files' THEN af.kind
        WHEN n.kind = 'source_bundle' THEN original_af.kind
        ELSE NULL
      END AS "fileKind",
      CASE
        WHEN n.target_table = 'agent_files' THEN af.mime_type
        WHEN n.kind = 'source_bundle' THEN original_af.mime_type
        ELSE NULL
      END AS "mimeType"
    FROM visible_nodes n
    LEFT JOIN notes nt ON n.target_table = 'notes' AND nt.id = n.target_id
    LEFT JOIN folders f ON n.target_table = 'folders' AND f.id = n.target_id
    LEFT JOIN agent_files af ON n.target_table = 'agent_files' AND af.id = n.target_id
    LEFT JOIN code_workspaces cw ON n.target_table = 'code_workspaces' AND cw.id = n.target_id
    LEFT JOIN project_tree_nodes original_node
      ON n.kind = 'source_bundle'
     AND original_node.parent_id = n.id
     AND original_node.kind = 'agent_file'
     AND original_node.metadata->>'role' = 'original'
     AND original_node.deleted_at IS NULL
    LEFT JOIN agent_files original_af
      ON original_node.target_table = 'agent_files'
     AND original_af.id = original_node.target_id
     AND original_af.deleted_at IS NULL
    LEFT JOIN child_counts cc ON cc.parent_id = n.id
    WHERE ${parentPredicate}
    ORDER BY n.position ASC, n.created_at ASC
  `);

  return asRows<RawProjectTreeRow>(result).map((row) => ({
    ...row,
    metadata: row.metadata ?? {},
  }));
}

export async function listTreeChildrenForParents(input: {
  projectId: string;
  parentIds: string[];
}): Promise<Map<string, ProjectTreeRow[]>> {
  const grouped = new Map<string, ProjectTreeRow[]>();
  for (const parentId of input.parentIds) {
    grouped.set(parentId, []);
  }
  if (input.parentIds.length === 0) return grouped;
  const quoted = sql.join(
    input.parentIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await db.execute<RawProjectTreeRow>(sql`
    WITH visible_nodes AS (
      SELECT n.*
      FROM project_tree_nodes n
      WHERE n.project_id = ${input.projectId}::uuid
        AND n.deleted_at IS NULL
        AND NOT (n.kind = 'agent_file' AND n.metadata->>'role' = 'original')
        AND n.kind <> 'artifact_group'
        AND n.kind <> 'artifact'
        AND NOT (n.kind = 'note' AND n.metadata->>'role' = 'source_note')
    ),
    child_counts AS (
      SELECT parent_id, COUNT(*)::int AS child_count
      FROM visible_nodes
      WHERE parent_id IS NOT NULL
      GROUP BY parent_id
    )
    SELECT
      n.kind::text AS "kind",
      n.id AS "id",
      n.parent_id AS "parentId",
      COALESCE(
        CASE
          WHEN n.kind = 'note' AND n.metadata->>'role' = 'source_note' THEN NULLIF(n.label, '')
          ELSE NULL
        END,
        NULLIF(nt.title, ''),
        NULLIF(f.name, ''),
        NULLIF(af.title, ''),
        NULLIF(cw.name, ''),
        n.label
      ) AS "label",
      n.path::text AS "pathText",
      COALESCE(cc.child_count, 0) AS "childCount",
      CASE
        WHEN n.kind = 'source_bundle' AND original_af.id IS NOT NULL THEN 'agent_files'
        ELSE n.target_table::text
      END AS "targetTable",
      CASE
        WHEN n.kind = 'source_bundle' AND original_af.id IS NOT NULL THEN original_af.id
        ELSE n.target_id
      END AS "targetId",
      n.icon AS "icon",
      n.metadata AS "metadata",
      CASE
        WHEN n.target_table = 'agent_files' THEN af.kind
        WHEN n.kind = 'source_bundle' THEN original_af.kind
        ELSE NULL
      END AS "fileKind",
      CASE
        WHEN n.target_table = 'agent_files' THEN af.mime_type
        WHEN n.kind = 'source_bundle' THEN original_af.mime_type
        ELSE NULL
      END AS "mimeType"
    FROM visible_nodes n
    LEFT JOIN notes nt ON n.target_table = 'notes' AND nt.id = n.target_id
    LEFT JOIN folders f ON n.target_table = 'folders' AND f.id = n.target_id
    LEFT JOIN agent_files af ON n.target_table = 'agent_files' AND af.id = n.target_id
    LEFT JOIN code_workspaces cw ON n.target_table = 'code_workspaces' AND cw.id = n.target_id
    LEFT JOIN project_tree_nodes original_node
      ON n.kind = 'source_bundle'
     AND original_node.parent_id = n.id
     AND original_node.kind = 'agent_file'
     AND original_node.metadata->>'role' = 'original'
     AND original_node.deleted_at IS NULL
    LEFT JOIN agent_files original_af
      ON original_node.target_table = 'agent_files'
     AND original_af.id = original_node.target_id
     AND original_af.deleted_at IS NULL
    LEFT JOIN child_counts cc ON cc.parent_id = n.id
    WHERE n.parent_id IN (${quoted})
    ORDER BY n.position ASC, n.created_at ASC
  `);
  for (const row of asRows<RawProjectTreeRow>(result)) {
    if (!row.parentId) continue;
    grouped.get(row.parentId)?.push({ ...row, metadata: row.metadata ?? {} });
  }
  return grouped;
}

export async function createTreeNode(
  input: {
    id?: string;
    workspaceId: string;
    projectId: string;
    parentId: string | null;
    kind: ProjectTreeNodeKind;
    targetTable?: ProjectTreeTargetTable | null;
    targetId?: string | null;
    label: string;
    icon?: string | null;
    position?: number;
    sourceWorkflowId?: string | null;
    sourceObjectKey?: string | null;
    metadata?: Record<string, unknown>;
  },
  conn: Conn = db,
) {
  const id = input.id ?? randomUUID();
  let parentPath: string | null = null;
  if (input.parentId) {
    const [parent] = await conn
      .select({
        path: projectTreeNodes.path,
        projectId: projectTreeNodes.projectId,
      })
      .from(projectTreeNodes)
      .where(eq(projectTreeNodes.id, input.parentId));
    if (!parent || parent.projectId !== input.projectId) {
      throw new Error("parent node not found in this project");
    }
    parentPath = parent.path;
  }

  const [row] = await conn
    .insert(projectTreeNodes)
    .values({
      id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      parentId: input.parentId,
      kind: input.kind,
      targetTable: input.targetTable ?? null,
      targetId: input.targetId ?? null,
      label: input.label,
      icon: input.icon ?? null,
      position: input.position ?? 0,
      path: parentPath ? `${parentPath}.${labelFromId(id)}` : labelFromId(id),
      sourceWorkflowId: input.sourceWorkflowId ?? null,
      sourceObjectKey: input.sourceObjectKey ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  return row;
}

export async function moveTreeNode(input: {
  projectId: string;
  nodeId: string;
  newParentId: string | null;
  position: number;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projectTreeNodes)
      .where(
        and(
          eq(projectTreeNodes.id, input.nodeId),
          eq(projectTreeNodes.projectId, input.projectId),
        ),
      );
    if (!current || current.deletedAt) throw new Error("tree node not found");

    let newParent: typeof current | null = null;
    if (input.newParentId) {
      [newParent] = await tx
        .select()
        .from(projectTreeNodes)
        .where(
          and(
            eq(projectTreeNodes.id, input.newParentId),
            eq(projectTreeNodes.projectId, input.projectId),
          ),
        );
      if (!newParent || newParent.deletedAt) {
        throw new Error("parent node not found in this project");
      }
      if (
        newParent.path === current.path ||
        newParent.path.startsWith(`${current.path}.`)
      ) {
        throw new Error("cannot move a node into itself or a descendant");
      }
    }

    const newPrefix = newParent
      ? `${newParent.path}.${labelFromId(current.id)}`
      : labelFromId(current.id);

    await tx.execute(sql`
      UPDATE project_tree_nodes
         SET path = CASE
           WHEN path = ${current.path}::ltree THEN ${newPrefix}::ltree
           ELSE ${newPrefix}::ltree || subpath(path, nlevel(${current.path}::ltree))
         END
       WHERE path <@ ${current.path}::ltree
         AND project_id = ${input.projectId}::uuid
    `);

    await tx
      .update(projectTreeNodes)
      .set({ parentId: input.newParentId, position: input.position })
      .where(eq(projectTreeNodes.id, input.nodeId));

    await mirrorLegacyParent(tx, {
      targetTable: current.targetTable,
      targetId: current.targetId,
      parent: newParent,
    });

    const [updated] = await tx
      .select()
      .from(projectTreeNodes)
      .where(eq(projectTreeNodes.id, input.nodeId));
    return updated;
  });
}

export async function renameTreeNode(input: {
  projectId: string;
  nodeId: string;
  label: string;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projectTreeNodes)
      .where(
        and(
          eq(projectTreeNodes.id, input.nodeId),
          eq(projectTreeNodes.projectId, input.projectId),
        ),
      );
    if (!current || current.deletedAt) throw new Error("tree node not found");

    const [updated] = await tx
      .update(projectTreeNodes)
      .set({ label: input.label })
      .where(eq(projectTreeNodes.id, input.nodeId))
      .returning();

    let noteForRefresh: {
      id: string;
      workspaceId: string;
      projectId: string;
      title: string;
      contentText: string | null;
      deletedAt: Date | null;
    } | null = null;

    if (current.targetTable === "folders" && current.targetId) {
      await tx
        .update(folders)
        .set({ name: input.label })
        .where(eq(folders.id, current.targetId));
    } else if (current.targetTable === "notes" && current.targetId) {
      const [renamedNote] = await tx
        .update(notes)
        .set({ title: input.label })
        .where(eq(notes.id, current.targetId))
        .returning({
          id: notes.id,
          workspaceId: notes.workspaceId,
          projectId: notes.projectId,
          title: notes.title,
          contentText: notes.contentText,
          deletedAt: notes.deletedAt,
        });
      if (current.label !== input.label) {
        noteForRefresh = renamedNote ?? null;
      }
    } else if (current.targetTable === "agent_files" && current.targetId) {
      await tx
        .update(agentFiles)
        .set({ title: input.label })
        .where(eq(agentFiles.id, current.targetId));
    } else if (current.targetTable === "code_workspaces" && current.targetId) {
      await tx
        .update(codeWorkspaces)
        .set({ name: input.label })
        .where(eq(codeWorkspaces.id, current.targetId));
    }

    return { node: updated, noteForRefresh };
  });
}

export async function softDeleteTreeNode(input: {
  projectId: string;
  nodeId: string;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projectTreeNodes)
      .where(
        and(
          eq(projectTreeNodes.id, input.nodeId),
          eq(projectTreeNodes.projectId, input.projectId),
        ),
      );
    if (!current || current.deletedAt) throw new Error("tree node not found");

    const descendants = asRows<{
      id: string;
      targetTable: ProjectTreeTargetTable | null;
      targetId: string | null;
    }>(
      await tx.execute(sql`
        SELECT id, target_table::text AS "targetTable", target_id AS "targetId"
          FROM project_tree_nodes
         WHERE project_id = ${input.projectId}::uuid
           AND path <@ ${current.path}::ltree
           AND deleted_at IS NULL
      `),
    );
    const deletedAt = new Date();
    const deletedAtSql = deletedAt.toISOString();

    await tx.execute(sql`
      UPDATE project_tree_nodes
         SET deleted_at = ${deletedAtSql}::timestamptz
       WHERE project_id = ${input.projectId}::uuid
         AND path <@ ${current.path}::ltree
         AND deleted_at IS NULL
    `);

    const targetIds = (targetTable: ProjectTreeTargetTable) =>
      descendants
        .filter((node) => node.targetTable === targetTable && node.targetId)
        .map((node) => node.targetId!);

    const noteIds = targetIds("notes");
    if (noteIds.length > 0) {
      await tx
        .update(notes)
        .set({ deletedAt })
        .where(
          sql`${notes.id} IN (${sql.join(
            noteIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
    }

    const agentFileIds = targetIds("agent_files");
    if (agentFileIds.length > 0) {
      await tx
        .update(agentFiles)
        .set({ deletedAt })
        .where(
          sql`${agentFiles.id} IN (${sql.join(
            agentFileIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
    }

    const codeWorkspaceIds = targetIds("code_workspaces");
    if (codeWorkspaceIds.length > 0) {
      await tx
        .update(codeWorkspaces)
        .set({ deletedAt })
        .where(
          sql`${codeWorkspaces.id} IN (${sql.join(
            codeWorkspaceIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
    }

    return current;
  });
}

export async function createSourceBundleForUpload(input: {
  workspaceId: string;
  projectId: string;
  userId: string;
  workflowId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  return db.transaction(async (tx) => {
    const extension = input.fileName.includes(".")
      ? input.fileName.split(".").pop() || "bin"
      : "bin";
    const originalFileId = randomUUID();
    const contentHash = createHash("sha256").update(input.bytes).digest("hex");
    const [file] = await tx
      .insert(agentFiles)
      .values({
        id: originalFileId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        folderId: null,
        createdBy: input.userId,
        title: input.fileName,
        filename: input.fileName,
        extension,
        kind: input.mimeType === "application/pdf" ? "pdf" : "binary",
        mimeType: input.mimeType,
        objectKey: input.objectKey,
        bytes: input.bytes.length,
        contentHash,
        source: "manual",
        versionGroupId: randomUUID(),
        version: 1,
        ingestWorkflowId: input.workflowId,
        ingestStatus: "queued",
      })
      .returning();
    if (!file) throw new Error("failed to create original upload file");

    const bundle = await createTreeNode(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        parentId: null,
        kind: "source_bundle",
        targetTable: "agent_files",
        targetId: file.id,
        label: input.fileName,
        icon: input.mimeType === "application/pdf" ? "file-pdf" : "file",
        sourceWorkflowId: input.workflowId,
        sourceObjectKey: input.objectKey,
        metadata: {
          sourceType: input.mimeType === "application/pdf" ? "pdf" : "upload",
          objectKey: input.objectKey,
          fileName: input.fileName,
          status: "running",
          workflowId: input.workflowId,
          originalFileId: file.id,
          fileKind: file.kind,
          mimeType: file.mimeType,
        },
      },
      tx,
    );

    const parsed = await createTreeNode(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        parentId: bundle.id,
        kind: "artifact_group",
        label: "추출 결과",
        icon: "folder",
        sourceWorkflowId: input.workflowId,
        metadata: { role: "parsed" },
        position: 10,
      },
      tx,
    );
    const figures = await createTreeNode(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        parentId: bundle.id,
        kind: "artifact_group",
        label: "이미지/도표",
        icon: "image",
        sourceWorkflowId: input.workflowId,
        metadata: { role: "figures" },
        position: 20,
      },
      tx,
    );
    const analysis = await createTreeNode(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        parentId: bundle.id,
        kind: "artifact_group",
        label: "분석 결과",
        icon: "sparkles",
        sourceWorkflowId: input.workflowId,
        metadata: { role: "analysis" },
        position: 30,
      },
      tx,
    );

    return {
      bundleNodeId: bundle.id,
      originalFileNodeId: file.id,
      originalFileId: file.id,
      parsedGroupNodeId: parsed.id,
      figuresGroupNodeId: figures.id,
      analysisGroupNodeId: analysis.id,
    };
  });
}

async function mirrorLegacyParent(
  tx: Tx,
  input: {
    targetTable: ProjectTreeTargetTable | null;
    targetId: string | null;
    parent: {
      targetTable: ProjectTreeTargetTable | null;
      targetId: string | null;
    } | null;
  },
): Promise<void> {
  if (!input.targetTable || !input.targetId) return;
  const legacyFolderId =
    input.parent?.targetTable === "folders" ? input.parent.targetId : null;

  if (input.targetTable === "folders") {
    await tx
      .update(folders)
      .set({ parentId: legacyFolderId })
      .where(eq(folders.id, input.targetId));
  } else if (input.targetTable === "notes") {
    await tx
      .update(notes)
      .set({ folderId: legacyFolderId })
      .where(eq(notes.id, input.targetId));
  } else if (input.targetTable === "agent_files") {
    await tx
      .update(agentFiles)
      .set({ folderId: legacyFolderId })
      .where(eq(agentFiles.id, input.targetId));
  }
}

export async function resolveProjectForNode(nodeId: string) {
  const [row] = await db
    .select({
      projectId: projectTreeNodes.projectId,
      workspaceId: projectTreeNodes.workspaceId,
      label: projectTreeNodes.label,
      parentId: projectTreeNodes.parentId,
    })
    .from(projectTreeNodes)
    .where(eq(projectTreeNodes.id, nodeId));
  return row ?? null;
}

export async function projectWorkspaceId(projectId: string): Promise<string> {
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new Error("project not found");
  return project.workspaceId;
}
