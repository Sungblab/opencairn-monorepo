import {
  agentActions,
  and,
  db as defaultDb,
  desc,
  eq,
  projects,
  type AgentActionRow,
  type DB,
} from "@opencairn/db";
import type {
  AgentAction,
  AgentActionKind,
  AgentActionRisk,
  AgentActionStatus,
  CreateAgentActionRequest,
  TransitionAgentActionStatusRequest,
} from "@opencairn/shared";
import { randomUUID } from "node:crypto";
import { canWrite } from "./permissions";

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
  }): Promise<AgentAction>;
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
      if (inserted) return toAgentAction(inserted);

      const existing = await this.findByRequestId(
        values.projectId,
        values.actorUserId,
        values.requestId,
      );
      if (!existing) {
        throw new AgentActionError("idempotency_conflict", 409);
      }
      return existing;
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
  const action = await repo.insert({
    requestId,
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    sourceRunId: request.sourceRunId ?? null,
    kind: request.kind,
    status: placeholder ? "completed" : initialStatusForRisk(request.risk),
    risk: request.risk,
    input: request.input ?? {},
    preview: request.preview ?? (placeholder ? placeholderPreview(request.input ?? {}) : null),
    result: placeholder ? placeholderResult(request.input ?? {}) : null,
    errorCode: null,
  });
  return { action, idempotent: false };
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
