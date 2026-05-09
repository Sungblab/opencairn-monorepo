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

export async function ensureProjectTreeBackfill(projectId: string, conn: Conn = db): Promise<void> {
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
    WITH child_counts AS (
      SELECT parent_id, COUNT(*)::int AS child_count
      FROM project_tree_nodes
      WHERE project_id = ${input.projectId}::uuid
        AND parent_id IS NOT NULL
        AND deleted_at IS NULL
      GROUP BY parent_id
    )
    SELECT
      n.kind::text AS "kind",
      n.id AS "id",
      n.parent_id AS "parentId",
      n.label AS "label",
      n.path::text AS "pathText",
      COALESCE(cc.child_count, 0) AS "childCount",
      n.target_table::text AS "targetTable",
      n.target_id AS "targetId",
      n.icon AS "icon",
      n.metadata AS "metadata",
      CASE WHEN n.target_table = 'agent_files' THEN af.kind ELSE NULL END AS "fileKind",
      CASE WHEN n.target_table = 'agent_files' THEN af.mime_type ELSE NULL END AS "mimeType"
    FROM project_tree_nodes n
    LEFT JOIN agent_files af ON n.target_table = 'agent_files' AND af.id = n.target_id
    LEFT JOIN child_counts cc ON cc.parent_id = n.id
    WHERE n.project_id = ${input.projectId}::uuid
      AND ${parentPredicate}
      AND n.deleted_at IS NULL
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
  const quoted = sql.join(input.parentIds.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await db.execute<RawProjectTreeRow>(sql`
    WITH child_counts AS (
      SELECT parent_id, COUNT(*)::int AS child_count
      FROM project_tree_nodes
      WHERE project_id = ${input.projectId}::uuid
        AND parent_id IS NOT NULL
        AND deleted_at IS NULL
      GROUP BY parent_id
    )
    SELECT
      n.kind::text AS "kind",
      n.id AS "id",
      n.parent_id AS "parentId",
      n.label AS "label",
      n.path::text AS "pathText",
      COALESCE(cc.child_count, 0) AS "childCount",
      n.target_table::text AS "targetTable",
      n.target_id AS "targetId",
      n.icon AS "icon",
      n.metadata AS "metadata",
      CASE WHEN n.target_table = 'agent_files' THEN af.kind ELSE NULL END AS "fileKind",
      CASE WHEN n.target_table = 'agent_files' THEN af.mime_type ELSE NULL END AS "mimeType"
    FROM project_tree_nodes n
    LEFT JOIN agent_files af ON n.target_table = 'agent_files' AND af.id = n.target_id
    LEFT JOIN child_counts cc ON cc.parent_id = n.id
    WHERE n.project_id = ${input.projectId}::uuid
      AND n.parent_id IN (${quoted})
      AND n.deleted_at IS NULL
    ORDER BY n.position ASC, n.created_at ASC
  `);
  for (const row of asRows<RawProjectTreeRow>(result)) {
    if (!row.parentId) continue;
    grouped.get(row.parentId)?.push({ ...row, metadata: row.metadata ?? {} });
  }
  return grouped;
}

export async function createTreeNode(input: {
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
}, conn: Conn = db) {
  const id = input.id ?? randomUUID();
  let parentPath: string | null = null;
  if (input.parentId) {
    const [parent] = await conn
      .select({ path: projectTreeNodes.path, projectId: projectTreeNodes.projectId })
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

    if (current.targetTable === "folders" && current.targetId) {
      await tx
        .update(folders)
        .set({ name: input.label })
        .where(eq(folders.id, current.targetId));
    } else if (current.targetTable === "notes" && current.targetId) {
      await tx
        .update(notes)
        .set({ title: input.label })
        .where(eq(notes.id, current.targetId));
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

    return updated;
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
    const bundle = await createTreeNode(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        parentId: null,
        kind: "source_bundle",
        label: input.fileName,
        icon: input.mimeType === "application/pdf" ? "file-pdf" : "file",
        sourceWorkflowId: input.workflowId,
        sourceObjectKey: input.objectKey,
        metadata: {
          sourceType: input.mimeType === "application/pdf" ? "pdf" : "upload",
          mimeType: input.mimeType,
          objectKey: input.objectKey,
          fileName: input.fileName,
          status: "running",
          workflowId: input.workflowId,
        },
      },
      tx,
    );

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

    const original = await createTreeNode(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        parentId: bundle.id,
        kind: "agent_file",
        id: file.id,
        targetTable: "agent_files",
        targetId: file.id,
        label: input.fileName,
        icon: input.mimeType === "application/pdf" ? "file-pdf" : "file",
        sourceWorkflowId: input.workflowId,
        sourceObjectKey: input.objectKey,
        metadata: {
          role: "original",
          fileKind: file.kind,
          mimeType: file.mimeType,
          filename: file.filename,
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
      originalFileNodeId: original.id,
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
    parent: { targetTable: ProjectTreeTargetTable | null; targetId: string | null } | null;
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
