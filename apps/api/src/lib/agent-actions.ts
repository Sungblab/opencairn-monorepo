import {
  agentActions,
  and,
  asc,
  captureNoteVersion,
  db as defaultDb,
  desc,
  eq,
  extractWikiLinkTargets,
  folders,
  isNotNull,
  isNull,
  notes,
  projects,
  sql,
  syncWikiLinks,
  type AgentActionRow,
  type DB,
  yjsDocuments,
} from "@opencairn/db";
import { noteActionInputByKind } from "@opencairn/shared";
import {
  codeWorkspaceCommandRunRequestSchema,
  codeWorkspaceCommandRunResultSchema,
  codeWorkspaceCreateRequestSchema,
  codeWorkspaceInstallRequestSchema,
  codeWorkspaceInstallResultSchema,
  codeWorkspacePatchSchema,
  codeWorkspacePreviewResultSchema,
  codeWorkspacePreviewRequestSchema,
  normalizeCodeWorkspacePath,
  noteUpdateApplyRequestSchema,
  noteUpdateApplyResultSchema,
  noteUpdatePreviewSchema,
} from "@opencairn/shared";
import type {
  AgentAction,
  AgentActionKind,
  AgentActionRisk,
  AgentActionStatus,
  CreateAgentActionRequest,
  NoteCreateActionInput,
  NoteDeleteActionInput,
  NoteMoveActionInput,
  NoteRenameActionInput,
  NoteRestoreActionInput,
  NoteUpdateApplyRequest,
  NoteUpdateApplyResult,
  NoteUpdateActionInput,
  NoteUpdatePreview,
  Phase2ANoteActionKind,
  Phase2ANoteActionInput,
  TransitionAgentActionStatusRequest,
  CodeWorkspaceCommandRunRequest,
  CodeWorkspaceCommandRunResult,
  CodeWorkspaceInstallResult,
  CodeWorkspaceInstallRequest,
  CodeWorkspacePreviewResult,
} from "@opencairn/shared";
import { randomUUID } from "node:crypto";
import {
  createCodeWorkspaceDraft,
  createDrizzleCodeWorkspaceRepository,
  prepareCodeWorkspacePatch,
  type CodeWorkspaceRecord,
  type CodeWorkspaceRepository,
  type CodeWorkspaceSnapshotRecord,
} from "./code-project-workspaces";
import {
  cancelCodeWorkspaceCommandWorkflow,
  createTemporalCodeCommandRunner,
} from "./code-workspace-command-runner";
import { createTemporalCodeInstallRunner } from "./code-workspace-install-runner";
import { createTemporalCodeRepairPlanner } from "./code-workspace-repair-planner";
import { canWrite } from "./permissions";
import { streamObject } from "./s3-get";
import { diffPlateValues } from "./note-version-diff";
import { plateValueToText } from "./plate-text";
import { emitTreeEvent } from "./tree-events";
import type { PlateValue } from "./yjs-to-plate";
import {
  transformYjsStateWithPlateValue,
  yjsStateToPlateValue,
} from "./yjs-plate-transform";

export class AgentActionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409,
    message = code,
  ) {
    super(message);
  }
}

const MAX_CODE_REPAIR_ATTEMPTS = 3;

export interface AgentActionRepository {
  findProjectScope(projectId: string): Promise<{ workspaceId: string } | null>;
  findByRequestId(projectId: string, actorUserId: string, requestId: string): Promise<AgentAction | null>;
  findById(id: string): Promise<AgentAction | null>;
  listByProject(options: {
    projectId: string;
    status?: AgentActionStatus;
    kind?: AgentActionKind;
    limit: number;
  }): Promise<AgentAction[]>;
  listBySourceRunId(options: {
    projectId: string;
    sourceRunId: string;
    kind?: AgentActionKind;
  }): Promise<AgentAction[]>;
  listExpiredCodePreviewActions(options: {
    now: Date;
    limit: number;
  }): Promise<AgentAction[]>;
  insert(values: {
    requestId: string;
    workspaceId: string;
    projectId: string;
    actorUserId: string;
    sourceRunId?: string | null;
    kind: AgentActionKind;
    status: AgentActionStatus;
    risk: AgentActionRisk;
    input: Record<string, unknown>;
    preview?: Record<string, unknown> | null;
    result?: Record<string, unknown> | null;
    errorCode?: string | null;
  }): Promise<{ action: AgentAction; inserted: boolean }>;
  updateStatus(
    id: string,
    values: {
      status: AgentActionStatus;
      preview?: Record<string, unknown> | null;
      result?: Record<string, unknown> | null;
      errorCode?: string | null;
    },
  ): Promise<AgentAction | null>;
}

export interface AgentActionServiceOptions {
  repo?: AgentActionRepository;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  codeWorkspaceRepo?: CodeWorkspaceRepository;
  codeCommandRunner?: CodeCommandRunner;
  codeInstallRunner?: CodeInstallRunner;
  codeCommandCanceller?: CodeCommandCanceller;
  codeRepairPlanner?: CodeRepairPlanner;
  noteExecutor?: NoteActionExecutor;
  noteUpdatePreviewer?: NoteUpdatePreviewer;
  noteUpdateApplier?: NoteUpdateApplier;
  now?: () => Date;
  codePreviewTtlMs?: number;
  codePreviewObjectReader?: CodePreviewObjectReader;
}

export interface WorkflowAgentActionInput {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  requestId?: string;
  sourceRunId?: string | null;
  kind: Extract<
    AgentActionKind,
    | "import.drive"
    | "import.markdown_zip"
    | "import.notion"
    | "export.note"
    | "export.project"
    | "export.file"
    | "export.workspace"
    | "export.provider"
  >;
  risk: AgentActionRisk;
  input?: Record<string, unknown>;
  preview?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
}

export interface NoteActionExecutorInput {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  kind: Phase2ANoteActionKind;
  payload: Phase2ANoteActionInput;
}

export interface NoteActionExecutor {
  execute(input: NoteActionExecutorInput): Promise<Record<string, unknown>>;
}

export interface NoteUpdatePreviewerInput {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  payload: NoteUpdateActionInput;
}

export interface NoteUpdatePreviewer {
  preview(input: NoteUpdatePreviewerInput): Promise<NoteUpdatePreview>;
}

export interface NoteUpdateApplierInput {
  action: AgentAction;
  actorUserId: string;
  request: NoteUpdateApplyRequest;
  payload: NoteUpdateActionInput;
}

export interface NoteUpdateApplier {
  apply(input: NoteUpdateApplierInput): Promise<NoteUpdateApplyResult>;
}

export interface CodeCommandRunnerInput {
  action: AgentAction;
  workspace: CodeWorkspaceRecord;
  snapshot: CodeWorkspaceSnapshotRecord;
  request: CodeWorkspaceCommandRunRequest;
}

export interface CodeCommandRunner {
  run(input: CodeCommandRunnerInput): Promise<CodeWorkspaceCommandRunResult>;
}

export interface CodeInstallRunnerInput {
  action: AgentAction;
  workspace: CodeWorkspaceRecord;
  snapshot: CodeWorkspaceSnapshotRecord;
  request: CodeWorkspaceInstallRequest;
}

export interface CodeInstallRunner {
  install(input: CodeInstallRunnerInput): Promise<CodeWorkspaceInstallResult>;
}

export interface CodeCommandCancellerInput {
  action: AgentAction;
}

export interface CodeCommandCanceller {
  cancel(input: CodeCommandCancellerInput): Promise<void>;
}

export interface CodeRepairPlannerInput {
  requestId: string;
  failedRunAction: AgentAction;
  runResult: CodeWorkspaceCommandRunResult;
  workspace: CodeWorkspaceRecord;
  snapshot: CodeWorkspaceSnapshotRecord;
}

export interface CodeRepairPlanner {
  plan(input: CodeRepairPlannerInput): Promise<Record<string, unknown>>;
}

export interface CodePreviewAsset {
  body: BodyInit;
  contentType: string;
  contentLength?: number;
}

export interface CodePreviewObjectReader {
  read(objectKey: string): Promise<CodePreviewAsset>;
}

export function createDrizzleAgentActionRepository(conn: DB = defaultDb): AgentActionRepository {
  return {
    async findProjectScope(projectId) {
      const [project] = await conn
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId));
      return project ?? null;
    },
    async findByRequestId(projectId, actorUserId, requestId) {
      const [row] = await conn
        .select()
        .from(agentActions)
        .where(
          and(
            eq(agentActions.projectId, projectId),
            eq(agentActions.actorUserId, actorUserId),
            eq(agentActions.requestId, requestId),
          ),
        );
      return row ? toAgentAction(row) : null;
    },
    async findById(id) {
      const [row] = await conn.select().from(agentActions).where(eq(agentActions.id, id));
      return row ? toAgentAction(row) : null;
    },
    async listByProject({ projectId, status, kind, limit }) {
      const filters = [
        eq(agentActions.projectId, projectId),
        ...(status ? [eq(agentActions.status, status)] : []),
        ...(kind ? [eq(agentActions.kind, kind)] : []),
      ];
      const rows = await conn
        .select()
        .from(agentActions)
        .where(and(...filters))
        .orderBy(desc(agentActions.createdAt))
        .limit(limit);
      return rows.map(toAgentAction);
    },
    async listBySourceRunId({ projectId, sourceRunId, kind }) {
      const filters = [
        eq(agentActions.projectId, projectId),
        eq(agentActions.sourceRunId, sourceRunId),
        ...(kind ? [eq(agentActions.kind, kind)] : []),
      ];
      const rows = await conn
        .select()
        .from(agentActions)
        .where(and(...filters))
        .orderBy(desc(agentActions.createdAt));
      return rows.map(toAgentAction);
    },
    async listExpiredCodePreviewActions({ now, limit }) {
      const rows = await conn
        .select()
        .from(agentActions)
        .where(
          and(
            eq(agentActions.kind, "code_project.preview"),
            eq(agentActions.status, "completed"),
            isNotNull(agentActions.result),
            sql`(${agentActions.result}->>'expiresAt')::timestamptz <= ${now}`,
          ),
        )
        .orderBy(asc(agentActions.updatedAt))
        .limit(limit);
      return rows.map(toAgentAction);
    },
    async insert(values) {
      const [inserted] = await conn
        .insert(agentActions)
        .values(values)
        .onConflictDoNothing({
          target: [
            agentActions.projectId,
            agentActions.actorUserId,
            agentActions.requestId,
          ],
        })
        .returning();
      if (inserted) return { action: toAgentAction(inserted), inserted: true };

      const existing = await this.findByRequestId(
        values.projectId,
        values.actorUserId,
        values.requestId,
      );
      if (!existing) {
        throw new AgentActionError("idempotency_conflict", 409);
      }
      return { action: existing, inserted: false };
    },
    async updateStatus(id, values) {
      const [row] = await conn
        .update(agentActions)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(agentActions.id, id))
        .returning();
      return row ? toAgentAction(row) : null;
    },
  };
}

export async function createAgentAction(
  projectId: string,
  actorUserId: string,
  request: CreateAgentActionRequest,
  options?: AgentActionServiceOptions,
): Promise<{ action: AgentAction; idempotent: boolean }> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new AgentActionError("project_not_found", 404);

  const canWriteProject =
    options?.canWriteProject ?? ((userId, id) => canWrite(userId, { type: "project", id }));
  if (!(await canWriteProject(actorUserId, projectId))) {
    throw new AgentActionError("forbidden", 403);
  }

  const requestId = request.requestId ?? randomUUID();
  const existing = await repo.findByRequestId(projectId, actorUserId, requestId);
  if (existing) return { action: existing, idempotent: true };

  const placeholder = request.kind === "workflow.placeholder";
  const executableNoteAction = isPhase2ANoteAction(request.kind);
  const executableCodeCreateAction = request.kind === "code_project.create";
  const codePatchAction = request.kind === "code_project.patch";
  const codeInstallAction = request.kind === "code_project.install";
  const codePreviewAction = request.kind === "code_project.preview";
  const executableCodeRunAction = request.kind === "code_project.run";
  const noteUpdatePreview =
    request.kind === "note.update"
      ? await previewNoteUpdateAction(
          {
            workspaceId: scope.workspaceId,
            projectId,
            actorUserId,
            payload: parseNoteUpdatePayload(request.input ?? {}),
          },
          options,
        )
      : null;
  const { action, inserted } = await repo.insert({
    requestId,
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    sourceRunId: request.sourceRunId ?? null,
    kind: request.kind,
    status: placeholder
      ? "completed"
      : executableNoteAction
        ? "running"
        : executableCodeCreateAction
          ? "running"
          : executableCodeRunAction
          ? "running"
          : noteUpdatePreview || codePatchAction
          ? "draft"
          : initialStatusForRisk(request.risk),
    risk: request.risk,
    input: request.input ?? {},
    preview: noteUpdatePreview ?? request.preview ?? (
      codeInstallAction
        ? codeInstallApprovalPreview(request.input ?? {})
        : codePreviewAction
          ? codePreviewApprovalPreview(request.input ?? {})
        : placeholder
          ? placeholderPreview(request.input ?? {})
          : null
    ),
    result: placeholder ? placeholderResult(request.input ?? {}) : null,
    errorCode: null,
  });
  if (!inserted) return { action, idempotent: true };
  if (executableNoteAction) {
    return {
      action: await executePersistedNoteAction(action, request, options),
      idempotent: false,
    };
  }
  if (executableCodeCreateAction) {
    return {
      action: await executePersistedCodeProjectCreateAction(action, request, options),
      idempotent: false,
    };
  }
  if (codePatchAction) {
    return {
      action: await preparePersistedCodeProjectPatchAction(action, request, options),
      idempotent: false,
    };
  }
  if (executableCodeRunAction) {
    return {
      action: await executePersistedCodeProjectRunAction(action, request, options),
      idempotent: false,
    };
  }
  return { action, idempotent: false };
}

export const executeAgentAction = createAgentAction;

export async function createQueuedWorkflowAgentAction(
  request: WorkflowAgentActionInput,
  options?: Pick<AgentActionServiceOptions, "repo" | "canWriteProject">,
): Promise<{ action: AgentAction; idempotent: boolean }> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const scope = await repo.findProjectScope(request.projectId);
  if (!scope) throw new AgentActionError("project_not_found", 404);
  if (scope.workspaceId !== request.workspaceId) {
    throw new AgentActionError("workspace_scope_mismatch", 409);
  }

  const canWriteProject =
    options?.canWriteProject ?? ((userId, id) => canWrite(userId, { type: "project", id }));
  if (!(await canWriteProject(request.actorUserId, request.projectId))) {
    throw new AgentActionError("forbidden", 403);
  }

  const requestId = request.requestId ?? randomUUID();
  const existing = await repo.findByRequestId(
    request.projectId,
    request.actorUserId,
    requestId,
  );
  if (existing) return { action: existing, idempotent: true };

  const { action, inserted } = await repo.insert({
    requestId,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    actorUserId: request.actorUserId,
    sourceRunId: request.sourceRunId ?? null,
    kind: request.kind,
    status: "queued",
    risk: request.risk,
    input: request.input ?? {},
    preview: request.preview ?? null,
    result: request.result ?? null,
    errorCode: null,
  });
  return { action, idempotent: !inserted };
}

export async function markWorkflowAgentActionFailed(
  actionId: string | null | undefined,
  errorCode: string,
  result?: Record<string, unknown>,
  options?: Pick<AgentActionServiceOptions, "repo">,
): Promise<AgentAction | null> {
  if (!actionId) return null;
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  return repo.updateStatus(actionId, {
    status: "failed",
    result: result ?? { ok: false, errorCode, retryable: true },
    errorCode,
  });
}

export async function cancelWorkflowAgentActionsBySourceRunId(
  args: {
    projectId: string | null | undefined;
    sourceRunId: string;
    result?: Record<string, unknown>;
  },
  options?: Pick<AgentActionServiceOptions, "repo">,
): Promise<AgentAction[]> {
  if (!args.projectId) return [];
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const actions = await repo.listBySourceRunId({
    projectId: args.projectId,
    sourceRunId: args.sourceRunId,
  });
  const cancellable = actions.filter((action) =>
    action.status === "queued" || action.status === "running"
  );
  const updated = await Promise.all(
    cancellable.map((action) =>
      repo.updateStatus(action.id, {
        status: "cancelled",
        result: args.result ?? {
          ok: false,
          sourceRunId: args.sourceRunId,
          errorCode: "cancelled",
          retryable: false,
        },
        errorCode: "cancelled",
      }),
    ),
  );
  return updated.filter((action): action is AgentAction => action !== null);
}

export async function listAgentActions(
  projectId: string,
  actorUserId: string,
  options: {
    status?: AgentActionStatus;
    kind?: AgentActionKind;
    limit: number;
  },
  serviceOptions?: AgentActionServiceOptions,
): Promise<AgentAction[]> {
  const repo = serviceOptions?.repo ?? createDrizzleAgentActionRepository();
  const canWriteProject =
    serviceOptions?.canWriteProject ?? ((userId, id) => canWrite(userId, { type: "project", id }));
  if (!(await canWriteProject(actorUserId, projectId))) {
    throw new AgentActionError("forbidden", 403);
  }
  return repo.listByProject({ projectId, ...options });
}

export async function getAgentAction(
  id: string,
  actorUserId: string,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const action = await repo.findById(id);
  if (!action) throw new AgentActionError("action_not_found", 404);

  const canWriteProject =
    options?.canWriteProject ?? ((userId, projectId) => canWrite(userId, { type: "project", id: projectId }));
  if (!(await canWriteProject(actorUserId, action.projectId))) {
    throw new AgentActionError("forbidden", 403);
  }
  return action;
}

export async function transitionAgentActionStatus(
  id: string,
  actorUserId: string,
  request: TransitionAgentActionStatusRequest,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const current = await getAgentAction(id, actorUserId, { ...options, repo });
  if (!canTransition(current.status, request.status)) {
    throw new AgentActionError("invalid_status_transition", 409);
  }

  const updated = await repo.updateStatus(id, {
    status: request.status,
    preview: request.preview,
    result: request.result,
    errorCode: request.errorCode,
  });
  if (!updated) throw new AgentActionError("action_not_found", 404);
  return updated;
}

export async function applyNoteUpdateAction(
  id: string,
  actorUserId: string,
  request: NoteUpdateApplyRequest,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const current = await getAgentAction(id, actorUserId, { ...options, repo });
  if (current.kind !== "note.update") {
    throw new AgentActionError("action_kind_not_applicable", 409);
  }
  if (current.status !== "draft") {
    throw new AgentActionError("invalid_status_transition", 409);
  }

  const payload = parseNoteUpdatePayload(current.input);
  const running = await repo.updateStatus(id, {
    status: "running",
    errorCode: null,
  });
  if (!running) throw new AgentActionError("action_not_found", 404);

  const applier = options?.noteUpdateApplier ?? createDrizzleNoteUpdateApplier();
  try {
    const result = noteUpdateApplyResultSchema.parse(
      await applier.apply({
        action: running,
        actorUserId,
        request,
        payload,
      }),
    );
    const completed = await repo.updateStatus(id, {
      status: "completed",
      result,
      errorCode: null,
    });
    if (!completed) throw new AgentActionError("action_not_found", 404);
    return completed;
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "note_update_apply_failed";
    const failed = await repo.updateStatus(id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!failed) throw new AgentActionError("action_not_found", 404);
    if (err instanceof AgentActionError) throw err;
    throw new AgentActionError(errorCode, 409);
  }
}

export async function applyAgentAction(
  id: string,
  actorUserId: string,
  request: Record<string, unknown>,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const current = await getAgentAction(id, actorUserId, { ...options, repo });
  if (current.kind === "note.update") {
    return applyNoteUpdateAction(id, actorUserId, noteUpdateApplyResultInput(request), {
      ...options,
      repo,
    });
  }
  if (current.kind === "code_project.patch") {
    return applyCodeProjectPatchAction(current, actorUserId, { ...options, repo });
  }
  if (current.kind === "code_project.preview") {
    return applyCodeProjectPreviewAction(current, actorUserId, { ...options, repo });
  }
  if (current.kind === "code_project.install") {
    return applyCodeProjectInstallAction(current, actorUserId, { ...options, repo });
  }
  throw new AgentActionError("action_kind_not_applicable", 409);
}

export async function readCodeProjectPreviewAsset(
  id: string,
  actorUserId: string,
  path: string | undefined,
  options?: AgentActionServiceOptions,
): Promise<CodePreviewAsset> {
  const current = await getAgentAction(id, actorUserId, options);
  if (current.kind !== "code_project.preview") {
    throw new AgentActionError("action_kind_not_applicable", 409);
  }
  if (current.status === "expired") {
    throw new AgentActionError("code_project_preview_expired", 409);
  }
  if (current.status !== "completed") {
    throw new AgentActionError("code_project_preview_not_ready", 409);
  }
  const result = parseCodeWorkspacePreviewResult(current.result);
  assertCodePreviewNotExpired(result, options);
  const requestedPath = normalizePreviewAssetPath(path ?? result.entryPath);
  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  const workspace = await codeRepo.findWorkspaceById(
    {
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      actorUserId,
    },
    result.codeWorkspaceId,
  );
  if (!workspace) throw new AgentActionError("code_workspace_not_found", 404);
  const snapshot = await codeRepo.findSnapshotById(workspace.id, result.snapshotId);
  if (!snapshot) throw new AgentActionError("code_workspace_snapshot_not_found", 404);
  const entry = snapshot.manifest.entries.find(
    (candidate) => candidate.path.toLowerCase() === requestedPath.toLowerCase(),
  );
  if (!entry || entry.kind !== "file") {
    throw new AgentActionError("code_workspace_preview_asset_not_found", 404);
  }
  if ("inlineContent" in entry && entry.inlineContent != null) {
    return {
      body: entry.inlineContent,
      contentType: entry.mimeType ?? contentTypeForPreviewPath(entry.path),
      contentLength: Buffer.byteLength(entry.inlineContent, "utf8"),
    };
  }
  if ("objectKey" in entry && entry.objectKey) {
    return readPreviewObject(entry.objectKey, options);
  }
  throw new AgentActionError("code_workspace_preview_asset_unavailable", 409);
}

export async function cleanupExpiredCodeProjectPreviews(
  options?: Pick<AgentActionServiceOptions, "repo" | "now"> & { limit?: number },
): Promise<{ expiredCount: number; actionIds: string[] }> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const currentNow = now(options);
  const candidates = await repo.listExpiredCodePreviewActions({
    now: currentNow,
    limit: options?.limit ?? 100,
  });
  const actionIds: string[] = [];

  for (const action of candidates) {
    const result = parseCodeWorkspacePreviewResult(action.result);
    if (new Date(result.expiresAt).getTime() > currentNow.getTime()) continue;

    const updated = await repo.updateStatus(action.id, {
      status: "expired",
      result,
      errorCode: "code_project_preview_expired",
    });
    if (updated?.status === "expired") actionIds.push(updated.id);
  }

  return { expiredCount: actionIds.length, actionIds };
}

export async function createCodeProjectRepairAction(
  failedRunActionId: string,
  actorUserId: string,
  request: { requestId?: string },
  options?: AgentActionServiceOptions,
): Promise<{ action: AgentAction; idempotent: boolean }> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const failedRunAction = await getAgentAction(failedRunActionId, actorUserId, {
    ...options,
    repo,
  });
  if (failedRunAction.kind !== "code_project.run") {
    throw new AgentActionError("action_kind_not_applicable", 409);
  }
  if (failedRunAction.status !== "failed") {
    throw new AgentActionError("code_project_repair_requires_failed_run", 409);
  }

  const requestId = request.requestId ?? randomUUID();
  const existing = await repo.findByRequestId(
    failedRunAction.projectId,
    actorUserId,
    requestId,
  );
  if (existing) return { action: existing, idempotent: true };

  const repairAttempts = await repo.listBySourceRunId({
    projectId: failedRunAction.projectId,
    sourceRunId: failedRunAction.id,
    kind: "code_project.patch",
  });
  if (repairAttempts.length >= MAX_CODE_REPAIR_ATTEMPTS) {
    throw new AgentActionError("code_project_repair_limit_exceeded", 409);
  }

  const runResult = codeWorkspaceCommandRunResultSchema.parse(failedRunAction.result);
  if (runResult.ok || runResult.exitCode === 0) {
    throw new AgentActionError("code_project_repair_requires_failed_run", 409);
  }
  if (!runResult.codeWorkspaceId || !runResult.snapshotId) {
    throw new AgentActionError("code_project_run_result_incomplete", 409);
  }

  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  const scope = {
    workspaceId: failedRunAction.workspaceId,
    projectId: failedRunAction.projectId,
    actorUserId,
  };
  const workspace = await codeRepo.findWorkspaceById(scope, runResult.codeWorkspaceId);
  if (!workspace) throw new AgentActionError("code_workspace_not_found", 404);
  const snapshot = await codeRepo.findSnapshotById(workspace.id, runResult.snapshotId);
  if (!snapshot) throw new AgentActionError("code_workspace_snapshot_not_found", 404);

  const planner = options?.codeRepairPlanner ?? createDefaultCodeRepairPlanner();
  const payload = codeWorkspacePatchSchema.parse({
    ...(await planner.plan({
      requestId,
      failedRunAction,
      runResult,
      workspace,
      snapshot,
    })),
    requestId,
    risk: "write",
  });

  const { action, inserted } = await repo.insert({
    requestId,
    workspaceId: failedRunAction.workspaceId,
    projectId: failedRunAction.projectId,
    actorUserId,
    sourceRunId: failedRunAction.id,
    kind: "code_project.patch",
    status: "draft",
    risk: "write",
    input: payload,
    preview: payload.preview,
    result: null,
    errorCode: null,
  });
  if (!inserted) return { action, idempotent: true };

  try {
    await prepareCodeWorkspacePatch(codeRepo, scope, payload);
    return { action, idempotent: false };
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "code_project_repair_failed";
    const failed = await repo.updateStatus(action.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!failed) throw new AgentActionError("action_not_found", 404);
    return { action: failed, idempotent: false };
  }
}

export async function cancelCodeProjectRunAction(
  actionId: string,
  actorUserId: string,
  options?: AgentActionServiceOptions,
): Promise<{ action: AgentAction; idempotent: boolean }> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const action = await getAgentAction(actionId, actorUserId, {
    ...options,
    repo,
  });
  if (action.kind !== "code_project.run") {
    throw new AgentActionError("action_kind_not_applicable", 409);
  }
  if (action.status === "cancelled") {
    return { action, idempotent: true };
  }
  if (!["queued", "running"].includes(action.status)) {
    throw new AgentActionError("action_not_cancellable", 409);
  }

  const canceller = options?.codeCommandCanceller ?? createDefaultCodeCommandCanceller();
  if (action.status === "running") {
    try {
      await canceller.cancel({ action });
    } catch (err) {
      console.warn("[agent-actions] code command cancel failed", err);
    }
  }
  const cancelled = await repo.updateStatus(action.id, {
    status: "cancelled",
    result: { ok: false, errorCode: "cancelled" },
    errorCode: "cancelled",
  });
  if (!cancelled) throw new AgentActionError("action_not_found", 404);
  return { action: cancelled, idempotent: false };
}

export function canTransition(from: AgentActionStatus, to: AgentActionStatus): boolean {
  if (from === to) return true;
  const allowed: Record<AgentActionStatus, AgentActionStatus[]> = {
    draft: ["approval_required", "queued", "running", "completed", "failed", "cancelled"],
    approval_required: ["queued", "failed", "cancelled"],
    queued: ["running", "failed", "cancelled"],
    running: ["completed", "failed", "cancelled"],
    completed: ["reverted"],
    failed: ["queued"],
    cancelled: ["queued"],
    expired: [],
    reverted: [],
  };
  return allowed[from].includes(to);
}

function initialStatusForRisk(risk: AgentActionRisk): AgentActionStatus {
  return risk === "low" ? "draft" : "approval_required";
}

function isPhase2ANoteAction(kind: AgentActionKind): kind is Phase2ANoteActionKind {
  return kind === "note.create"
    || kind === "note.rename"
    || kind === "note.move"
    || kind === "note.delete"
    || kind === "note.restore";
}

async function executePersistedNoteAction(
  action: AgentAction,
  request: CreateAgentActionRequest,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const executor = options?.noteExecutor ?? createDrizzleNoteActionExecutor();
  try {
    const result = await executor.execute({
      workspaceId: action.workspaceId,
      projectId: action.projectId,
      actorUserId: action.actorUserId,
      kind: action.kind as Phase2ANoteActionKind,
      payload: parseNoteActionPayload(action.kind as Phase2ANoteActionKind, request.input ?? {}),
    });
    const updated = await repo.updateStatus(action.id, {
      status: "completed",
      result,
      errorCode: null,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "note_action_failed";
    const updated = await repo.updateStatus(action.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  }
}

async function executePersistedCodeProjectCreateAction(
  action: AgentAction,
  request: CreateAgentActionRequest,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  try {
    const payload = codeWorkspaceCreateRequestSchema.parse({
      ...(request.input ?? {}),
      requestId: action.requestId,
      sourceRunId: action.sourceRunId ?? undefined,
      sourceActionId: action.id,
    });
    const created = await createCodeWorkspaceDraft(
      codeRepo,
      {
        workspaceId: action.workspaceId,
        projectId: action.projectId,
        actorUserId: action.actorUserId,
      },
      payload,
    );
    const updated = await repo.updateStatus(action.id, {
      status: "completed",
      result: {
        ok: true,
        workspace: serializeCodeWorkspace(action, created.workspace),
        snapshot: created.snapshot,
        archiveUrl: `/api/code-workspaces/${created.workspace.id}/snapshots/${created.snapshot.id}/archive`,
      },
      errorCode: null,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "code_project_create_failed";
    const updated = await repo.updateStatus(action.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  }
}

async function preparePersistedCodeProjectPatchAction(
  action: AgentAction,
  request: CreateAgentActionRequest,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  try {
    const payload = codeWorkspacePatchSchema.parse({
      ...(request.input ?? {}),
      requestId: action.requestId,
      risk: request.risk,
    });
    const result = await prepareCodeWorkspacePatch(
      codeRepo,
      {
        workspaceId: action.workspaceId,
        projectId: action.projectId,
        actorUserId: action.actorUserId,
      },
      payload,
    );
    const updated = await repo.updateStatus(action.id, {
      status: "draft",
      preview: result.patch.patch.preview,
      result: null,
      errorCode: null,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "code_project_patch_failed";
    const updated = await repo.updateStatus(action.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  }
}

async function applyCodeProjectPatchAction(
  current: AgentAction,
  actorUserId: string,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  if (current.status !== "draft") {
    throw new AgentActionError("invalid_status_transition", 409);
  }
  const running = await repo.updateStatus(current.id, {
    status: "running",
    errorCode: null,
  });
  if (!running) throw new AgentActionError("action_not_found", 404);

  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  const payload = codeWorkspacePatchSchema.parse({
    ...current.input,
    requestId: current.requestId,
    risk: current.risk,
  });
  try {
    const workspace = await codeRepo.findWorkspaceById(
      {
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        actorUserId,
      },
      payload.codeWorkspaceId,
    );
    if (!workspace) throw new AgentActionError("code_workspace_not_found", 404);
    const baseSnapshot = await codeRepo.findSnapshotById(workspace.id, payload.baseSnapshotId);
    if (!baseSnapshot) throw new AgentActionError("code_workspace_snapshot_not_found", 404);
    const patch = await codeRepo.findPatchByRequestId(
      {
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        actorUserId,
      },
      current.requestId,
    );
    const applied = await codeRepo.applyPatch({
      scope: { workspaceId: current.workspaceId, projectId: current.projectId },
      workspace,
      baseSnapshot,
      patch: payload,
      patchId: patch?.id ?? null,
    });
    const completed = await repo.updateStatus(current.id, {
      status: "completed",
      result: {
        ok: true,
        workspace: serializeCodeWorkspace(current, applied.workspace),
        snapshot: applied.snapshot,
        archiveUrl: `/api/code-workspaces/${applied.workspace.id}/snapshots/${applied.snapshot.id}/archive`,
      },
      errorCode: null,
    });
    if (!completed) throw new AgentActionError("action_not_found", 404);
    return completed;
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "code_project_patch_apply_failed";
    const failed = await repo.updateStatus(current.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!failed) throw new AgentActionError("action_not_found", 404);
    if (err instanceof AgentActionError) throw err;
    throw new AgentActionError(errorCode, 409);
  }
}

async function applyCodeProjectPreviewAction(
  current: AgentAction,
  actorUserId: string,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  if (current.status !== "approval_required") {
    throw new AgentActionError("invalid_status_transition", 409);
  }

  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  const payload = codeWorkspacePreviewRequestSchema.parse({
    ...current.input,
    requestId: current.requestId,
  });

  const queued = await repo.updateStatus(current.id, {
    status: "queued",
    errorCode: null,
  });
  if (!queued) throw new AgentActionError("action_not_found", 404);

  try {
    const workspace = await codeRepo.findWorkspaceById(
      {
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        actorUserId,
      },
      payload.codeWorkspaceId,
    );
    if (!workspace) throw new AgentActionError("code_workspace_not_found", 404);
    const snapshot = await codeRepo.findSnapshotById(workspace.id, payload.snapshotId);
    if (!snapshot) throw new AgentActionError("code_workspace_snapshot_not_found", 404);
    const entry = snapshot.manifest.entries.find(
      (candidate) => candidate.path.toLowerCase() === payload.entryPath.toLowerCase(),
    );
    if (!entry || entry.kind !== "file") {
      throw new AgentActionError("code_workspace_preview_entry_not_found", 404);
    }

    const assetsBaseUrl = `/api/agent-actions/${current.id}/preview/`;
    const expiresAt = new Date(
      now(options).getTime() + codePreviewTtlMs(options),
    ).toISOString();
    const result = codeWorkspacePreviewResultSchema.parse({
      ok: true,
      kind: "code_project.preview",
      mode: "static",
      codeWorkspaceId: workspace.id,
      snapshotId: snapshot.id,
      entryPath: payload.entryPath,
      previewUrl: `${assetsBaseUrl}${encodePreviewPath(payload.entryPath)}`,
      assetsBaseUrl,
      expiresAt,
    });
    const completed = await repo.updateStatus(current.id, {
      status: "completed",
      result,
      errorCode: null,
    });
    if (!completed) throw new AgentActionError("action_not_found", 404);
    return completed;
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "code_project_preview_failed";
    const failed = await repo.updateStatus(current.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!failed) throw new AgentActionError("action_not_found", 404);
    if (err instanceof AgentActionError) throw err;
    throw new AgentActionError(errorCode, 409);
  }
}

async function applyCodeProjectInstallAction(
  current: AgentAction,
  actorUserId: string,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  if (current.status !== "approval_required") {
    throw new AgentActionError("action_not_applicable", 409);
  }
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  try {
    const payload = codeWorkspaceInstallRequestSchema.parse({
      ...(current.input ?? {}),
      requestId: current.requestId,
    });
    const workspace = await codeRepo.findWorkspaceById(
      {
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        actorUserId,
      },
      payload.codeWorkspaceId,
    );
    if (!workspace) throw new AgentActionError("code_workspace_not_found", 404);
    const snapshot = await codeRepo.findSnapshotById(workspace.id, payload.snapshotId);
    if (!snapshot) throw new AgentActionError("code_workspace_snapshot_not_found", 404);

    const runner = options?.codeInstallRunner ?? createDefaultCodeInstallRunner();
    const installResult = codeWorkspaceInstallResultSchema.parse(
      await runner.install({
        action: current,
        workspace,
        snapshot,
        request: payload,
      }),
    );
    const result = {
      ...installResult,
      codeWorkspaceId: payload.codeWorkspaceId,
      snapshotId: payload.snapshotId,
    };
    const updated = await repo.updateStatus(current.id, {
      status: result.exitCode === 0 ? "completed" : "failed",
      result,
      errorCode: result.exitCode === 0 ? null : "code_project_install_failed",
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  } catch (err) {
    const errorCode = err instanceof AgentActionError ? err.code : "code_project_install_failed";
    const failed = await repo.updateStatus(current.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!failed) throw new AgentActionError("action_not_found", 404);
    return failed;
  }
}

async function executePersistedCodeProjectRunAction(
  action: AgentAction,
  request: CreateAgentActionRequest,
  options?: AgentActionServiceOptions,
): Promise<AgentAction> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const codeRepo = options?.codeWorkspaceRepo ?? createDrizzleCodeWorkspaceRepository();
  try {
    const payload = codeWorkspaceCommandRunRequestSchema.parse({
      ...(request.input ?? {}),
      requestId: action.requestId,
    });
    const workspace = await codeRepo.findWorkspaceById(
      {
        workspaceId: action.workspaceId,
        projectId: action.projectId,
        actorUserId: action.actorUserId,
      },
      payload.codeWorkspaceId,
    );
    if (!workspace) throw new AgentActionError("code_workspace_not_found", 404);
    const snapshot = await codeRepo.findSnapshotById(workspace.id, payload.snapshotId);
    if (!snapshot) throw new AgentActionError("code_workspace_snapshot_not_found", 404);

    const runner = options?.codeCommandRunner ?? createDefaultCodeCommandRunner();
    const runResult = codeWorkspaceCommandRunResultSchema.parse(
      await runner.run({
        action,
        workspace,
        snapshot,
        request: payload,
      }),
    );
    const result = {
      ...runResult,
      codeWorkspaceId: payload.codeWorkspaceId,
      snapshotId: payload.snapshotId,
      archiveUrl: `/api/code-workspaces/${workspace.id}/snapshots/${snapshot.id}/archive`,
    };
    const updated = await repo.updateStatus(action.id, {
      status: result.exitCode === 0 ? "completed" : "failed",
      result,
      errorCode: result.exitCode === 0 ? null : "code_project_run_failed",
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  } catch (err) {
    const current = await repo.findById(action.id);
    if (current?.status === "cancelled") return current;
    const errorCode = err instanceof AgentActionError ? err.code : "code_project_run_failed";
    const updated = await repo.updateStatus(action.id, {
      status: "failed",
      result: { ok: false, errorCode },
      errorCode,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return updated;
  }
}

function createDefaultCodeCommandRunner(): CodeCommandRunner {
  if (process.env.FEATURE_CODE_WORKSPACE_COMMANDS === "true") {
    return createTemporalCodeCommandRunner();
  }
  return createUnavailableCodeCommandRunner();
}

function createUnavailableCodeCommandRunner(): CodeCommandRunner {
  return {
    async run() {
      throw new AgentActionError("code_command_runner_unavailable", 409);
    },
  };
}

function createUnavailableCodeInstallRunner(): CodeInstallRunner {
  return {
    async install() {
      throw new AgentActionError("code_install_runner_unavailable", 409);
    },
  };
}

function createDefaultCodeInstallRunner(): CodeInstallRunner {
  if (process.env.FEATURE_CODE_WORKSPACE_INSTALLS === "true") {
    return createTemporalCodeInstallRunner();
  }
  return createUnavailableCodeInstallRunner();
}

function createUnavailableCodeRepairPlanner(): CodeRepairPlanner {
  return {
    async plan() {
      throw new AgentActionError("code_project_repair_planner_unavailable", 409);
    },
  };
}

function createDefaultCodeRepairPlanner(): CodeRepairPlanner {
  if (process.env.FEATURE_CODE_WORKSPACE_REPAIR === "true") {
    return createTemporalCodeRepairPlanner();
  }
  return createUnavailableCodeRepairPlanner();
}

function createDefaultCodeCommandCanceller(): CodeCommandCanceller {
  if (process.env.FEATURE_CODE_WORKSPACE_COMMANDS === "true") {
    return {
      async cancel(input) {
        await cancelCodeWorkspaceCommandWorkflow(input.action.id);
      },
    };
  }
  return {
    async cancel() {
      throw new AgentActionError("code_command_runner_unavailable", 409);
    },
  };
}

function noteUpdateApplyResultInput(input: Record<string, unknown>): NoteUpdateApplyRequest {
  return noteUpdateApplyRequestSchema.parse(input);
}

function serializeCodeWorkspace(action: AgentAction, workspace: {
  id: string;
  name: string;
  currentSnapshotId: string;
}) {
  return {
    id: workspace.id,
    projectId: action.projectId,
    workspaceId: action.workspaceId,
    name: workspace.name,
    currentSnapshotId: workspace.currentSnapshotId,
  };
}

function codeInstallApprovalPreview(input: Record<string, unknown>) {
  const payload = codeWorkspaceInstallRequestSchema.parse(input);
  const names = payload.packages.map((pkg) =>
    `${pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name}${pkg.dev ? " (dev)" : ""}`,
  );
  const summaryList =
    names.length > 3
      ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
      : names.join(", ");
  return {
    kind: "code_project.install",
    approval: "dependency_install",
    packageManager: payload.packageManager,
    packages: payload.packages,
    network: payload.network,
    summary: `Install ${summaryList} with ${payload.packageManager}`,
    reason: payload.reason ?? null,
  };
}

function codePreviewApprovalPreview(input: Record<string, unknown>) {
  const payload = codeWorkspacePreviewRequestSchema.parse(input);
  return {
    kind: "code_project.preview",
    approval: "hosted_preview",
    mode: payload.mode,
    entryPath: payload.entryPath,
    summary: `Create static preview for ${payload.entryPath}`,
    reason: payload.reason ?? null,
  };
}

function parseCodeWorkspacePreviewResult(input: unknown): CodeWorkspacePreviewResult {
  return codeWorkspacePreviewResultSchema.parse(input);
}

function assertCodePreviewNotExpired(
  result: CodeWorkspacePreviewResult,
  options?: Pick<AgentActionServiceOptions, "now">,
): void {
  if (new Date(result.expiresAt).getTime() <= now(options).getTime()) {
    throw new AgentActionError("code_project_preview_expired", 409);
  }
}

function now(options?: Pick<AgentActionServiceOptions, "now">): Date {
  return options?.now?.() ?? new Date();
}

function codePreviewTtlMs(
  options?: Pick<AgentActionServiceOptions, "codePreviewTtlMs">,
): number {
  return options?.codePreviewTtlMs ?? 24 * 60 * 60 * 1000;
}

async function readPreviewObject(
  objectKey: string,
  options?: Pick<AgentActionServiceOptions, "codePreviewObjectReader">,
): Promise<CodePreviewAsset> {
  const reader = options?.codePreviewObjectReader ?? createDefaultCodePreviewObjectReader();
  return reader.read(objectKey);
}

function createDefaultCodePreviewObjectReader(): CodePreviewObjectReader {
  return {
    async read(objectKey) {
      const object = await streamObject(objectKey);
      return {
        body: object.stream as BodyInit,
        contentType: object.contentType,
        contentLength: object.contentLength,
      };
    },
  };
}

function normalizePreviewAssetPath(path: string): string {
  try {
    return normalizeCodeWorkspacePath(decodeURIComponent(path));
  } catch {
    throw new AgentActionError("invalid_code_workspace_preview_path", 400);
  }
}

function encodePreviewPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function contentTypeForPreviewPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html; charset=utf-8";
  }
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function parseNoteActionPayload(
  kind: Phase2ANoteActionKind,
  input: Record<string, unknown>,
): Phase2ANoteActionInput {
  return noteActionInputByKind[kind].parse(input) as Phase2ANoteActionInput;
}

function parseNoteUpdatePayload(input: Record<string, unknown>): NoteUpdateActionInput {
  return noteActionInputByKind["note.update"].parse(input);
}

async function previewNoteUpdateAction(
  input: NoteUpdatePreviewerInput,
  options?: AgentActionServiceOptions,
): Promise<NoteUpdatePreview> {
  const previewer = options?.noteUpdatePreviewer ?? createDrizzleNoteUpdatePreviewer();
  return previewer.preview(input);
}

export function createDrizzleNoteActionExecutor(conn: DB = defaultDb): NoteActionExecutor {
  return {
    async execute(input) {
      switch (input.kind) {
        case "note.create":
          return createNoteFromAction(conn, input);
        case "note.rename":
          return renameNoteFromAction(conn, input);
        case "note.move":
          return moveNoteFromAction(conn, input);
        case "note.delete":
          return deleteNoteFromAction(conn, input);
        case "note.restore":
          return restoreNoteFromAction(conn, input);
      }
    },
  };
}

export function createDrizzleNoteUpdatePreviewer(conn: DB = defaultDb): NoteUpdatePreviewer {
  return {
    async preview(input) {
      const payload = input.payload;
      const [note] = await conn
        .select({
          id: notes.id,
          projectId: notes.projectId,
          workspaceId: notes.workspaceId,
          content: notes.content,
        })
        .from(notes)
        .where(and(eq(notes.id, payload.noteId), eq(notes.projectId, input.projectId), isNull(notes.deletedAt)))
        .limit(1);
      if (!note) throw new AgentActionError("note_not_found", 404);
      if (note.workspaceId !== input.workspaceId) {
        throw new AgentActionError("workspace_scope_mismatch", 409);
      }
      if (!(await canWrite(input.actorUserId, { type: "note", id: payload.noteId }, { db: conn }))) {
        throw new AgentActionError("forbidden", 403);
      }

      const [doc] = await conn
        .select({ state: yjsDocuments.state, stateVector: yjsDocuments.stateVector })
        .from(yjsDocuments)
        .where(eq(yjsDocuments.name, `page:${payload.noteId}`))
        .limit(1);
      if (!doc) throw new AgentActionError("yjs_document_not_found", 409);

      const currentContent = yjsStateToPlateValue(doc.state);
      const draftContent = payload.draft.content;
      return {
        noteId: payload.noteId,
        source: "yjs",
        current: {
          contentText: plateValueToText(currentContent),
          yjsStateVectorBase64: Buffer.from(doc.stateVector).toString("base64"),
        },
        draft: {
          contentText: plateValueToText(draftContent),
        },
        diff: diffPlateValues({
          fromVersion: "current",
          toVersion: "current",
          before: currentContent,
          after: draftContent,
        }),
        applyConstraints: [
          "apply_must_transform_yjs_document",
          "capture_version_before_apply",
          "capture_version_after_apply",
          "reject_if_yjs_state_vector_changed",
          "preserve_plate_node_ids_when_possible",
        ],
      };
    },
  };
}

export function createDrizzleNoteUpdateApplier(conn: DB = defaultDb): NoteUpdateApplier {
  return {
    async apply(input) {
      const payload = input.payload;
      const [note] = await conn
        .select({
          id: notes.id,
          projectId: notes.projectId,
          workspaceId: notes.workspaceId,
          title: notes.title,
        })
        .from(notes)
        .where(and(eq(notes.id, payload.noteId), eq(notes.projectId, input.action.projectId), isNull(notes.deletedAt)))
        .limit(1);
      if (!note) throw new AgentActionError("note_not_found", 404);
      if (note.workspaceId !== input.action.workspaceId) {
        throw new AgentActionError("workspace_scope_mismatch", 409);
      }
      if (!(await canWrite(input.actorUserId, { type: "note", id: payload.noteId }, { db: conn }))) {
        throw new AgentActionError("forbidden", 403);
      }

      const [doc] = await conn
        .select({ state: yjsDocuments.state, stateVector: yjsDocuments.stateVector })
        .from(yjsDocuments)
        .where(eq(yjsDocuments.name, `page:${payload.noteId}`))
        .limit(1);
      if (!doc) throw new AgentActionError("yjs_document_not_found", 409);

      assertExpectedStateVector(input.request.yjsStateVectorBase64, doc.stateVector);

      const currentContent = yjsStateToPlateValue(doc.state);
      const currentText = plateValueToText(currentContent);
      const beforeCapture = await captureNoteVersion({
        database: conn,
        noteId: payload.noteId,
        title: note.title,
        content: currentContent,
        contentText: currentText,
        yjsState: doc.state,
        yjsStateVector: doc.stateVector,
        source: "manual_checkpoint",
        actorType: "agent",
        actorId: input.actorUserId,
        reason: payload.reason ? `pre-agent note.update: ${payload.reason}` : "pre-agent note.update",
        force: true,
      });

      const transformed = transformYjsStateWithPlateValue({
        currentState: doc.state,
        draft: payload.draft.content as PlateValue,
      });
      const appliedContentText = plateValueToText(transformed.plateValue);
      const updatedAt = new Date();

      await conn.transaction(async (tx) => {
        const [lockedDoc] = await tx
          .select({ stateVector: yjsDocuments.stateVector })
          .from(yjsDocuments)
          .where(eq(yjsDocuments.name, `page:${payload.noteId}`))
          .for("update")
          .limit(1);
        if (!lockedDoc) throw new AgentActionError("yjs_document_not_found", 409);
        assertExpectedStateVector(input.request.yjsStateVectorBase64, lockedDoc.stateVector);

        await tx
          .update(yjsDocuments)
          .set({
            state: transformed.state,
            stateVector: transformed.stateVector,
            sizeBytes: transformed.state.byteLength,
            updatedAt,
          })
          .where(eq(yjsDocuments.name, `page:${payload.noteId}`));
        await tx
          .update(notes)
          .set({
            content: transformed.plateValue,
            contentText: appliedContentText,
            updatedAt,
          })
          .where(eq(notes.id, payload.noteId));
        await syncWikiLinks(
          tx,
          payload.noteId,
          extractWikiLinkTargets(transformed.plateValue),
          note.workspaceId,
        );
      });

      const afterCapture = await captureNoteVersion({
        database: conn,
        noteId: payload.noteId,
        title: note.title,
        content: transformed.plateValue,
        contentText: appliedContentText,
        yjsState: transformed.state,
        yjsStateVector: transformed.stateVector,
        source: "ai_edit",
        actorType: "agent",
        actorId: input.actorUserId,
        reason: payload.reason ?? "agent note.update applied",
        force: true,
      });

      const preview = noteUpdatePreviewSchema.parse(input.action.preview);
      return {
        ok: true,
        noteId: payload.noteId,
        applied: {
          source: "yjs",
          yjsStateVectorBase64: Buffer.from(transformed.stateVector).toString("base64"),
          contentText: appliedContentText,
        },
        versionCapture: {
          before: beforeCapture,
          after: afterCapture,
        },
        summary: {
          changedBlocks: preview.diff.summary.changedBlocks,
          addedWords: preview.diff.summary.addedWords,
          removedWords: preview.diff.summary.removedWords,
        },
      };
    },
  };
}

function assertExpectedStateVector(expectedBase64: string, actual: Uint8Array): void {
  const expected = Buffer.from(expectedBase64, "base64");
  if (
    expected.byteLength !== actual.byteLength ||
    !Buffer.from(actual).equals(expected)
  ) {
    throw new AgentActionError("note_update_stale_preview", 409);
  }
}

async function createNoteFromAction(
  conn: DB,
  input: NoteActionExecutorInput,
): Promise<Record<string, unknown>> {
  if (!(await canWrite(input.actorUserId, { type: "project", id: input.projectId }, { db: conn }))) {
    throw new AgentActionError("forbidden", 403);
  }
  const payload = input.payload as NoteCreateActionInput;
  if (payload.folderId) {
    const [folder] = await conn
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, payload.folderId), eq(folders.projectId, input.projectId)));
    if (!folder) throw new AgentActionError("folder_not_found", 404);
  }
  const [note] = await conn
    .insert(notes)
    .values({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      folderId: payload.folderId,
      title: payload.title,
      content: null,
      contentText: "",
      type: "note",
      sourceType: "manual",
    })
    .returning({
      id: notes.id,
      projectId: notes.projectId,
      folderId: notes.folderId,
      title: notes.title,
    });
  if (!note) throw new AgentActionError("note_create_failed", 409);

  emitTreeEvent({
    kind: "tree.note_created",
    projectId: note.projectId,
    id: note.id,
    parentId: note.folderId,
    label: note.title,
    at: new Date().toISOString(),
  });
  return { ok: true, note };
}

async function renameNoteFromAction(
  conn: DB,
  input: NoteActionExecutorInput,
): Promise<Record<string, unknown>> {
  const payload = input.payload as NoteRenameActionInput;
  if (!(await canWrite(input.actorUserId, { type: "note", id: payload.noteId }, { db: conn }))) {
    throw new AgentActionError("forbidden", 403);
  }
  const [note] = await conn
    .update(notes)
    .set({ title: payload.title })
    .where(and(eq(notes.id, payload.noteId), eq(notes.projectId, input.projectId), isNull(notes.deletedAt)))
    .returning({
      id: notes.id,
      projectId: notes.projectId,
      folderId: notes.folderId,
      title: notes.title,
    });
  if (!note) throw new AgentActionError("note_not_found", 404);

  emitTreeEvent({
    kind: "tree.note_renamed",
    projectId: note.projectId,
    id: note.id,
    parentId: note.folderId,
    label: note.title,
    at: new Date().toISOString(),
  });
  return { ok: true, note };
}

async function moveNoteFromAction(
  conn: DB,
  input: NoteActionExecutorInput,
): Promise<Record<string, unknown>> {
  const payload = input.payload as NoteMoveActionInput;
  if (!(await canWrite(input.actorUserId, { type: "note", id: payload.noteId }, { db: conn }))) {
    throw new AgentActionError("forbidden", 403);
  }
  if (payload.folderId) {
    const [folder] = await conn
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, payload.folderId), eq(folders.projectId, input.projectId)));
    if (!folder) throw new AgentActionError("folder_not_found", 404);
  }
  const [note] = await conn
    .update(notes)
    .set({ folderId: payload.folderId })
    .where(and(eq(notes.id, payload.noteId), eq(notes.projectId, input.projectId), isNull(notes.deletedAt)))
    .returning({
      id: notes.id,
      projectId: notes.projectId,
      folderId: notes.folderId,
    });
  if (!note) throw new AgentActionError("note_not_found", 404);

  emitTreeEvent({
    kind: "tree.note_moved",
    projectId: note.projectId,
    id: note.id,
    parentId: note.folderId,
    at: new Date().toISOString(),
  });
  return { ok: true, note };
}

async function deleteNoteFromAction(
  conn: DB,
  input: NoteActionExecutorInput,
): Promise<Record<string, unknown>> {
  const payload = input.payload as NoteDeleteActionInput;
  if (!(await canWrite(input.actorUserId, { type: "note", id: payload.noteId }, { db: conn }))) {
    throw new AgentActionError("forbidden", 403);
  }
  const [note] = await conn
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, payload.noteId), eq(notes.projectId, input.projectId), isNull(notes.deletedAt)))
    .returning({
      id: notes.id,
      projectId: notes.projectId,
      folderId: notes.folderId,
      deletedAt: notes.deletedAt,
    });
  if (!note) throw new AgentActionError("note_not_found", 404);

  emitTreeEvent({
    kind: "tree.note_deleted",
    projectId: note.projectId,
    id: note.id,
    parentId: note.folderId,
    at: new Date().toISOString(),
  });
  return {
    ok: true,
    note: {
      id: note.id,
      projectId: note.projectId,
      folderId: note.folderId,
      deletedAt: note.deletedAt?.toISOString() ?? null,
    },
  };
}

async function restoreNoteFromAction(
  conn: DB,
  input: NoteActionExecutorInput,
): Promise<Record<string, unknown>> {
  const payload = input.payload as NoteRestoreActionInput;
  const [current] = await conn
    .select({
      id: notes.id,
      projectId: notes.projectId,
      folderId: notes.folderId,
      title: notes.title,
    })
    .from(notes)
    .where(and(eq(notes.id, payload.noteId), eq(notes.projectId, input.projectId), isNotNull(notes.deletedAt)));
  if (!current) throw new AgentActionError("note_not_found", 404);
  if (!(await canWrite(input.actorUserId, { type: "project", id: current.projectId }, { db: conn }))) {
    throw new AgentActionError("forbidden", 403);
  }

  const [note] = await conn
    .update(notes)
    .set({ deletedAt: null })
    .where(and(eq(notes.id, payload.noteId), eq(notes.projectId, input.projectId), isNotNull(notes.deletedAt)))
    .returning({
      id: notes.id,
      projectId: notes.projectId,
      folderId: notes.folderId,
      title: notes.title,
    });
  if (!note) throw new AgentActionError("note_not_found", 404);

  emitTreeEvent({
    kind: "tree.note_restored",
    projectId: note.projectId,
    id: note.id,
    parentId: note.folderId,
    label: note.title,
    at: new Date().toISOString(),
  });
  return { ok: true, note };
}

function placeholderPreview(input: Record<string, unknown>): Record<string, unknown> {
  return {
    summary: "Records a low-risk placeholder action without mutating project objects.",
    input,
  };
}

function placeholderResult(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: true,
    placeholder: true,
    input,
  };
}

function toAgentAction(row: AgentActionRow): AgentAction {
  return {
    id: row.id,
    requestId: row.requestId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    actorUserId: row.actorUserId,
    sourceRunId: row.sourceRunId,
    kind: row.kind as AgentActionKind,
    status: row.status,
    risk: row.risk,
    input: row.input,
    preview: row.preview ?? null,
    result: row.result ?? null,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
