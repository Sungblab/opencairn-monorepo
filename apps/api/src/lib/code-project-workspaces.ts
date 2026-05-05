import { randomUUID } from "node:crypto";
import {
  codeWorkspaceCreateRequestSchema,
  codeWorkspacePatchSchema,
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
  findWorkspaceByRequestId(scope: CodeWorkspaceScope, requestId: string): Promise<{
    workspace: CodeWorkspaceRecord;
    snapshot: CodeWorkspaceSnapshotRecord;
  } | null>;
  findWorkspaceById(scope: CodeWorkspaceScope, id: string): Promise<CodeWorkspaceRecord | null>;
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
        workspace.projectId !== scope.projectId ||
        workspace.createdBy !== scope.actorUserId
      ) {
        return null;
      }
      return workspace;
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
