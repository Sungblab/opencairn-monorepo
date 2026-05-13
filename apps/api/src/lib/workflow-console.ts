import {
  agentActions,
  agentRuns,
  and,
  chatMessages,
  chatRunEvents,
  chatRuns,
  db as defaultDb,
  desc,
  eq,
  inArray,
  importJobs,
  llmUsageEvents,
  projects,
  sql,
  synthesisDocuments,
  synthesisRuns,
  type DB,
} from "@opencairn/db";
import {
  workflowConsoleRunFromAgentAction,
  workflowConsoleRunFromAgenticPlan,
  workflowConsoleRunFromChatRun,
  workflowConsoleRunFromImportJob,
  workflowConsoleRunFromPlan8AgentRun,
  workflowConsoleRunFromSynthesisExportRun,
  type AgentAction,
  type AgenticPlanProjectionSource,
  type ChatRunProjectionSource,
  type ImportJobProjectionSource,
  type Plan8AgentRunProjectionSource,
  type SynthesisExportRunProjectionSource,
  type WorkflowConsoleRun,
  type WorkflowConsoleStatus,
} from "@opencairn/shared";
import {
  createDrizzleAgenticPlanRepository,
  getAgenticPlan,
  listAgenticPlans,
} from "./agentic-plans";

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
  listAgenticPlansByProject(options: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<AgenticPlanProjectionSource[]>;
  listPlan8RunsByProject(options: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<Plan8AgentRunProjectionSource[]>;
  listImportJobsByProject(options: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<ImportJobProjectionSource[]>;
  listSynthesisExportRunsByProject(options: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<SynthesisExportRunProjectionSource[]>;
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
  getAgenticPlanById(options: {
    planId: string;
    projectId: string;
    userId: string;
  }): Promise<AgenticPlanProjectionSource | null>;
  getPlan8RunById(options: {
    runId: string;
    projectId: string;
    userId: string;
  }): Promise<Plan8AgentRunProjectionSource | null>;
  getImportJobById(options: {
    jobId: string;
    projectId: string;
    userId: string;
  }): Promise<ImportJobProjectionSource | null>;
  getSynthesisExportRunById(options: {
    runId: string;
    projectId: string;
    userId: string;
  }): Promise<SynthesisExportRunProjectionSource | null>;
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
      const projectChipScope = JSON.stringify({
        chips: [{ type: "project", id: projectId }],
      });
      const rows = await conn
        .select()
        .from(chatRuns)
        .where(
          and(
            eq(chatRuns.workspaceId, scope.workspaceId),
            eq(chatRuns.userId, userId),
            sql`(${chatRuns.scope}->>'projectId' = ${projectId} OR ${chatRuns.scope}->'manifest'->>'projectId' = ${projectId} OR (${chatRuns.scope}->>'type' = 'project' AND ${chatRuns.scope}->>'id' = ${projectId}) OR ${chatRuns.scope} @> ${projectChipScope}::jsonb)`,
          ),
        )
        .orderBy(desc(chatRuns.createdAt))
        .limit(limit);
      return Promise.all(
        rows
          .slice(0, limit)
          .map((row) => toChatRunProjection(conn, row, projectId)),
      );
    },
    async listAgentActionsByProject({ projectId, userId, limit }) {
      const rows = await conn
        .select()
        .from(agentActions)
        .where(and(eq(agentActions.projectId, projectId), eq(agentActions.actorUserId, userId)))
        .orderBy(desc(agentActions.createdAt))
        .limit(limit);
      return rows.map(toAgentActionProjection);
    },
    async listAgenticPlansByProject({ projectId, userId, limit }) {
      const repo = createDrizzleAgenticPlanRepository(conn);
      return listAgenticPlans(projectId, userId, { limit }, {
        repo,
        canReadProject: async () => true,
      });
    },
    async listPlan8RunsByProject({ projectId, userId, limit }) {
      const rows = await conn
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.userId, userId)))
        .orderBy(desc(agentRuns.startedAt))
        .limit(limit);
      return rows.map(toPlan8RunProjection);
    },
    async listImportJobsByProject({ projectId, userId, limit }) {
      const rows = await conn
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.targetProjectId, projectId), eq(importJobs.userId, userId)))
        .orderBy(desc(importJobs.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        projectId,
        userId: row.userId,
        source: row.source,
        workflowId: row.workflowId,
        status: row.status,
        totalItems: row.totalItems,
        completedItems: row.completedItems,
        failedItems: row.failedItems,
        sourceMetadata: row.sourceMetadata as Record<string, unknown>,
        errorSummary: row.errorSummary,
        createdAt: row.createdAt,
        updatedAt: row.finishedAt ?? row.createdAt,
        completedAt: row.finishedAt,
      }));
    },
    async listSynthesisExportRunsByProject({ projectId, userId, limit }) {
      const rows = await conn
        .select()
        .from(synthesisRuns)
        .where(and(eq(synthesisRuns.projectId, projectId), eq(synthesisRuns.userId, userId)))
        .orderBy(desc(synthesisRuns.createdAt))
        .limit(limit);
      return hydrateSynthesisRuns(conn, rows.map((row) => ({
        runId: row.id,
        workspaceId: row.workspaceId,
        projectId,
        userId: row.userId,
        workflowId: row.workflowId,
        status: row.status,
        format: row.format,
        template: row.template,
        userPrompt: row.userPrompt,
        tokensUsed: row.tokensUsed,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })));
    },
    async getChatRunById({ runId, projectId, userId }) {
      const [row] = await conn
        .select()
        .from(chatRuns)
        .where(and(eq(chatRuns.id, runId), eq(chatRuns.userId, userId)))
        .limit(1);
      if (!row || extractProjectIdFromScope(row.scope) !== projectId) return null;
      return toChatRunProjection(conn, row, projectId);
    },
    async getAgentActionById({ actionId, projectId, userId }) {
      const [row] = await conn
        .select()
        .from(agentActions)
        .where(
          and(
            eq(agentActions.id, actionId),
            eq(agentActions.projectId, projectId),
            eq(agentActions.actorUserId, userId),
          ),
        )
        .limit(1);
      return row ? toAgentActionProjection(row) : null;
    },
    async getAgenticPlanById({ planId, projectId, userId }) {
      const repo = createDrizzleAgenticPlanRepository(conn);
      return getAgenticPlan(projectId, userId, planId, {
        repo,
        canReadProject: async () => true,
      });
    },
    async getPlan8RunById({ runId, projectId, userId }) {
      const [row] = await conn
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.runId, runId),
            eq(agentRuns.projectId, projectId),
            eq(agentRuns.userId, userId),
          ),
        )
        .limit(1);
      return row ? toPlan8RunProjection(row) : null;
    },
    async getImportJobById({ jobId, projectId, userId }) {
      const [row] = await conn
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.id, jobId), eq(importJobs.targetProjectId, projectId), eq(importJobs.userId, userId)))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        projectId,
        userId: row.userId,
        source: row.source,
        workflowId: row.workflowId,
        status: row.status,
        totalItems: row.totalItems,
        completedItems: row.completedItems,
        failedItems: row.failedItems,
        sourceMetadata: row.sourceMetadata as Record<string, unknown>,
        errorSummary: row.errorSummary,
        createdAt: row.createdAt,
        updatedAt: row.finishedAt ?? row.createdAt,
        completedAt: row.finishedAt,
      };
    },
    async getSynthesisExportRunById({ runId, projectId, userId }) {
      const [row] = await conn
        .select()
        .from(synthesisRuns)
        .where(and(eq(synthesisRuns.id, runId), eq(synthesisRuns.projectId, projectId), eq(synthesisRuns.userId, userId)))
        .limit(1);
      if (!row) return null;
      const [hydrated] = await hydrateSynthesisRuns(conn, [{
        runId: row.id,
        workspaceId: row.workspaceId,
        projectId,
        userId: row.userId,
        workflowId: row.workflowId,
        status: row.status,
        format: row.format,
        template: row.template,
        userPrompt: row.userPrompt,
        tokensUsed: row.tokensUsed,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }]);
      return hydrated ?? null;
    },
  };
}

async function toChatRunProjection(
  conn: DB,
  row: typeof chatRuns.$inferSelect,
  projectId: string,
): Promise<ChatRunProjectionSource> {
  const metadata = await loadChatRunOperationalMetadata(conn, row);
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
    memory: metadata.memory,
    runtime: metadata.runtime,
    cost: metadata.cost,
    partialOutput: metadata.partialOutput,
    createdAt: row.createdAt,
    updatedAt: row.completedAt ?? row.startedAt ?? row.createdAt,
    completedAt: row.completedAt,
  };
}

async function loadChatRunOperationalMetadata(
  conn: DB,
  row: typeof chatRuns.$inferSelect,
): Promise<Pick<ChatRunProjectionSource, "memory" | "runtime" | "cost" | "partialOutput">> {
  const memoryEvents = await conn
    .select({ payload: chatRunEvents.payload })
    .from(chatRunEvents)
    .where(and(eq(chatRunEvents.runId, row.id), eq(chatRunEvents.event, "status")))
    .orderBy(desc(chatRunEvents.seq))
    .limit(20);
  const memory =
    memoryEvents
      .map((event) => memoryFromStatusPayload(event.payload))
      .find((item) => item !== null) ?? null;
  const runtime =
    memoryEvents
      .map((event) => runtimeFromStatusPayload(event.payload))
      .find((item) => item !== null) ?? null;
  const cost = await loadChatRunUsageCost(conn, row.id);

  if (row.status !== "failed") {
    return { memory, runtime, cost, partialOutput: null };
  }
  const [message] = await conn
    .select({ content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.id, row.agentMessageId))
    .limit(1);
  const body = bodyFromMessageContent(message?.content);
  const normalized = body.trim();
  return {
    memory,
    runtime,
    cost,
    partialOutput: normalized
      ? {
          chars: normalized.length,
          preview: normalized.slice(0, 240),
          retryable: true,
          attempt: row.currentAttempt,
        }
      : null,
  };
}

async function loadChatRunUsageCost(
  conn: DB,
  runId: string,
): Promise<ChatRunProjectionSource["cost"]> {
  const [usage] = await conn
    .select({
      provider: llmUsageEvents.provider,
      model: llmUsageEvents.model,
      tokensIn: llmUsageEvents.tokensIn,
      tokensOut: llmUsageEvents.tokensOut,
      cachedTokens: llmUsageEvents.cachedTokens,
      costKrw: llmUsageEvents.costKrw,
    })
    .from(llmUsageEvents)
    .where(
      and(
        eq(llmUsageEvents.sourceType, "chat_run"),
        eq(llmUsageEvents.sourceId, runId),
      ),
    )
    .orderBy(desc(llmUsageEvents.createdAt))
    .limit(1);
  if (!usage) return null;
  return {
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.tokensIn,
    outputTokens: usage.tokensOut,
    cachedTokens: usage.cachedTokens,
    krw: Math.round(Number(usage.costKrw)),
  };
}

function runtimeFromStatusPayload(
  payload: unknown,
): ChatRunProjectionSource["runtime"] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.kind !== "runtime_context") return null;
  return {
    executionClass:
      typeof record.executionClass === "string"
        ? record.executionClass
        : "durable_run",
    chatMode: typeof record.chatMode === "string" ? record.chatMode : undefined,
    ragMode: typeof record.ragMode === "string" ? record.ragMode : undefined,
    memoryPolicy:
      typeof record.memoryPolicy === "string" ? record.memoryPolicy : undefined,
  };
}

function memoryFromStatusPayload(
  payload: unknown,
): ChatRunProjectionSource["memory"] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.kind !== "memory_context") return null;
  return {
    memoryPolicy:
      typeof record.memoryPolicy === "string" ? record.memoryPolicy : "auto",
    memoryIncluded: record.memoryIncluded === true,
    scopesUsed: Array.isArray(record.scopesUsed)
      ? record.scopesUsed.filter((scope): scope is string => typeof scope === "string")
      : [],
  };
}

function bodyFromMessageContent(content: unknown): string {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return "";
  }
  const body = (content as Record<string, unknown>).body;
  return typeof body === "string" ? body : "";
}

function toAgentActionProjection(row: typeof agentActions.$inferSelect): AgentAction {
  return {
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
  };
}

function toPlan8RunProjection(
  row: typeof agentRuns.$inferSelect,
): Plan8AgentRunProjectionSource {
  return {
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
  };
}

export async function listWorkflowConsoleRuns(
  projectId: string,
  userId: string,
  options?: WorkflowConsoleServiceOptions & {
    limit?: number;
    status?: WorkflowConsoleStatus;
    q?: string;
  },
): Promise<WorkflowConsoleRun[]> {
  const repo = options?.repo ?? createDrizzleWorkflowConsoleRepository();
  await assertCanReadProject(projectId, userId, repo, options);
  const limit = options?.limit ?? 50;
  const hasPostProjectionFilter = Boolean(options?.status || options?.q);
  const repoLimit = hasPostProjectionFilter ? Math.max(limit * 4, limit) : limit;
  const [chat, actions, plans, plan8, imports, exports] = await Promise.all([
    repo.listChatRunsByProject({ projectId, userId, limit: repoLimit }),
    repo.listAgentActionsByProject({ projectId, userId, limit: repoLimit }),
    repo.listAgenticPlansByProject({ projectId, userId, limit: repoLimit }),
    repo.listPlan8RunsByProject({ projectId, userId, limit: repoLimit }),
    repo.listImportJobsByProject({ projectId, userId, limit: repoLimit }),
    repo.listSynthesisExportRunsByProject({ projectId, userId, limit: repoLimit }),
  ]);
  return [
    ...exports.map(workflowConsoleRunFromSynthesisExportRun),
    ...imports.map(workflowConsoleRunFromImportJob),
    ...plans.map(workflowConsoleRunFromAgenticPlan),
    ...actions.map(workflowConsoleRunFromAgentAction),
    ...chat.map(workflowConsoleRunFromChatRun),
    ...plan8.map(workflowConsoleRunFromPlan8AgentRun),
  ]
    .filter((run) => run.projectId === projectId)
    .filter((run) => !options?.status || run.status === options.status)
    .filter((run) => !options?.q || workflowConsoleRunMatchesQuery(run, options.q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

function workflowConsoleRunMatchesQuery(run: WorkflowConsoleRun, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const fields = [
    run.runId,
    run.workGroupId,
    run.sourceId,
    run.sourceStatus,
    run.runType,
    run.agentRole,
    run.title,
    run.error?.code,
    run.error?.message,
    ...run.outputs.flatMap((output) => [
      output.id,
      output.label,
      output.outputType,
      output.url,
      ...Object.values(output.metadata ?? {}),
    ]),
  ];
  return fields.some((value) =>
    typeof value === "string" && value.toLowerCase().includes(needle),
  );
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
  if (parsed.type === "agentic_plan") {
    const row = await repo.getAgenticPlanById({
      planId: parsed.id,
      projectId,
      userId,
    });
    if (!row || row.projectId !== projectId) {
      throw new WorkflowConsoleError("run_not_found", 404);
    }
    return workflowConsoleRunFromAgenticPlan(row);
  }
  if (parsed.type === "plan8_agent") {
    const row = await repo.getPlan8RunById({ runId: parsed.id, projectId, userId });
    if (!row || row.projectId !== projectId) {
      throw new WorkflowConsoleError("run_not_found", 404);
    }
    return workflowConsoleRunFromPlan8AgentRun(row);
  }
  if (parsed.type === "import") {
    const row = await repo.getImportJobById({ jobId: parsed.id, projectId, userId });
    if (!row || row.projectId !== projectId) {
      throw new WorkflowConsoleError("run_not_found", 404);
    }
    return workflowConsoleRunFromImportJob(row);
  }
  if (parsed.type === "export") {
    const row = await repo.getSynthesisExportRunById({ runId: parsed.id, projectId, userId });
    if (!row || row.projectId !== projectId) {
      throw new WorkflowConsoleError("run_not_found", 404);
    }
    return workflowConsoleRunFromSynthesisExportRun(row);
  }
  throw new WorkflowConsoleError("run_not_found", 404);
}

async function hydrateSynthesisRuns(
  conn: DB,
  runs: Array<Omit<SynthesisExportRunProjectionSource, "documents">>,
): Promise<SynthesisExportRunProjectionSource[]> {
  if (runs.length === 0) return [];
  const rows = await conn
    .select()
    .from(synthesisDocuments)
    .where(inArray(synthesisDocuments.runId, runs.map((run) => run.runId)))
    .orderBy(desc(synthesisDocuments.createdAt));
  const docsByRunId = new Map<string, SynthesisExportRunProjectionSource["documents"]>();
  for (const row of rows) {
    const documents = docsByRunId.get(row.runId) ?? [];
    documents.push({
      id: row.id,
      format: row.format,
      bytes: row.bytes,
      url: `/api/synthesis-export/runs/${row.runId}/document`,
    });
    docsByRunId.set(row.runId, documents);
  }
  return runs.map((run) => ({
    ...run,
    documents: docsByRunId.get(run.runId) ?? [],
  }));
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
  if (
    record.manifest &&
    typeof record.manifest === "object" &&
    !Array.isArray(record.manifest) &&
    typeof (record.manifest as Record<string, unknown>).projectId === "string"
  ) {
    return (record.manifest as Record<string, string>).projectId;
  }
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
