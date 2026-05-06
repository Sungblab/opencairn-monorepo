import {
  agenticPlanSteps,
  agenticPlans,
  and,
  asc,
  db as defaultDb,
  desc,
  eq,
  projects,
  type AgenticPlanRow,
  type AgenticPlanStepRow,
  type DB,
} from "@opencairn/db";
import type {
  AgentAction,
  AgentActionStatus,
  AgentActionRisk,
  AgenticPlan,
  AgenticPlanStatus,
  AgenticPlanStep,
  AgenticPlanStepKind,
  AgenticPlanStepStatus,
  CreateAgentActionRequest,
  CreateAgenticPlanRequest,
  GenerateProjectObjectAction,
  ProjectObjectAction,
  RecoverAgenticPlanStepRequest,
  StartAgenticPlanRequest,
} from "@opencairn/shared";
import {
  agenticPlanSchema,
  codeWorkspaceCommandRunRequestSchema,
  exportProjectObjectActionSchema,
  generateProjectObjectActionSchema,
  noteUpdateActionInputSchema,
} from "@opencairn/shared";
import {
  AgentActionError,
  createAgentAction,
  createCodeProjectRepairAction,
} from "./agent-actions";
import { requestDocumentGenerationProjectObject } from "./document-generation-actions";
import { requestGoogleWorkspaceExportProjectObject } from "./google-workspace-export-actions";
import {
  ImportRetryError,
  retryImportJob,
} from "./import-retry";
import {
  Plan8AgentRunError,
  plan8AgentRunInputSchema,
  runPlan8Agent,
  type Plan8AgentRunInput,
} from "./plan8-agent-runs";
import { canRead, canWrite } from "./permissions";

export class AgenticPlanError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409,
    message = code,
  ) {
    super(message);
  }
}

type PlannedStepInput = {
  kind: AgenticPlanStepKind;
  title: string;
  rationale: string;
  risk: AgentActionRisk;
  input?: Record<string, unknown>;
};

type ExportProjectObjectAction = Extract<
  ProjectObjectAction,
  { type: "export_project_object" }
>;

export interface AgenticPlanRepository {
  findProjectScope(projectId: string): Promise<{ workspaceId: string } | null>;
  insertPlan(values: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
    title: string;
    goal: string;
    status: AgenticPlanStatus;
    target: Record<string, unknown>;
    plannerKind: "deterministic";
    summary: string;
    currentStepOrdinal: number | null;
    steps: PlannedStepInput[];
  }): Promise<AgenticPlan>;
  listByProject(options: {
    projectId: string;
    status?: AgenticPlanStatus;
    limit: number;
  }): Promise<AgenticPlan[]>;
  findById(options: {
    projectId: string;
    planId: string;
  }): Promise<AgenticPlan | null>;
  updateStepStatus(options: {
    planId: string;
    stepId: string;
    status: AgenticPlanStepStatus;
  }): Promise<void>;
  updateStep(options: {
    planId: string;
    stepId: string;
    status?: AgenticPlanStepStatus;
    linkedRunType?: string | null;
    linkedRunId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<void>;
  appendStep(options: {
    planId: string;
    step: PlannedStepInput & {
      ordinal: number;
      status: AgenticPlanStepStatus;
      errorCode?: string | null;
      errorMessage?: string | null;
    };
  }): Promise<void>;
  updatePlanStatus(options: {
    planId: string;
    status: AgenticPlanStatus;
    currentStepOrdinal: number | null;
    completedAt?: Date | null;
  }): Promise<void>;
}

export interface AgenticPlanServiceOptions {
  repo?: AgenticPlanRepository;
  canReadProject?: (userId: string, projectId: string) => Promise<boolean>;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  createAgentAction?: (
    projectId: string,
    actorUserId: string,
    request: CreateAgentActionRequest,
  ) => Promise<{ action: AgentAction; idempotent: boolean }>;
  createCodeProjectRepairAction?: (
    failedRunActionId: string,
    actorUserId: string,
    request: { requestId?: string },
  ) => Promise<{ action: AgentAction; idempotent: boolean }>;
  requestDocumentGeneration?: (
    projectId: string,
    actorUserId: string,
    request: GenerateProjectObjectAction,
  ) => Promise<{ action: AgentAction }>;
  requestGoogleWorkspaceExport?: (
    projectId: string,
    actorUserId: string,
    request: ExportProjectObjectAction,
  ) => Promise<{ action: AgentAction }>;
  retryImportJob?: (
    failedJobId: string,
    actorUserId: string,
  ) => Promise<{ jobId: string; action: AgentAction | null }>;
  runPlan8Agent?: (
    projectId: string,
    actorUserId: string,
    input: Plan8AgentRunInput,
  ) => Promise<{ runId: string; status: string }>;
}

export function createDrizzleAgenticPlanRepository(conn: DB = defaultDb): AgenticPlanRepository {
  return {
    async findProjectScope(projectId) {
      const [project] = await conn
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId));
      return project ?? null;
    },
    async insertPlan(values) {
      return conn.transaction(async (tx) => {
        const [plan] = await tx
          .insert(agenticPlans)
          .values({
            workspaceId: values.workspaceId,
            projectId: values.projectId,
            actorUserId: values.actorUserId,
            title: values.title,
            goal: values.goal,
            status: values.status,
            target: values.target,
            plannerKind: values.plannerKind,
            summary: values.summary,
            currentStepOrdinal: values.currentStepOrdinal,
          })
          .returning();
        if (!plan) throw new AgenticPlanError("agentic_plan_create_failed", 409);

        if (values.steps.length > 0) {
          await tx.insert(agenticPlanSteps).values(
            values.steps.map((step, index) => ({
              planId: plan.id,
              ordinal: index + 1,
              kind: step.kind,
              title: step.title,
              rationale: step.rationale,
              status: "approval_required" as const,
              risk: step.risk,
              input: step.input ?? {},
            })),
          );
        }

        const rows = await tx
          .select()
          .from(agenticPlanSteps)
          .where(eq(agenticPlanSteps.planId, plan.id))
          .orderBy(asc(agenticPlanSteps.ordinal));
        return toAgenticPlan(plan, rows);
      });
    },
    async listByProject({ projectId, status, limit }) {
      const filters = [
        eq(agenticPlans.projectId, projectId),
        ...(status ? [eq(agenticPlans.status, status)] : []),
      ];
      const rows = await conn
        .select()
        .from(agenticPlans)
        .where(and(...filters))
        .orderBy(desc(agenticPlans.updatedAt))
        .limit(limit);
      return Promise.all(rows.map((row) => hydratePlan(conn, row)));
    },
    async findById({ projectId, planId }) {
      const [row] = await conn
        .select()
        .from(agenticPlans)
        .where(and(eq(agenticPlans.id, planId), eq(agenticPlans.projectId, projectId)));
      return row ? hydratePlan(conn, row) : null;
    },
    async updateStepStatus({ stepId, status }) {
      await conn
        .update(agenticPlanSteps)
        .set({
          status,
          updatedAt: new Date(),
          completedAt: terminalStepStatus(status) ? new Date() : null,
        })
        .where(eq(agenticPlanSteps.id, stepId));
    },
    async updateStep({ stepId, status, linkedRunType, linkedRunId, errorCode, errorMessage }) {
      const values: {
        status?: AgenticPlanStepStatus;
        linkedRunType?: string | null;
        linkedRunId?: string | null;
        errorCode?: string | null;
        errorMessage?: string | null;
        updatedAt: Date;
        completedAt?: Date | null;
      } = {
        updatedAt: new Date(),
      };
      if (status !== undefined) {
        values.status = status;
        values.completedAt = terminalStepStatus(status) ? new Date() : null;
      }
      if (linkedRunType !== undefined) values.linkedRunType = linkedRunType;
      if (linkedRunId !== undefined) values.linkedRunId = linkedRunId;
      if (errorCode !== undefined) values.errorCode = errorCode;
      if (errorMessage !== undefined) values.errorMessage = errorMessage;

      await conn
        .update(agenticPlanSteps)
        .set(values)
        .where(eq(agenticPlanSteps.id, stepId));
    },
    async appendStep({ planId, step }) {
      await conn.insert(agenticPlanSteps).values({
        planId,
        ordinal: step.ordinal,
        kind: step.kind,
        title: step.title,
        rationale: step.rationale,
        status: step.status,
        risk: step.risk,
        input: step.input ?? {},
        errorCode: step.errorCode ?? null,
        errorMessage: step.errorMessage ?? null,
      });
    },
    async updatePlanStatus({ planId, status, currentStepOrdinal, completedAt }) {
      await conn
        .update(agenticPlans)
        .set({
          status,
          currentStepOrdinal,
          completedAt: completedAt ?? null,
          updatedAt: new Date(),
        })
        .where(eq(agenticPlans.id, planId));
    },
  };
}

export async function createAgenticPlan(
  projectId: string,
  actorUserId: string,
  request: CreateAgenticPlanRequest,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan> {
  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new AgenticPlanError("project_not_found", 404);

  if (!(await canWriteProject(actorUserId, projectId, options))) {
    throw new AgenticPlanError("forbidden", 403);
  }

  const steps = planStepsForGoal(request.goal, request.target ?? {});
  return repo.insertPlan({
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    title: request.title ?? titleFromGoal(request.goal),
    goal: request.goal,
    status: "approval_required",
    target: {
      workspaceId: scope.workspaceId,
      projectId,
      ...(request.target ?? {}),
    },
    plannerKind: "deterministic",
    summary: summaryForSteps(steps),
    currentStepOrdinal: 1,
    steps,
  });
}

export async function listAgenticPlans(
  projectId: string,
  actorUserId: string,
  query: { status?: AgenticPlanStatus; limit: number },
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan[]> {
  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new AgenticPlanError("project_not_found", 404);
  if (!(await canReadProject(actorUserId, projectId, options))) {
    throw new AgenticPlanError("forbidden", 403);
  }
  return repo.listByProject({ projectId, ...query });
}

export async function getAgenticPlan(
  projectId: string,
  actorUserId: string,
  planId: string,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan> {
  const plan = await getReadablePlan(projectId, actorUserId, planId, options);
  return plan;
}

export async function startAgenticPlan(
  projectId: string,
  actorUserId: string,
  planId: string,
  request: StartAgenticPlanRequest,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan> {
  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  const plan = await getWritablePlan(projectId, actorUserId, planId, options);
  const requestedStepId = request?.stepId;
  const steps = requestedStepId
    ? plan.steps.filter((step) => step.id === requestedStepId)
    : plan.steps.filter((step) => step.status === "approval_required");
  if (requestedStepId && steps.length === 0) {
    throw new AgenticPlanError("agentic_plan_step_not_found", 404);
  }

  for (const step of steps) {
    if (step.linkedRunId) continue;
    const materialized = await materializeStep(projectId, actorUserId, plan, step, options);
    if (materialized.kind === "blocked") {
      await repo.updateStep({
        planId,
        stepId: step.id,
        status: "blocked",
        linkedRunType: null,
        linkedRunId: null,
        errorCode: materialized.errorCode,
        errorMessage: materialized.errorMessage,
      });
      continue;
    }
    await repo.updateStep({
      planId,
      stepId: step.id,
      status: materialized.status,
      linkedRunType: materialized.linkedRunType,
      linkedRunId: materialized.linkedRunId,
      errorCode: materialized.errorCode,
      errorMessage: materialized.errorMessage,
    });
  }

  return refreshPlanStatus(repo, projectId, planId);
}

type MaterializeResult =
  | {
      kind: "linked";
      linkedRunType: string;
      linkedRunId: string;
      status: AgenticPlanStepStatus;
      errorCode: string | null;
      errorMessage: string | null;
    }
  | {
      kind: "blocked";
      errorCode: string;
      errorMessage: string;
    };

async function materializeStep(
  projectId: string,
  actorUserId: string,
  plan: AgenticPlan,
  step: AgenticPlanStep,
  options?: AgenticPlanServiceOptions,
): Promise<MaterializeResult> {
  const sourceRunId = `agentic_plan:${plan.id}:step:${step.id}`;
  try {
    switch (step.kind) {
      case "note.review_update": {
        const parsed = noteUpdateActionInputSchema.safeParse(step.input);
        if (!parsed.success) return missingInput(step.kind);
        const { action } = await createAction(projectId, actorUserId, {
          requestId: step.id,
          sourceRunId,
          kind: "note.update",
          risk: "write",
          input: parsed.data,
        }, options);
        return linkedAction(action);
      }
      case "document.generate": {
        const parsed = generateProjectObjectActionSchema.safeParse(step.input);
        if (!parsed.success) return missingInput(step.kind);
        const { action } = await requestDocumentGeneration(projectId, actorUserId, parsed.data, options);
        return linkedAction(action);
      }
      case "file.export": {
        const parsed = exportProjectObjectActionSchema.safeParse(step.input);
        if (!parsed.success) return missingInput(step.kind);
        if (parsed.data.provider !== "opencairn_download") {
          const { action } = await requestGoogleWorkspaceExport(projectId, actorUserId, parsed.data, options);
          return linkedAction(action);
        }
        const { action } = await createAction(projectId, actorUserId, {
          requestId: step.id,
          sourceRunId,
          kind: "file.export",
          risk: "external",
          input: parsed.data,
        }, options);
        return linkedAction(action);
      }
      case "code.run": {
        const parsed = codeWorkspaceCommandRunRequestSchema.safeParse(step.input);
        if (!parsed.success) return missingInput(step.kind);
        const { action } = await createAction(projectId, actorUserId, {
          requestId: step.id,
          sourceRunId,
          kind: "code_project.run",
          risk: step.risk,
          input: parsed.data,
        }, options);
        return linkedAction(action);
      }
      case "code.repair": {
        const failedRunActionId = stringField(step.input, "failedRunActionId");
        if (!failedRunActionId) return missingInput(step.kind);
        const { action } = await repairCodeRun(failedRunActionId, actorUserId, { requestId: step.id }, options);
        return linkedAction(action);
      }
      case "agent.run": {
        const parsed = plan8AgentRunInputSchema.safeParse(step.input);
        if (!parsed.success) return missingInput(step.kind);
        const run = await runPlan8(projectId, actorUserId, parsed.data, options);
        return linkedPlan8AgentRun(run.runId, run.status);
      }
      case "import.retry": {
        const importJobId = stringField(step.input, "importJobId");
        if (!importJobId) return missingInput(step.kind);
        const result = await retryImport(importJobId, actorUserId, options);
        if (result.action) return linkedAction(result.action);
        return linkedImportJob(result.jobId);
      }
      case "manual.review":
        return {
          kind: "blocked",
          errorCode: "agentic_plan_manual_review_required",
          errorMessage: "Manual review is required before this plan can continue.",
        };
    }
  } catch (err) {
    if (
      (err instanceof AgentActionError && err.status === 409)
      || err instanceof ImportRetryError
      || err instanceof Plan8AgentRunError
    ) {
      return {
        kind: "blocked",
        errorCode: err.code,
        errorMessage: err.message,
      };
    }
    throw err;
  }
}

function linkedAction(action: AgentAction): MaterializeResult {
  return {
    kind: "linked",
    linkedRunType: "agent_action",
    linkedRunId: action.id,
    status: stepStatusFromActionStatus(action.status),
    errorCode: action.errorCode,
    errorMessage: null,
  };
}

function linkedImportJob(jobId: string): MaterializeResult {
  return {
    kind: "linked",
    linkedRunType: "import_job",
    linkedRunId: jobId,
    status: "queued",
    errorCode: null,
    errorMessage: null,
  };
}

function linkedPlan8AgentRun(runId: string, status: string): MaterializeResult {
  return {
    kind: "linked",
    linkedRunType: "plan8_agent",
    linkedRunId: runId,
    status: stepStatusFromPlan8Status(status),
    errorCode: null,
    errorMessage: null,
  };
}

function missingInput(kind: AgenticPlanStepKind): MaterializeResult {
  return {
    kind: "blocked",
    errorCode: "agentic_plan_step_missing_input",
    errorMessage: `${kind} requires a concrete validated input payload before it can be linked.`,
  };
}

async function createAction(
  projectId: string,
  actorUserId: string,
  request: CreateAgentActionRequest,
  options?: AgenticPlanServiceOptions,
): Promise<{ action: AgentAction; idempotent: boolean }> {
  const create = options?.createAgentAction
    ?? ((pid, uid, req) =>
      createAgentAction(pid, uid, req, { canWriteProject: options?.canWriteProject }));
  return create(projectId, actorUserId, request);
}

async function requestDocumentGeneration(
  projectId: string,
  actorUserId: string,
  request: GenerateProjectObjectAction,
  options?: AgenticPlanServiceOptions,
): Promise<{ action: AgentAction }> {
  const run = options?.requestDocumentGeneration
    ?? ((pid, uid, req) =>
      requestDocumentGenerationProjectObject(pid, uid, req, {
        canWriteProject: options?.canWriteProject,
      }));
  return run(projectId, actorUserId, request);
}

async function requestGoogleWorkspaceExport(
  projectId: string,
  actorUserId: string,
  request: ExportProjectObjectAction,
  options?: AgenticPlanServiceOptions,
): Promise<{ action: AgentAction }> {
  const run = options?.requestGoogleWorkspaceExport
    ?? ((pid, uid, req) =>
      requestGoogleWorkspaceExportProjectObject(pid, uid, req, {
        canWriteProject: options?.canWriteProject,
      }));
  return run(projectId, actorUserId, request);
}

async function repairCodeRun(
  failedRunActionId: string,
  actorUserId: string,
  request: { requestId?: string },
  options?: AgenticPlanServiceOptions,
): Promise<{ action: AgentAction; idempotent: boolean }> {
  const repair = options?.createCodeProjectRepairAction
    ?? ((id, uid, req) =>
      createCodeProjectRepairAction(id, uid, req, {
        canWriteProject: options?.canWriteProject,
      }));
  return repair(failedRunActionId, actorUserId, request);
}

async function retryImport(
  failedJobId: string,
  actorUserId: string,
  options?: AgenticPlanServiceOptions,
): Promise<{ jobId: string; action: AgentAction | null }> {
  const retry = options?.retryImportJob ?? retryImportJob;
  return retry(failedJobId, actorUserId);
}

async function runPlan8(
  projectId: string,
  actorUserId: string,
  input: Plan8AgentRunInput,
  options?: AgenticPlanServiceOptions,
): Promise<{ runId: string; status: string }> {
  const run = options?.runPlan8Agent ?? runPlan8Agent;
  return run(projectId, actorUserId, input);
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stepStatusFromActionStatus(status: AgentActionStatus): AgenticPlanStepStatus {
  switch (status) {
    case "draft":
    case "approval_required":
      return "approval_required";
    case "queued":
    case "running":
    case "completed":
    case "failed":
    case "cancelled":
      return status;
    case "expired":
    case "reverted":
      return "failed";
  }
}

function stepStatusFromPlan8Status(status: string): AgenticPlanStepStatus {
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "queued") return "queued";
  if (status === "awaiting_input" || status === "blocked") return "blocked";
  return "running";
}

export async function recoverAgenticPlanStep(
  projectId: string,
  actorUserId: string,
  planId: string,
  request: RecoverAgenticPlanStepRequest,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan> {
  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  const plan = await getWritablePlan(projectId, actorUserId, planId, options);
  const step = plan.steps.find((candidate) => candidate.id === request.stepId);
  if (!step) throw new AgenticPlanError("agentic_plan_step_not_found", 404);
  if (!["failed", "blocked", "cancelled"].includes(step.status)) {
    throw new AgenticPlanError("agentic_plan_step_not_recoverable", 409);
  }

  const ordinal = Math.max(0, ...plan.steps.map((candidate) => candidate.ordinal)) + 1;
  await repo.appendStep({
    planId,
    step: request.strategy === "retry"
      ? {
          ordinal,
          kind: step.kind,
          title: `Retry: ${step.title}`,
          rationale: request.note ?? `Retry the failed step "${step.title}".`,
          status: "approval_required",
          risk: step.risk,
          input: step.input,
        }
      : {
          ordinal,
          kind: "manual.review",
          title: "Manual recovery review",
          rationale: request.note ?? `Review recovery options for "${step.title}".`,
          status: "approval_required",
          risk: "low",
          input: {
            recoveredStepId: step.id,
          },
        },
  });

  return refreshPlanStatus(repo, projectId, planId);
}

export function planStepsForGoal(
  goal: string,
  target: { noteId?: string } = {},
): PlannedStepInput[] {
  const goalText = goal.toLowerCase();
  const steps: PlannedStepInput[] = [];

  if (includesAny(goalText, ["note", "노트", "문서 검토", "문서 수정"])) {
    steps.push({
      kind: "note.review_update",
      title: "Review and prepare note update",
      rationale: "The goal references note or document content, so the safe first step is a reviewable update draft.",
      risk: "write",
    });
  }

  if (includesAny(goalText, ["report", "document", "generate", "보고서", "문서 생성", "생성"])) {
    steps.push({
      kind: "document.generate",
      title: "Prepare document generation request",
      rationale: "The goal asks for a generated document artifact, which should remain visible before execution.",
      risk: "expensive",
    });
  }

  if (includesAny(goalText, ["export", "내보내기", "google docs", "google drive"])) {
    steps.push({
      kind: "file.export",
      title: "Prepare export request",
      rationale: "Exports create external-facing outputs and must stay explicit in the plan.",
      risk: "external",
    });
  }

  if (includesAny(goalText, ["repair", "fix", "수정", "고쳐"])) {
    steps.push({
      kind: "code.repair",
      title: "Prepare code repair review",
      rationale: "Repair work must produce a reviewable patch before any apply step.",
      risk: "write",
    });
  } else if (includesAny(goalText, ["code", "코드", "test", "build", "lint"])) {
    steps.push({
      kind: "code.run",
      title: "Plan code workspace execution",
      rationale: "Code execution is feature-gated and must remain explicit.",
      risk: "expensive",
    });
  }

  if (includesAny(goalText, ["import", "retry import", "가져오기", "재시도"])) {
    steps.push({
      kind: "import.retry",
      title: "Review import retry",
      rationale: "Import recovery should remain tied to an existing import job and action trail.",
      risk: "write",
    });
  }

  const agentRunStep = plan8AgentStepForGoal(goalText, target);
  if (agentRunStep) steps.push(agentRunStep);

  if (steps.length === 0) {
    steps.push({
      kind: "manual.review",
      title: "Review goal and choose next action",
      rationale: "The deterministic planner could not classify the goal into a supported safe action.",
      risk: "low",
    });
  }

  return dedupeStepKinds(steps);
}

function plan8AgentStepForGoal(
  goalText: string,
  target: { noteId?: string },
): PlannedStepInput | null {
  const agentName = plan8AgentNameForGoal(goalText);
  if (!agentName) return null;
  const input: Record<string, unknown> = { agentName };
  if (agentName === "narrator" && target.noteId) input.noteId = target.noteId;
  if (agentName === "synthesis" && target.noteId) input.noteIds = [target.noteId];

  return {
    kind: "agent.run",
    title: `Run ${agentName} agent`,
    rationale: "The goal names an existing Plan8 agent, so the plan can launch it through the workflow console.",
    risk: agentRunRisk(agentName),
    input,
  };
}

function plan8AgentNameForGoal(goalText: string): Plan8AgentRunInput["agentName"] | null {
  if (includesAny(goalText, ["librarian", "library agent", "knowledge graph", "사서", "지식 그래프"])) {
    return "librarian";
  }
  if (includesAny(goalText, ["curator", "curate", "orphan", "duplicate", "contradiction", "큐레이터", "중복", "모순"])) {
    return "curator";
  }
  if (includesAny(goalText, ["connector", "concept link", "connect concept", "개념 연결"])) {
    return "connector";
  }
  if (includesAny(goalText, ["staleness", "stale", "outdated", "오래된", "최신성"])) {
    return "staleness";
  }
  if (includesAny(goalText, ["narrator", "podcast", "audio", "voice", "나레이터", "나레이션", "음성"])) {
    return "narrator";
  }
  if (includesAny(goalText, ["synthesis agent", "synthesize notes", "합성 에이전트"])) {
    return "synthesis";
  }
  return null;
}

function agentRunRisk(agentName: Plan8AgentRunInput["agentName"]): PlannedStepInput["risk"] {
  if (agentName === "synthesis" || agentName === "narrator") return "expensive";
  return "write";
}

async function getReadablePlan(
  projectId: string,
  actorUserId: string,
  planId: string,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan> {
  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new AgenticPlanError("project_not_found", 404);
  if (!(await canReadProject(actorUserId, projectId, options))) {
    throw new AgenticPlanError("forbidden", 403);
  }
  const plan = await repo.findById({ projectId, planId });
  if (!plan) throw new AgenticPlanError("agentic_plan_not_found", 404);
  return plan;
}

async function getWritablePlan(
  projectId: string,
  actorUserId: string,
  planId: string,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan> {
  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new AgenticPlanError("project_not_found", 404);
  if (!(await canWriteProject(actorUserId, projectId, options))) {
    throw new AgenticPlanError("forbidden", 403);
  }
  const plan = await repo.findById({ projectId, planId });
  if (!plan) throw new AgenticPlanError("agentic_plan_not_found", 404);
  return plan;
}

async function refreshPlanStatus(
  repo: AgenticPlanRepository,
  projectId: string,
  planId: string,
): Promise<AgenticPlan> {
  const plan = await repo.findById({ projectId, planId });
  if (!plan) throw new AgenticPlanError("agentic_plan_not_found", 404);
  const status = statusFromSteps(plan.steps);
  const currentStepOrdinal = currentStepOrdinalFromSteps(plan.steps);
  await repo.updatePlanStatus({
    planId,
    status,
    currentStepOrdinal,
    completedAt: status === "completed" || status === "failed" || status === "cancelled"
      ? new Date()
      : null,
  });
  const refreshed = await repo.findById({ projectId, planId });
  if (!refreshed) throw new AgenticPlanError("agentic_plan_not_found", 404);
  return refreshed;
}

function statusFromSteps(steps: AgenticPlanStep[]): AgenticPlanStatus {
  if (steps.length > 0 && steps.every((step) => step.status === "completed" || step.status === "skipped")) {
    return "completed";
  }
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "blocked")) return "blocked";
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.some((step) => step.status === "queued")) return "queued";
  if (steps.some((step) => step.status === "approval_required" || step.status === "draft")) {
    return "approval_required";
  }
  if (steps.length > 0 && steps.every((step) => step.status === "cancelled")) return "cancelled";
  return "approval_required";
}

function currentStepOrdinalFromSteps(steps: AgenticPlanStep[]): number | null {
  return steps.find((step) => !["completed", "skipped", "cancelled"].includes(step.status))?.ordinal ?? null;
}

async function hydratePlan(conn: DB, plan: AgenticPlanRow): Promise<AgenticPlan> {
  const steps = await conn
    .select()
    .from(agenticPlanSteps)
    .where(eq(agenticPlanSteps.planId, plan.id))
    .orderBy(asc(agenticPlanSteps.ordinal));
  return toAgenticPlan(plan, steps);
}

function toAgenticPlan(row: AgenticPlanRow, steps: AgenticPlanStepRow[]): AgenticPlan {
  return agenticPlanSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    actorUserId: row.actorUserId,
    title: row.title,
    goal: row.goal,
    status: row.status,
    target: row.target,
    plannerKind: row.plannerKind,
    summary: row.summary,
    currentStepOrdinal: row.currentStepOrdinal,
    steps: steps.map((step) => ({
      id: step.id,
      planId: step.planId,
      ordinal: step.ordinal,
      kind: step.kind,
      title: step.title,
      rationale: step.rationale,
      status: step.status,
      risk: step.risk,
      input: step.input,
      linkedRunType: step.linkedRunType,
      linkedRunId: step.linkedRunId,
      errorCode: step.errorCode,
      errorMessage: step.errorMessage,
      createdAt: step.createdAt.toISOString(),
      updatedAt: step.updatedAt.toISOString(),
      completedAt: step.completedAt?.toISOString() ?? null,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

function terminalStepStatus(status: AgenticPlanStepStatus): boolean {
  return ["completed", "failed", "cancelled", "skipped"].includes(status);
}

async function canReadProject(
  userId: string,
  projectId: string,
  options?: AgenticPlanServiceOptions,
): Promise<boolean> {
  const check = options?.canReadProject ?? ((id, pid) => canRead(id, { type: "project", id: pid }));
  return check(userId, projectId);
}

async function canWriteProject(
  userId: string,
  projectId: string,
  options?: AgenticPlanServiceOptions,
): Promise<boolean> {
  const check = options?.canWriteProject ?? ((id, pid) => canWrite(id, { type: "project", id: pid }));
  return check(userId, projectId);
}

function titleFromGoal(goal: string): string {
  const compact = goal.trim().replace(/\s+/g, " ");
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

function summaryForSteps(steps: PlannedStepInput[]): string {
  const labels = steps.map((step) => step.kind).join(", ");
  return `${steps.length}-step deterministic plan: ${labels}`;
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function dedupeStepKinds(steps: PlannedStepInput[]): PlannedStepInput[] {
  const seen = new Set<AgenticPlanStepKind>();
  return steps.filter((step) => {
    if (seen.has(step.kind)) return false;
    seen.add(step.kind);
    return true;
  });
}
