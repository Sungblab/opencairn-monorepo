import {
  agentActions,
  and,
  db as defaultDb,
  desc,
  eq,
  folders,
  isNotNull,
  isNull,
  notes,
  projects,
  type AgentActionRow,
  type DB,
} from "@opencairn/db";
import { noteActionInputByKind } from "@opencairn/shared";
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
  Phase2ANoteActionKind,
  Phase2ANoteActionInput,
  TransitionAgentActionStatusRequest,
} from "@opencairn/shared";
import { randomUUID } from "node:crypto";
import { canWrite } from "./permissions";
import { emitTreeEvent } from "./tree-events";

export class AgentActionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409,
    message = code,
  ) {
    super(message);
  }
}

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
  noteExecutor?: NoteActionExecutor;
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
  const { action, inserted } = await repo.insert({
    requestId,
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    sourceRunId: request.sourceRunId ?? null,
    kind: request.kind,
    status: placeholder ? "completed" : executableNoteAction ? "running" : initialStatusForRisk(request.risk),
    risk: request.risk,
    input: request.input ?? {},
    preview: request.preview ?? (placeholder ? placeholderPreview(request.input ?? {}) : null),
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
  return { action, idempotent: false };
}

export const executeAgentAction = createAgentAction;

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

function parseNoteActionPayload(
  kind: Phase2ANoteActionKind,
  input: Record<string, unknown>,
): Phase2ANoteActionInput {
  return noteActionInputByKind[kind].parse(input) as Phase2ANoteActionInput;
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
