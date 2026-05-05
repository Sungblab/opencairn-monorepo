import {
  agentActions,
  agentRuns,
  and,
  chatRuns,
  db as defaultDb,
  desc,
  eq,
  projects,
  type DB,
} from "@opencairn/db";
import {
  workflowConsoleRunFromAgentAction,
  workflowConsoleRunFromChatRun,
  workflowConsoleRunFromPlan8AgentRun,
  type AgentAction,
  type ChatRunProjectionSource,
  type Plan8AgentRunProjectionSource,
  type WorkflowConsoleRun,
} from "@opencairn/shared";

export interface WorkflowConsoleRepository {
  findProjectScope(projectId: string): Promise<{ workspaceId: string } | null>;
  listChatRunsByProject(options: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<ChatRunProjectionSource[]>;
  listAgentActionsByProject(options: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<AgentAction[]>;
  listPlan8RunsByProject(options: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<Plan8AgentRunProjectionSource[]>;
  getChatRunById(options: {
    runId: string;
    projectId: string;
    userId: string;
  }): Promise<ChatRunProjectionSource | null>;
  getAgentActionById(options: {
    actionId: string;
    projectId: string;
    userId: string;
  }): Promise<AgentAction | null>;
  getPlan8RunById(options: {
    runId: string;
    projectId: string;
    userId: string;
  }): Promise<Plan8AgentRunProjectionSource | null>;
}

export interface WorkflowConsoleServiceOptions {
  repo?: WorkflowConsoleRepository;
  canReadProject?: (userId: string, projectId: string) => Promise<boolean>;
}

export class WorkflowConsoleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404,
    message = code,
  ) {
    super(message);
  }
}

export function createDrizzleWorkflowConsoleRepository(
  conn: DB = defaultDb,
): WorkflowConsoleRepository {
  return {
    async findProjectScope(projectId) {
      const [project] = await conn
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      return project ?? null;
    },
    async listChatRunsByProject({ projectId, userId, limit }) {
      const scope = await this.findProjectScope(projectId);
      if (!scope) return [];
      const rows = await conn
        .select()
        .from(chatRuns)
        .where(and(eq(chatRuns.workspaceId, scope.workspaceId), eq(chatRuns.userId, userId)))
        .orderBy(desc(chatRuns.createdAt))
        .limit(Math.max(limit * 4, limit));
      return rows
        .filter((row) => extractProjectIdFromScope(row.scope) === projectId)
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          threadId: row.threadId,
          userMessageId: row.userMessageId,
          agentMessageId: row.agentMessageId,
          workspaceId: row.workspaceId,
          projectId,
          userId: row.userId,
          workflowId: row.workflowId,
          status: row.status,
          mode: row.mode,
          error: row.error,
          createdAt: row.createdAt,
          updatedAt: row.completedAt ?? row.startedAt ?? row.createdAt,
          completedAt: row.completedAt,
        }));
    },
    async listAgentActionsByProject({ projectId, userId, limit }) {
      const rows = await conn
        .select()
        .from(agentActions)
        .where(and(eq(agentActions.projectId, projectId), eq(agentActions.actorUserId, userId)))
        .orderBy(desc(agentActions.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        requestId: row.requestId,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        actorUserId: row.actorUserId,
        sourceRunId: row.sourceRunId,
        kind: row.kind,
        status: row.status,
        risk: row.risk,
        input: row.input,
        preview: row.preview ?? null,
        result: row.result ?? null,
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
    async listPlan8RunsByProject({ projectId, userId, limit }) {
      const rows = await conn
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.userId, userId)))
        .orderBy(desc(agentRuns.startedAt))
        .limit(limit);
      return rows.map((row) => ({
        runId: row.runId,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        userId: row.userId,
        agentName: row.agentName,
        workflowId: row.workflowId,
        status: row.status,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        totalCostKrw: row.totalCostKrw,
        errorMessage: row.errorMessage,
      }));
    },
    async getChatRunById({ runId, projectId, userId }) {
      const [row] = await conn
        .select()
        .from(chatRuns)
        .where(and(eq(chatRuns.id, runId), eq(chatRuns.userId, userId)))
        .limit(1);
      if (!row || extractProjectIdFromScope(row.scope) !== projectId) return null;
      return {
        id: row.id,
        threadId: row.threadId,
        userMessageId: row.userMessageId,
        agentMessageId: row.agentMessageId,
        workspaceId: row.workspaceId,
        projectId,
        userId: row.userId,
        workflowId: row.workflowId,
        status: row.status,
        mode: row.mode,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.completedAt ?? row.startedAt ?? row.createdAt,
        completedAt: row.completedAt,
      };
    },
    async getAgentActionById({ actionId, projectId, userId }) {
      const rows = await this.listAgentActionsByProject({ projectId, userId, limit: 200 });
      return rows.find((row) => row.id === actionId) ?? null;
    },
    async getPlan8RunById({ runId, projectId, userId }) {
      const rows = await this.listPlan8RunsByProject({ projectId, userId, limit: 200 });
      return rows.find((row) => row.runId === runId) ?? null;
    },
  };
}

export async function listWorkflowConsoleRuns(
  projectId: string,
  userId: string,
  options?: WorkflowConsoleServiceOptions & { limit?: number },
): Promise<WorkflowConsoleRun[]> {
  const repo = options?.repo ?? createDrizzleWorkflowConsoleRepository();
  await assertCanReadProject(projectId, userId, repo, options);
  const limit = options?.limit ?? 50;
  const [chat, actions, plan8] = await Promise.all([
    repo.listChatRunsByProject({ projectId, userId, limit }),
    repo.listAgentActionsByProject({ projectId, userId, limit }),
    repo.listPlan8RunsByProject({ projectId, userId, limit }),
  ]);
  return [
    ...actions.map(workflowConsoleRunFromAgentAction),
    ...chat.map(workflowConsoleRunFromChatRun),
    ...plan8.map(workflowConsoleRunFromPlan8AgentRun),
  ]
    .filter((run) => run.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getWorkflowConsoleRun(
  projectId: string,
  userId: string,
  runId: string,
  options?: WorkflowConsoleServiceOptions,
): Promise<WorkflowConsoleRun> {
  const repo = options?.repo ?? createDrizzleWorkflowConsoleRepository();
  await assertCanReadProject(projectId, userId, repo, options);
  const parsed = parsePrefixedRunId(runId);
  if (!parsed) throw new WorkflowConsoleError("bad_run_id", 400);

  if (parsed.type === "chat") {
    const row = await repo.getChatRunById({ runId: parsed.id, projectId, userId });
    if (!row || row.projectId !== projectId) {
      throw new WorkflowConsoleError("run_not_found", 404);
    }
    return workflowConsoleRunFromChatRun(row);
  }
  if (parsed.type === "agent_action" || parsed.type === "document_generation") {
    const row = await repo.getAgentActionById({
      actionId: parsed.id,
      projectId,
      userId,
    });
    if (!row || row.projectId !== projectId) {
      throw new WorkflowConsoleError("run_not_found", 404);
    }
    return workflowConsoleRunFromAgentAction(row);
  }
  if (parsed.type === "plan8_agent") {
    const row = await repo.getPlan8RunById({ runId: parsed.id, projectId, userId });
    if (!row || row.projectId !== projectId) {
      throw new WorkflowConsoleError("run_not_found", 404);
    }
    return workflowConsoleRunFromPlan8AgentRun(row);
  }
  throw new WorkflowConsoleError("run_not_found", 404);
}

async function assertCanReadProject(
  projectId: string,
  userId: string,
  repo: WorkflowConsoleRepository,
  options?: WorkflowConsoleServiceOptions,
): Promise<void> {
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new WorkflowConsoleError("project_not_found", 404);
  const canReadProject = options?.canReadProject ?? defaultCanReadProject;
  if (!(await canReadProject(userId, projectId))) {
    throw new WorkflowConsoleError("forbidden", 403);
  }
}

async function defaultCanReadProject(userId: string, projectId: string): Promise<boolean> {
  const { canRead } = await import("./permissions");
  return canRead(userId, { type: "project", id: projectId });
}

function parsePrefixedRunId(value: string): { type: string; id: string } | null {
  const index = value.indexOf(":");
  if (index <= 0 || index === value.length - 1) return null;
  return {
    type: value.slice(0, index),
    id: value.slice(index + 1),
  };
}

function extractProjectIdFromScope(scope: unknown): string | null {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const record = scope as Record<string, unknown>;
  if (typeof record.projectId === "string") return record.projectId;
  if (record.type === "project" && typeof record.id === "string") {
    return record.id;
  }
  const chips = Array.isArray(record.chips) ? record.chips : [];
  for (const chip of chips) {
    if (
      chip &&
      typeof chip === "object" &&
      !Array.isArray(chip) &&
      (chip as Record<string, unknown>).type === "project" &&
      typeof (chip as Record<string, unknown>).id === "string"
    ) {
      return (chip as Record<string, string>).id;
    }
  }
  return null;
}
