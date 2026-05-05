import { randomUUID } from "node:crypto";
import {
  and,
  codeWorkspaceFileEntries,
  codeWorkspacePatches,
  codeWorkspaceSnapshots,
  codeWorkspaces,
  db as defaultDb,
  desc,
  eq,
  isNull,
  type DB,
} from "@opencairn/db";
import {
  codeWorkspaceCreateRequestSchema,
  codeWorkspaceManifestSchema,
  codeWorkspacePatchSchema,
  type CodeWorkspaceEntryKind,
  type CodeWorkspaceCreateRequest,
  type CodeWorkspaceManifest,
  type CodeWorkspacePatch,
} from "@opencairn/shared";
import { AgentActionError } from "./agent-actions";

export interface CodeWorkspaceScope {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
}

export interface CodeWorkspaceRecord {
  id: string;
  requestId: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  name: string;
  description: string | null;
  language: string | null;
  framework: string | null;
  currentSnapshotId: string;
  sourceRunId: string | null;
  sourceActionId: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface CodeWorkspaceSnapshotRecord {
  id: string;
  codeWorkspaceId: string;
  parentSnapshotId: string | null;
  treeHash: string;
  manifest: CodeWorkspaceManifest;
}

export interface CodeWorkspacePatchRecord {
  id: string;
  requestId: string;
  codeWorkspaceId: string;
  baseSnapshotId: string;
  status: "approval_required" | "applied" | "rejected";
  patch: CodeWorkspacePatch;
}

export interface CodeWorkspaceRepository {
  listWorkspaces(scope: Pick<CodeWorkspaceScope, "workspaceId" | "projectId">): Promise<CodeWorkspaceRecord[]>;
  findWorkspaceByRequestId(scope: CodeWorkspaceScope, requestId: string): Promise<{
    workspace: CodeWorkspaceRecord;
    snapshot: CodeWorkspaceSnapshotRecord;
  } | null>;
  findWorkspaceByIdAny(id: string): Promise<CodeWorkspaceRecord | null>;
  findWorkspaceById(scope: CodeWorkspaceScope, id: string): Promise<CodeWorkspaceRecord | null>;
  findSnapshotById(workspaceId: string, snapshotId: string): Promise<CodeWorkspaceSnapshotRecord | null>;
  findPatchByRequestId(scope: CodeWorkspaceScope, requestId: string): Promise<CodeWorkspacePatchRecord | null>;
  createWorkspaceDraft(input: {
    scope: CodeWorkspaceScope;
    requestId: string;
    request: CodeWorkspaceCreateRequest;
    snapshotId: string;
    treeHash: string;
  }): Promise<{ workspace: CodeWorkspaceRecord; snapshot: CodeWorkspaceSnapshotRecord }>;
  createPatch(input: {
    scope: CodeWorkspaceScope;
    requestId: string;
    workspace: CodeWorkspaceRecord;
    patch: CodeWorkspacePatch;
  }): Promise<CodeWorkspacePatchRecord>;
  renameWorkspace(input: {
    scope: Pick<CodeWorkspaceScope, "workspaceId" | "projectId">;
    id: string;
    name: string;
    description?: string | null;
  }): Promise<CodeWorkspaceRecord | null>;
  softDeleteWorkspace(input: {
    scope: Pick<CodeWorkspaceScope, "workspaceId" | "projectId">;
    id: string;
  }): Promise<CodeWorkspaceRecord | null>;
}

export function createDrizzleCodeWorkspaceRepository(conn: DB = defaultDb): CodeWorkspaceRepository {
  return {
    async listWorkspaces(scope) {
      const rows = await conn
        .select()
        .from(codeWorkspaces)
        .where(
          and(
            eq(codeWorkspaces.workspaceId, scope.workspaceId),
            eq(codeWorkspaces.projectId, scope.projectId),
            isNull(codeWorkspaces.deletedAt),
          ),
        )
        .orderBy(desc(codeWorkspaces.updatedAt));
      return rows
        .filter((row) => row.currentSnapshotId)
        .map(toWorkspaceRecord);
    },
    async findWorkspaceByRequestId(scope, requestId) {
      const [workspace] = await conn
        .select()
        .from(codeWorkspaces)
        .where(
          and(
            eq(codeWorkspaces.workspaceId, scope.workspaceId),
            eq(codeWorkspaces.projectId, scope.projectId),
            eq(codeWorkspaces.createdBy, scope.actorUserId),
            eq(codeWorkspaces.requestId, requestId),
            isNull(codeWorkspaces.deletedAt),
          ),
        )
        .limit(1);
      if (!workspace?.currentSnapshotId) return null;
      const snapshot = await this.findSnapshotById(workspace.id, workspace.currentSnapshotId);
      if (!snapshot) return null;
      return { workspace: toWorkspaceRecord(workspace), snapshot };
    },
    async findWorkspaceByIdAny(id) {
      const [workspace] = await conn
        .select()
        .from(codeWorkspaces)
        .where(and(eq(codeWorkspaces.id, id), isNull(codeWorkspaces.deletedAt)))
        .limit(1);
      return workspace?.currentSnapshotId ? toWorkspaceRecord(workspace) : null;
    },
    async findWorkspaceById(scope, id) {
      const workspace = await this.findWorkspaceByIdAny(id);
      if (!workspace) return null;
      if (workspace.workspaceId !== scope.workspaceId || workspace.projectId !== scope.projectId) {
        return null;
      }
      return workspace;
    },
    async findSnapshotById(workspaceId, snapshotId) {
      const [snapshot] = await conn
        .select()
        .from(codeWorkspaceSnapshots)
        .where(
          and(
            eq(codeWorkspaceSnapshots.id, snapshotId),
            eq(codeWorkspaceSnapshots.codeWorkspaceId, workspaceId),
          ),
        )
        .limit(1);
      return snapshot ? toSnapshotRecord(snapshot) : null;
    },
    async findPatchByRequestId(scope, requestId) {
      const [patch] = await conn
        .select()
        .from(codeWorkspacePatches)
        .where(
          and(
            eq(codeWorkspacePatches.workspaceId, scope.workspaceId),
            eq(codeWorkspacePatches.projectId, scope.projectId),
            eq(codeWorkspacePatches.createdBy, scope.actorUserId),
            eq(codeWorkspacePatches.requestId, requestId),
          ),
        )
        .limit(1);
      if (!patch) return null;
      return toPatchRecord(patch);
    },
    async createWorkspaceDraft({ scope, requestId, request, snapshotId, treeHash }) {
      return conn.transaction(async (tx) => {
        const [workspace] = await tx
          .insert(codeWorkspaces)
          .values({
            requestId,
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            createdBy: scope.actorUserId,
            name: request.name,
            description: request.description ?? null,
            language: request.language ?? null,
            framework: request.framework ?? null,
            sourceRunId: request.sourceRunId ?? null,
            sourceActionId: request.sourceActionId ?? null,
          })
          .returning();
        const [snapshot] = await tx
          .insert(codeWorkspaceSnapshots)
          .values({
            id: snapshotId,
            codeWorkspaceId: workspace.id,
            parentSnapshotId: null,
            treeHash,
            manifest: request.manifest,
            sourceActionId: request.sourceActionId ?? null,
          })
          .returning();
        if (request.manifest.entries.length > 0) {
          await tx.insert(codeWorkspaceFileEntries).values(
            request.manifest.entries.map((entry) => entryToInsert(snapshot.id, entry)),
          );
        }
        const [updated] = await tx
          .update(codeWorkspaces)
          .set({ currentSnapshotId: snapshot.id })
          .where(eq(codeWorkspaces.id, workspace.id))
          .returning();
        return {
          workspace: toWorkspaceRecord(updated),
          snapshot: toSnapshotRecord(snapshot),
        };
      });
    },
    async createPatch({ scope, requestId, workspace, patch }) {
      const [record] = await conn
        .insert(codeWorkspacePatches)
        .values({
          requestId,
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          createdBy: scope.actorUserId,
          codeWorkspaceId: workspace.id,
          baseSnapshotId: patch.baseSnapshotId,
          status: "approval_required",
          risk: patch.risk,
          operations: patch.operations,
          preview: patch.preview,
        })
        .returning();
      return toPatchRecord(record);
    },
    async renameWorkspace({ scope, id, name, description }) {
      const set: Partial<typeof codeWorkspaces.$inferInsert> = { name };
      if (description !== undefined) set.description = description;
      const [workspace] = await conn
        .update(codeWorkspaces)
        .set(set)
        .where(
          and(
            eq(codeWorkspaces.id, id),
            eq(codeWorkspaces.workspaceId, scope.workspaceId),
            eq(codeWorkspaces.projectId, scope.projectId),
            isNull(codeWorkspaces.deletedAt),
          ),
        )
        .returning();
      return workspace?.currentSnapshotId ? toWorkspaceRecord(workspace) : null;
    },
    async softDeleteWorkspace({ scope, id }) {
      const [workspace] = await conn
        .update(codeWorkspaces)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(codeWorkspaces.id, id),
            eq(codeWorkspaces.workspaceId, scope.workspaceId),
            eq(codeWorkspaces.projectId, scope.projectId),
            isNull(codeWorkspaces.deletedAt),
          ),
        )
        .returning();
      return workspace?.currentSnapshotId ? toWorkspaceRecord(workspace) : null;
    },
  };
}

export async function createCodeWorkspaceDraft(
  repo: CodeWorkspaceRepository,
  scope: CodeWorkspaceScope,
  input: unknown,
): Promise<{
  workspace: CodeWorkspaceRecord;
  snapshot: CodeWorkspaceSnapshotRecord;
  idempotent: boolean;
}> {
  const request = parseOrAgentActionError(codeWorkspaceCreateRequestSchema, input);
  const requestId = request.requestId ?? randomUUID();
  const existing = await repo.findWorkspaceByRequestId(scope, requestId);
  if (existing) return { ...existing, idempotent: true };

  const snapshotId = randomUUID();
  const created = await repo.createWorkspaceDraft({
    scope,
    requestId,
    request,
    snapshotId,
    treeHash: treeHashForManifest(request.manifest),
  });
  return { ...created, idempotent: false };
}

export async function prepareCodeWorkspacePatch(
  repo: CodeWorkspaceRepository,
  scope: CodeWorkspaceScope,
  input: unknown,
): Promise<{ patch: CodeWorkspacePatchRecord; idempotent: boolean }> {
  const request = parseOrAgentActionError(codeWorkspacePatchSchema, input);
  const requestId = request.requestId ?? randomUUID();
  const existing = await repo.findPatchByRequestId(scope, requestId);
  if (existing) return { patch: existing, idempotent: true };

  const workspace = await repo.findWorkspaceById(scope, request.codeWorkspaceId);
  if (!workspace) throw new AgentActionError("code_workspace_not_found", 404);
  if (workspace.currentSnapshotId !== request.baseSnapshotId) {
    throw new AgentActionError("code_workspace_stale_base", 409);
  }
  const patch = await repo.createPatch({
    scope,
    requestId,
    workspace,
    patch: request,
  });
  return { patch, idempotent: false };
}

export function createMemoryCodeWorkspaceRepository(): CodeWorkspaceRepository & {
  rows: {
    workspaces: Map<string, CodeWorkspaceRecord>;
    snapshots: Map<string, CodeWorkspaceSnapshotRecord>;
    patches: Map<string, CodeWorkspacePatchRecord>;
  };
} {
  const rows = {
    workspaces: new Map<string, CodeWorkspaceRecord>(),
    snapshots: new Map<string, CodeWorkspaceSnapshotRecord>(),
    patches: new Map<string, CodeWorkspacePatchRecord>(),
  };

  return {
    rows,
    async listWorkspaces(scope) {
      return [...rows.workspaces.values()].filter(
        (row) =>
          row.workspaceId === scope.workspaceId &&
          row.projectId === scope.projectId,
      );
    },
    async findWorkspaceByRequestId(scope, requestId) {
      const workspace = [...rows.workspaces.values()].find(
        (row) =>
          row.projectId === scope.projectId &&
          row.createdBy === scope.actorUserId &&
          row.requestId === requestId,
      );
      if (!workspace) return null;
      const snapshot = rows.snapshots.get(workspace.currentSnapshotId);
      if (!snapshot) return null;
      return { workspace, snapshot };
    },
    async findWorkspaceById(scope, id) {
      const workspace = rows.workspaces.get(id);
      if (!workspace) return null;
      if (
        workspace.workspaceId !== scope.workspaceId ||
        workspace.projectId !== scope.projectId
      ) {
        return null;
      }
      return workspace;
    },
    async findWorkspaceByIdAny(id) {
      return rows.workspaces.get(id) ?? null;
    },
    async findSnapshotById(workspaceId, snapshotId) {
      const snapshot = rows.snapshots.get(snapshotId);
      if (!snapshot || snapshot.codeWorkspaceId !== workspaceId) return null;
      return snapshot;
    },
    async findPatchByRequestId(scope, requestId) {
      const patch = [...rows.patches.values()].find((row) => row.requestId === requestId);
      if (!patch) return null;
      const workspace = rows.workspaces.get(patch.codeWorkspaceId);
      if (
        !workspace ||
        workspace.workspaceId !== scope.workspaceId ||
        workspace.projectId !== scope.projectId ||
        workspace.createdBy !== scope.actorUserId
      ) {
        return null;
      }
      return patch;
    },
    async createWorkspaceDraft({ scope, requestId, request, snapshotId, treeHash }) {
      const workspace: CodeWorkspaceRecord = {
        id: randomUUID(),
        requestId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        createdBy: scope.actorUserId,
        name: request.name,
        description: request.description ?? null,
        language: request.language ?? null,
        framework: request.framework ?? null,
        currentSnapshotId: snapshotId,
        sourceRunId: request.sourceRunId ?? null,
        sourceActionId: request.sourceActionId ?? null,
      };
      const snapshot: CodeWorkspaceSnapshotRecord = {
        id: snapshotId,
        codeWorkspaceId: workspace.id,
        parentSnapshotId: null,
        treeHash,
        manifest: request.manifest,
      };
      rows.workspaces.set(workspace.id, workspace);
      rows.snapshots.set(snapshot.id, snapshot);
      return { workspace, snapshot };
    },
    async createPatch({ requestId, workspace, patch }) {
      const record: CodeWorkspacePatchRecord = {
        id: randomUUID(),
        requestId,
        codeWorkspaceId: workspace.id,
        baseSnapshotId: patch.baseSnapshotId,
        status: "approval_required",
        patch,
      };
      rows.patches.set(record.id, record);
      return record;
    },
    async renameWorkspace({ scope, id, name, description }) {
      const workspace = rows.workspaces.get(id);
      if (
        !workspace ||
        workspace.workspaceId !== scope.workspaceId ||
        workspace.projectId !== scope.projectId
      ) {
        return null;
      }
      const updated: CodeWorkspaceRecord = {
        ...workspace,
        name,
        description: description !== undefined ? description : workspace.description,
        updatedAt: new Date(),
      };
      rows.workspaces.set(id, updated);
      return updated;
    },
    async softDeleteWorkspace({ scope, id }) {
      const workspace = rows.workspaces.get(id);
      if (
        !workspace ||
        workspace.workspaceId !== scope.workspaceId ||
        workspace.projectId !== scope.projectId
      ) {
        return null;
      }
      rows.workspaces.delete(id);
      return workspace;
    },
  };
}

function toWorkspaceRecord(row: typeof codeWorkspaces.$inferSelect): CodeWorkspaceRecord {
  if (!row.currentSnapshotId) {
    throw new AgentActionError("code_workspace_missing_snapshot", 409);
  }
  return {
    id: row.id,
    requestId: row.requestId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    createdBy: row.createdBy,
    name: row.name,
    description: row.description,
    language: row.language,
    framework: row.framework,
    currentSnapshotId: row.currentSnapshotId,
    sourceRunId: row.sourceRunId,
    sourceActionId: row.sourceActionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSnapshotRecord(row: typeof codeWorkspaceSnapshots.$inferSelect): CodeWorkspaceSnapshotRecord {
  return {
    id: row.id,
    codeWorkspaceId: row.codeWorkspaceId,
    parentSnapshotId: row.parentSnapshotId,
    treeHash: row.treeHash,
    manifest: codeWorkspaceManifestFromUnknown(row.manifest),
  };
}

function toPatchRecord(row: typeof codeWorkspacePatches.$inferSelect): CodeWorkspacePatchRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    codeWorkspaceId: row.codeWorkspaceId,
    baseSnapshotId: row.baseSnapshotId,
    status: row.status,
    patch: {
      codeWorkspaceId: row.codeWorkspaceId,
      requestId: row.requestId,
      baseSnapshotId: row.baseSnapshotId,
      operations: row.operations as CodeWorkspacePatch["operations"],
      preview: row.preview as CodeWorkspacePatch["preview"],
      risk: row.risk as CodeWorkspacePatch["risk"],
    },
  };
}

function codeWorkspaceManifestFromUnknown(value: unknown): CodeWorkspaceManifest {
  return codeWorkspaceManifestSchema.parse(value);
}

function entryToInsert(
  snapshotId: string,
  entry: CodeWorkspaceManifest["entries"][number],
): typeof codeWorkspaceFileEntries.$inferInsert {
  return {
    snapshotId,
    path: entry.path,
    pathKey: entry.path.toLowerCase(),
    kind: entry.kind as CodeWorkspaceEntryKind,
    language: "language" in entry ? entry.language ?? null : null,
    mimeType: "mimeType" in entry ? entry.mimeType ?? null : null,
    bytes: "bytes" in entry ? entry.bytes : null,
    contentHash: "contentHash" in entry ? entry.contentHash : null,
    objectKey: "objectKey" in entry ? entry.objectKey ?? null : null,
    inlineContent: "inlineContent" in entry ? entry.inlineContent ?? null : null,
  };
}

function parseOrAgentActionError<T>(
  schema: { parse: (value: unknown) => T },
  input: unknown,
): T {
  try {
    return schema.parse(input);
  } catch (error) {
    const issue = readFirstZodIssueMessage(error);
    throw new AgentActionError(issue ?? "invalid_code_workspace_request", 400);
  }
}

function readFirstZodIssueMessage(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  ) {
    const [first] = (error as { issues: Array<{ message?: unknown }> }).issues;
    return typeof first?.message === "string" ? first.message : undefined;
  }
  return undefined;
}

function treeHashForManifest(manifest: CodeWorkspaceManifest): string {
  const canonical = manifest.entries
    .map((entry) => `${entry.kind}:${entry.path}:${"contentHash" in entry ? entry.contentHash : ""}`)
    .sort()
    .join("|");
  return `sha256:${Buffer.from(canonical).toString("base64url")}`;
}
