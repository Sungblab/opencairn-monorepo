import {
  agentActions,
  agentRuns,
  agenticPlanSteps,
  agenticPlans,
  and,
  asc,
  db as defaultDb,
  desc,
  eq,
  importJobs,
  inArray,
  isNull,
  noteAnalysisJobs,
  noteChunks,
  notes,
  or,
  projects,
  type AgenticPlanRow,
  type AgenticPlanStepRow,
  type DB,
  wikiLinks,
} from "@opencairn/db";
import type {
  AgentAction,
  AgentActionStatus,
  AgentActionRisk,
  AgenticPlan,
  AgenticPlanPlannerKind,
  AgenticPlanStatus,
  AgenticPlanStep,
  AgenticPlanStepEvidenceRef,
  AgenticPlanEvidenceFreshnessStatus,
  AgenticPlanStepRecoveryCode,
  AgenticPlanStepKind,
  AgenticPlanStepStatus,
  AgenticPlanStepVerificationStatus,
  CreateAgentActionRequest,
  CreateAgenticPlanRequest,
  GenerateProjectObjectAction,
  ProjectObjectAction,
  RecoverAgenticPlanStepRequest,
  StartAgenticPlanRequest,
} from "@opencairn/shared";
import {
  agentActionRiskSchema,
  agenticPlanSchema,
  agenticPlanStepKindSchema,
  allowedAgenticPlanRecoveryStrategies,
  codeWorkspaceCommandRunRequestSchema,
  exportProjectObjectActionSchema,
  generateProjectObjectActionSchema,
  noteUpdateActionInputSchema,
} from "@opencairn/shared";
import { z } from "zod";
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
import { requeueNoteAnalysisJobForNote } from "./note-analysis-jobs";
import { getChatProvider } from "./llm";
import { LLMNotConfiguredError, type LLMProvider } from "./llm/provider";
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
  evidenceRefs?: AgenticPlanStepEvidenceRef[];
  evidenceFreshnessStatus?: AgenticPlanEvidenceFreshnessStatus;
  staleEvidenceBlocks?: boolean;
  verificationStatus?: AgenticPlanStepVerificationStatus;
  recoveryCode?: AgenticPlanStepRecoveryCode | null;
  retryCount?: number;
};

type NoteEvidenceHydration = {
  evidenceRefs: AgenticPlanStepEvidenceRef[];
  evidenceFreshnessStatus: AgenticPlanEvidenceFreshnessStatus;
  staleEvidenceBlocks: boolean;
};

export interface AgenticPlanPlanningInput {
  goal: string;
  target: Record<string, unknown>;
}

export interface AgenticPlanPlanningResult {
  plannerKind: AgenticPlanPlannerKind;
  summary?: string;
  steps: PlannedStepInput[];
}

export interface AgenticPlanPlanner {
  plan(input: AgenticPlanPlanningInput): Promise<AgenticPlanPlanningResult> | AgenticPlanPlanningResult;
}

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
    plannerKind: AgenticPlanPlannerKind;
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
  findByLinkedRun(options: {
    projectId: string;
    linkedRunType: string;
    linkedRunId: string;
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
    evidenceRefs?: AgenticPlanStepEvidenceRef[];
    evidenceFreshnessStatus?: AgenticPlanEvidenceFreshnessStatus;
    staleEvidenceBlocks?: boolean;
    verificationStatus?: AgenticPlanStepVerificationStatus;
    recoveryCode?: AgenticPlanStepRecoveryCode | null;
    retryCount?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<void>;
  appendStep(options: {
    planId: string;
    step: PlannedStepInput & {
      ordinal: number;
      status: AgenticPlanStepStatus;
      linkedRunType?: string | null;
      linkedRunId?: string | null;
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
  syncLinkedRunStatuses?(plan: AgenticPlan): Promise<boolean>;
}

export interface AgenticPlanServiceOptions {
  repo?: AgenticPlanRepository;
  planner?: AgenticPlanPlanner;
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
  hydrateNoteEvidence?: (
    projectId: string,
    noteId: string,
  ) => Promise<NoteEvidenceHydration>;
  resolvePlannerEvidenceNoteIds?: (
    projectId: string,
    noteId: string,
  ) => Promise<string[]>;
  requeueNoteEvidence?: (
    noteIds: string[],
  ) => Promise<Array<{ noteId: string; status: "queued" | "missing_note"; jobId?: string | null }>>;
}

type AppendableAgenticPlanStep = Parameters<AgenticPlanRepository["appendStep"]>[0]["step"];

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
              evidenceRefs: step.evidenceRefs ?? [],
              evidenceFreshnessStatus: step.evidenceFreshnessStatus ?? "unknown",
              staleEvidenceBlocks: step.staleEvidenceBlocks ?? false,
              verificationStatus: step.verificationStatus ?? "pending",
              recoveryCode: step.recoveryCode ?? null,
              retryCount: step.retryCount ?? 0,
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
    async findByLinkedRun({ projectId, linkedRunType, linkedRunId }) {
      const [row] = await conn
        .select({ plan: agenticPlans })
        .from(agenticPlanSteps)
        .innerJoin(agenticPlans, eq(agenticPlans.id, agenticPlanSteps.planId))
        .where(
          and(
            eq(agenticPlans.projectId, projectId),
            eq(agenticPlanSteps.linkedRunType, linkedRunType),
            eq(agenticPlanSteps.linkedRunId, linkedRunId),
          ),
        )
        .limit(1);
      return row?.plan ? hydratePlan(conn, row.plan) : null;
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
    async updateStep({
      stepId,
      status,
      linkedRunType,
      linkedRunId,
      evidenceRefs,
      evidenceFreshnessStatus,
      staleEvidenceBlocks,
      verificationStatus,
      recoveryCode,
      retryCount,
      errorCode,
      errorMessage,
    }) {
      const values: {
        status?: AgenticPlanStepStatus;
        linkedRunType?: string | null;
        linkedRunId?: string | null;
        evidenceRefs?: AgenticPlanStepEvidenceRef[];
        evidenceFreshnessStatus?: AgenticPlanEvidenceFreshnessStatus;
        staleEvidenceBlocks?: boolean;
        verificationStatus?: AgenticPlanStepVerificationStatus;
        recoveryCode?: AgenticPlanStepRecoveryCode | null;
        retryCount?: number;
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
      if (evidenceRefs !== undefined) values.evidenceRefs = evidenceRefs;
      if (evidenceFreshnessStatus !== undefined) values.evidenceFreshnessStatus = evidenceFreshnessStatus;
      if (staleEvidenceBlocks !== undefined) values.staleEvidenceBlocks = staleEvidenceBlocks;
      if (verificationStatus !== undefined) values.verificationStatus = verificationStatus;
      if (recoveryCode !== undefined) values.recoveryCode = recoveryCode;
      if (retryCount !== undefined) values.retryCount = retryCount;
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
        evidenceRefs: step.evidenceRefs ?? [],
        evidenceFreshnessStatus: step.evidenceFreshnessStatus ?? "unknown",
        staleEvidenceBlocks: step.staleEvidenceBlocks ?? false,
        verificationStatus: step.verificationStatus ?? "pending",
        recoveryCode: step.recoveryCode ?? null,
        retryCount: step.retryCount ?? 0,
        linkedRunType: step.linkedRunType ?? null,
        linkedRunId: step.linkedRunId ?? null,
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
    async syncLinkedRunStatuses(plan) {
      return syncLinkedStepStatuses(conn, plan);
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

  const target = {
    workspaceId: scope.workspaceId,
    projectId,
    ...(request.target ?? {}),
  };
  const planning = await planAgenticGoal(request.goal, target, options);
  const steps = await hydratePlannedStepsWithEvidence(projectId, planning.steps, target, options);
  return repo.insertPlan({
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    title: request.title ?? titleFromGoal(request.goal),
    goal: request.goal,
    status: "approval_required",
    target,
    plannerKind: planning.plannerKind,
    summary: planning.summary ?? summaryForSteps(planning.steps, planning.plannerKind),
    currentStepOrdinal: 1,
    steps,
  });
}

async function planAgenticGoal(
  goal: string,
  target: Record<string, unknown>,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlanPlanningResult> {
  if (options?.planner) {
    return normalizePlanningResult(await options.planner.plan({ goal, target }));
  }

  if (agenticModelPlannerEnabled()) {
    try {
      return normalizePlanningResult(
        await createModelAgenticPlanPlanner().plan({ goal, target }),
      );
    } catch (err) {
      if (!(err instanceof LLMNotConfiguredError)) {
        console.warn("[agentic-plans] model planner failed; falling back to deterministic planner", err);
      }
    }
  }

  return deterministicPlanningResult(goal, target);
}

function deterministicPlanningResult(
  goal: string,
  target: Record<string, unknown>,
): AgenticPlanPlanningResult {
  const steps = planStepsForGoal(goal, target);
  return {
    plannerKind: "deterministic",
    summary: summaryForSteps(steps, "deterministic"),
    steps,
  };
}

function agenticModelPlannerEnabled(): boolean {
  return process.env.FEATURE_AGENTIC_MODEL_PLANNER === "1";
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
  const plans = await repo.listByProject({
    projectId,
    status: query.status ? undefined : query.status,
    limit: query.status ? Math.max(query.limit * 4, query.limit) : query.limit,
  });
  const synced = await Promise.all(plans.map((plan) => syncAndRefreshPlan(repo, projectId, plan)));
  return synced
    .filter((plan) => !query.status || plan.status === query.status)
    .slice(0, query.limit);
}

export async function getAgenticPlan(
  projectId: string,
  actorUserId: string,
  planId: string,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan> {
  const plan = await getReadablePlan(projectId, actorUserId, planId, options);
  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  return syncAndRefreshPlan(repo, projectId, plan);
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
    const refreshedStep = await refreshStepEvidenceBeforeStart(repo, planId, projectId, step, options);
    const blocker = stepFreshnessBlocker(refreshedStep);
    if (blocker) {
      await repo.updateStep({
        planId,
        stepId: refreshedStep.id,
        status: "blocked",
        verificationStatus: "blocked",
        recoveryCode: blocker.recoveryCode,
        errorCode: blocker.errorCode,
        errorMessage: blocker.errorMessage,
      });
      continue;
    }
    const materialized = await materializeStep(projectId, actorUserId, plan, refreshedStep, options);
    if (materialized.kind === "blocked") {
      await repo.updateStep({
        planId,
        stepId: refreshedStep.id,
        status: "blocked",
        linkedRunType: null,
        linkedRunId: null,
        errorCode: materialized.errorCode,
        errorMessage: materialized.errorMessage,
        recoveryCode: recoveryCodeForError(materialized.errorCode),
        verificationStatus: materialized.errorCode === "agentic_plan_step_missing_input" ? "blocked" : undefined,
      });
      continue;
    }
    await repo.updateStep({
      planId,
      stepId: refreshedStep.id,
      status: materialized.status,
      linkedRunType: materialized.linkedRunType,
      linkedRunId: materialized.linkedRunId,
      errorCode: materialized.errorCode,
      errorMessage: materialized.errorMessage,
      verificationStatus: materialized.status === "completed" ? "passed" : "pending",
    });
  }

  return refreshPlanStatus(repo, projectId, planId);
}

const MAX_HANDOFF_DEPTH = 4;

export interface RecordAgenticPlanHandoffRequest {
  parentRunId: string;
  childRunId: string;
  childAgentName: string;
  reason: string;
  childStatus?: string;
}

export async function recordAgenticPlanHandoff(
  projectId: string,
  request: RecordAgenticPlanHandoffRequest,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlan | null> {
  if (request.parentRunId === request.childRunId) {
    throw new AgenticPlanError("agentic_plan_handoff_cycle", 409);
  }

  const repo = options?.repo ?? createDrizzleAgenticPlanRepository();
  const plan = await repo.findByLinkedRun({
    projectId,
    linkedRunType: "plan8_agent",
    linkedRunId: request.parentRunId,
  });
  if (!plan) return null;

  if (plan.steps.some((step) =>
    step.linkedRunType === "plan8_agent" && step.linkedRunId === request.childRunId
  )) {
    return plan;
  }

  const depth = handoffDepthForRun(plan, request.parentRunId);
  if (depth == null || depth + 1 > MAX_HANDOFF_DEPTH) {
    throw new AgenticPlanError("agentic_plan_handoff_depth_exceeded", 409);
  }

  await repo.appendStep({
    planId: plan.id,
    step: {
      ordinal: Math.max(0, ...plan.steps.map((step) => step.ordinal)) + 1,
      kind: "agent.run",
      title: `Handoff to ${request.childAgentName}`,
      rationale: request.reason,
      status: stepStatusFromPlan8Status(request.childStatus ?? "running"),
      risk: "write",
      input: {
        agentName: request.childAgentName,
        handoff: {
          parentRunId: request.parentRunId,
          childRunId: request.childRunId,
          reason: request.reason,
        },
      },
      linkedRunType: "plan8_agent",
      linkedRunId: request.childRunId,
      errorCode: null,
      errorMessage: null,
    },
  });
  return refreshPlanStatus(repo, projectId, plan.id);
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

function stepFreshnessBlocker(step: AgenticPlanStep): {
  errorCode: "stale_context" | "missing_source";
  recoveryCode: "stale_context" | "missing_source";
  errorMessage: string;
} | null {
  if (!step.staleEvidenceBlocks) return null;
  if (step.evidenceFreshnessStatus === "stale") {
    return {
      errorCode: "stale_context",
      recoveryCode: "stale_context",
      errorMessage: "Step evidence is stale; requeue note analysis before execution.",
    };
  }
  if (step.evidenceFreshnessStatus === "missing") {
    return {
      errorCode: "missing_source",
      recoveryCode: "missing_source",
      errorMessage: "Step evidence source is missing and needs manual review.",
    };
  }
  return null;
}

function recoveryCodeForError(errorCode: string | null): AgenticPlanStepRecoveryCode | null {
  if (errorCode === "stale_context") return "stale_context";
  if (errorCode === "missing_source") return "missing_source";
  if (errorCode === "verification_failed") return "verification_failed";
  return null;
}

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

function stepStatusFromLinkedRunStatus(
  linkedRunType: string,
  status: string,
): AgenticPlanStepStatus {
  if (linkedRunType === "agent_action") {
    return stepStatusFromActionStatus(status as AgentActionStatus);
  }
  if (linkedRunType === "plan8_agent") {
    return stepStatusFromPlan8Status(status);
  }
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running" || status === "processing") return "running";
  return "queued";
}

function handoffDepthForRun(plan: AgenticPlan, runId: string): number | null {
  const stepByRunId = new Map(
    plan.steps
      .filter((step) => step.linkedRunType === "plan8_agent" && step.linkedRunId)
      .map((step) => [step.linkedRunId!, step]),
  );
  const visited = new Set<string>();

  function depth(id: string): number | null {
    if (visited.has(id)) return null;
    visited.add(id);
    const step = stepByRunId.get(id);
    if (!step) return null;
    const parentRunId = handoffParentRunId(step);
    if (!parentRunId) return 0;
    const parentDepth = depth(parentRunId);
    return parentDepth == null ? null : parentDepth + 1;
  }

  return depth(runId);
}

function handoffParentRunId(step: AgenticPlanStep): string | null {
  const handoff = step.input.handoff;
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) return null;
  const value = (handoff as Record<string, unknown>).parentRunId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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
  const allowedStrategies = allowedAgenticPlanRecoveryStrategies(step);
  if (!allowedStrategies.includes(request.strategy)) {
    throw new AgenticPlanError("agentic_plan_recovery_strategy_not_allowed", 409);
  }

  if (request.strategy === "cancel") {
    await repo.updateStep({
      planId,
      stepId: step.id,
      status: "cancelled",
      errorCode: "cancelled",
      errorMessage: request.note?.trim() || null,
    });
    return refreshPlanStatus(repo, projectId, planId);
  }

  if (request.strategy === "retry" && step.recoveryCode === "stale_context") {
    await requeueStaleStepEvidence(projectId, step, options);
  }

  const ordinal = Math.max(0, ...plan.steps.map((candidate) => candidate.ordinal)) + 1;
  await repo.appendStep({
    planId,
    step: recoveryStepForRequest(step, ordinal, request),
  });

  return refreshPlanStatus(repo, projectId, planId);
}

async function hydratePlannedStepsWithEvidence(
  projectId: string,
  steps: PlannedStepInput[],
  target: Record<string, unknown>,
  options?: AgenticPlanServiceOptions,
): Promise<PlannedStepInput[]> {
  const noteId = typeof target.noteId === "string" ? target.noteId : null;
  if (!noteId) return steps;
  const noteIds = await resolvePlannerEvidenceNoteIds(projectId, noteId, options);
  const hydration = combineNoteEvidenceHydrations(
    await Promise.all(noteIds.map((candidateNoteId) =>
      hydrateNoteEvidence(projectId, candidateNoteId, options),
    )),
  );
  return steps.map((step) => hydrateStepWithNoteEvidence(step, hydration));
}

async function refreshStepEvidenceBeforeStart(
  repo: AgenticPlanRepository,
  planId: string,
  projectId: string,
  step: AgenticPlanStep,
  options?: AgenticPlanServiceOptions,
): Promise<AgenticPlanStep> {
  const noteIds = noteIdsFromEvidenceRefs(step.evidenceRefs ?? []);
  if (noteIds.length === 0) return step;
  const hydration = combineNoteEvidenceHydrations(
    await Promise.all(noteIds.map((noteId) => hydrateNoteEvidence(projectId, noteId, options))),
  );
  if (!stepEvidenceChanged(step, hydration)) return step;
  await repo.updateStep({
    planId,
    stepId: step.id,
    evidenceRefs: hydration.evidenceRefs,
    evidenceFreshnessStatus: hydration.evidenceFreshnessStatus,
    staleEvidenceBlocks: hydration.staleEvidenceBlocks,
    recoveryCode: hydration.evidenceFreshnessStatus === "stale" ? "stale_context" : null,
    errorCode: null,
    errorMessage: null,
  });
  return {
    ...step,
    evidenceRefs: hydration.evidenceRefs,
    evidenceFreshnessStatus: hydration.evidenceFreshnessStatus,
    staleEvidenceBlocks: hydration.staleEvidenceBlocks,
    recoveryCode: hydration.evidenceFreshnessStatus === "stale" ? "stale_context" : null,
    errorCode: null,
    errorMessage: null,
  };
}

function hydrateStepWithNoteEvidence(
  step: PlannedStepInput,
  hydration: NoteEvidenceHydration,
): PlannedStepInput {
  if (step.kind === "manual.review") return step;
  return {
    ...step,
    evidenceRefs: step.evidenceRefs?.length ? step.evidenceRefs : hydration.evidenceRefs,
    evidenceFreshnessStatus: step.evidenceFreshnessStatus ?? hydration.evidenceFreshnessStatus,
    staleEvidenceBlocks: step.staleEvidenceBlocks ?? hydration.staleEvidenceBlocks,
    recoveryCode: step.recoveryCode ?? (
      hydration.evidenceFreshnessStatus === "stale" ? "stale_context"
      : hydration.evidenceFreshnessStatus === "missing" ? "missing_source"
      : null
    ),
    verificationStatus: step.verificationStatus ?? (
      hydration.evidenceFreshnessStatus === "fresh" ? "passed"
      : hydration.staleEvidenceBlocks ? "blocked"
      : "pending"
    ),
  };
}

async function hydrateNoteEvidence(
  projectId: string,
  noteId: string,
  options?: AgenticPlanServiceOptions,
): Promise<NoteEvidenceHydration> {
  if (options?.hydrateNoteEvidence) return options.hydrateNoteEvidence(projectId, noteId);
  const [job] = await defaultDb
    .select({
      id: noteAnalysisJobs.id,
      noteId: noteAnalysisJobs.noteId,
      contentHash: noteAnalysisJobs.contentHash,
      analysisVersion: noteAnalysisJobs.analysisVersion,
      status: noteAnalysisJobs.status,
      errorCode: noteAnalysisJobs.errorCode,
    })
    .from(noteAnalysisJobs)
    .where(and(eq(noteAnalysisJobs.projectId, projectId), eq(noteAnalysisJobs.noteId, noteId)))
    .limit(1);
  const [chunk] = await defaultDb
    .select({
      id: noteChunks.id,
      noteId: noteChunks.noteId,
      contentHash: noteChunks.contentHash,
      chunkIndex: noteChunks.chunkIndex,
    })
    .from(noteChunks)
    .where(and(eq(noteChunks.projectId, projectId), eq(noteChunks.noteId, noteId), isNull(noteChunks.deletedAt)))
    .orderBy(asc(noteChunks.chunkIndex))
    .limit(1);

  const evidenceRefs: AgenticPlanStepEvidenceRef[] = [];
  if (chunk) {
    evidenceRefs.push({
      type: "note_chunk",
      noteId: chunk.noteId,
      chunkId: chunk.id,
      contentHash: chunk.contentHash,
      analysisVersion: job?.analysisVersion,
      metadata: { chunkIndex: chunk.chunkIndex },
    });
  }
  if (job) {
    evidenceRefs.push({
      type: "note_analysis_job",
      noteId: job.noteId,
      jobId: job.id,
      contentHash: job.contentHash,
      analysisVersion: job.analysisVersion,
      metadata: { status: job.status, errorCode: job.errorCode },
    });
  }

  if (!job && !chunk) {
    return {
      evidenceRefs: [],
      evidenceFreshnessStatus: "missing",
      staleEvidenceBlocks: true,
    };
  }
  if (job && job.status !== "completed") {
    return {
      evidenceRefs,
      evidenceFreshnessStatus: job.status === "failed" ? "missing" : "stale",
      staleEvidenceBlocks: true,
    };
  }
  return {
    evidenceRefs,
    evidenceFreshnessStatus: "fresh",
    staleEvidenceBlocks: false,
  };
}

async function resolvePlannerEvidenceNoteIds(
  projectId: string,
  noteId: string,
  options?: AgenticPlanServiceOptions,
): Promise<string[]> {
  if (options?.resolvePlannerEvidenceNoteIds) {
    return uniqueIds(await options.resolvePlannerEvidenceNoteIds(projectId, noteId), noteId);
  }
  if (options?.hydrateNoteEvidence) return [noteId];

  const [target] = await defaultDb
    .select({ workspaceId: notes.workspaceId })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.projectId, projectId), isNull(notes.deletedAt)))
    .limit(1);
  if (!target) return [noteId];

  const linkRows = await defaultDb
    .select({
      sourceNoteId: wikiLinks.sourceNoteId,
      targetNoteId: wikiLinks.targetNoteId,
    })
    .from(wikiLinks)
    .where(and(
      eq(wikiLinks.workspaceId, target.workspaceId),
      or(eq(wikiLinks.sourceNoteId, noteId), eq(wikiLinks.targetNoteId, noteId)),
    ))
    .limit(12);
  const candidateIds = uniqueIds(
    linkRows.flatMap((row) => [row.sourceNoteId, row.targetNoteId]),
    noteId,
  ).filter((candidateId) => candidateId !== noteId);
  if (candidateIds.length === 0) return [noteId];

  const relatedRows = await defaultDb
    .select({ id: notes.id })
    .from(notes)
    .where(and(
      eq(notes.projectId, projectId),
      isNull(notes.deletedAt),
      inArray(notes.id, candidateIds),
    ))
    .limit(4);
  return uniqueIds([noteId, ...relatedRows.map((row) => row.id)], noteId);
}

async function requeueStaleStepEvidence(
  projectId: string,
  step: AgenticPlanStep,
  options?: AgenticPlanServiceOptions,
): Promise<void> {
  const noteIds = noteIdsFromEvidenceRefs(step.evidenceRefs ?? []);
  if (noteIds.length === 0) return;
  if (options?.requeueNoteEvidence) {
    await options.requeueNoteEvidence(noteIds);
    return;
  }
  await Promise.all(
    noteIds.map((noteId) =>
      requeueNoteAnalysisJobForNote({ noteId, projectId, debounceMs: 0 }),
    ),
  );
}

function noteIdsFromEvidenceRefs(refs: AgenticPlanStepEvidenceRef[]): string[] {
  return [...new Set(refs.map((ref) => ref.noteId))];
}

function uniqueIds(values: string[], firstId?: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  if (firstId && firstId.length > 0) {
    result.push(firstId);
    seen.add(firstId);
  }
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue;
    result.push(value);
    seen.add(value);
  }
  return result;
}

function combineNoteEvidenceHydrations(hydrations: NoteEvidenceHydration[]): NoteEvidenceHydration {
  return {
    evidenceRefs: hydrations.flatMap((hydration) => hydration.evidenceRefs),
    evidenceFreshnessStatus: combinedEvidenceFreshnessStatus(hydrations),
    staleEvidenceBlocks: hydrations.some((hydration) => hydration.staleEvidenceBlocks),
  };
}

function combinedEvidenceFreshnessStatus(
  hydrations: NoteEvidenceHydration[],
): AgenticPlanEvidenceFreshnessStatus {
  if (hydrations.some((hydration) => hydration.evidenceFreshnessStatus === "missing")) return "missing";
  if (hydrations.some((hydration) => hydration.evidenceFreshnessStatus === "stale")) return "stale";
  if (hydrations.some((hydration) => hydration.evidenceFreshnessStatus === "unknown")) return "unknown";
  return "fresh";
}

function stepEvidenceChanged(
  step: AgenticPlanStep,
  hydration: NoteEvidenceHydration,
): boolean {
  return !jsonValueEqual(step.evidenceRefs ?? [], hydration.evidenceRefs)
    || (step.evidenceFreshnessStatus ?? "unknown") !== hydration.evidenceFreshnessStatus
    || Boolean(step.staleEvidenceBlocks) !== hydration.staleEvidenceBlocks;
}

function jsonValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonValueEqual(item, right[index]));
  }
  if (
    left == null
    || right == null
    || typeof left !== "object"
    || typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (!jsonValueEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => jsonValueEqual(leftRecord[key], rightRecord[key]));
}

function recoveryStepForRequest(
  step: AgenticPlanStep,
  ordinal: number,
  request: RecoverAgenticPlanStepRequest,
): AppendableAgenticPlanStep {
  const retryCount = (step.retryCount ?? 0) + 1;
  if (
    request.strategy === "retry"
    && step.recoveryCode !== "verification_failed"
    && step.recoveryCode !== "missing_source"
  ) {
    return {
      ordinal,
      kind: step.kind,
      title: `Retry: ${step.title}`,
      rationale: request.note ?? `Retry the failed step "${step.title}".`,
      status: "approval_required",
      risk: step.risk,
      input: step.input,
      evidenceRefs: step.evidenceRefs,
      evidenceFreshnessStatus: step.recoveryCode === "stale_context" ? "unknown" : step.evidenceFreshnessStatus,
      staleEvidenceBlocks: step.staleEvidenceBlocks,
      verificationStatus: "pending",
      retryCount,
    };
  }

  return {
    ordinal,
    kind: "manual.review",
    title: "Manual recovery review",
    rationale: request.note ?? `Review recovery options for "${step.title}".`,
    status: "approval_required",
    risk: "low",
    input: {
      recoveredStepId: step.id,
      recoveryCode: step.recoveryCode ?? step.errorCode ?? "manual.review",
    },
    evidenceRefs: step.evidenceRefs,
    evidenceFreshnessStatus: step.evidenceFreshnessStatus,
    staleEvidenceBlocks: false,
    verificationStatus: "pending",
    retryCount,
  };
}

const modelPlannerStepSchema = z
  .object({
    kind: agenticPlanStepKindSchema,
    title: z.string().trim().min(1).max(180),
    rationale: z.string().trim().min(1).max(1_000),
    risk: agentActionRiskSchema,
    input: z.record(z.unknown()).optional(),
  })
  .strict();

const modelPlannerOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_000).optional(),
    steps: z.array(modelPlannerStepSchema).min(1).max(8),
  })
  .strict();

const idReferenceSchema = z.object({
  failedRunActionId: z.string().uuid(),
}).strict();

const importRetryInputSchema = z.object({
  importJobId: z.string().uuid(),
}).strict();

export function createModelAgenticPlanPlanner(options: {
  provider?: LLMProvider;
} = {}): AgenticPlanPlanner {
  return {
    async plan(input) {
      const provider = options.provider ?? getChatProvider();
      const raw = await collectModelPlannerText(provider, input);
      const parsed = parseModelPlannerJson(raw);
      if (!parsed.ok) {
        return {
          plannerKind: "model",
          summary: "Model planner output requires manual review.",
          steps: [unsafeModelStepReview("manual.review", "The planner did not return valid JSON.")],
        };
      }
      return normalizeModelPlannerOutput(parsed.value);
    },
  };
}

async function collectModelPlannerText(
  provider: LLMProvider,
  input: AgenticPlanPlanningInput,
): Promise<string> {
  let text = "";
  for await (const chunk of provider.streamGenerate({
    messages: [
      {
        role: "system",
        content: [
          "You are the OpenCairn agentic plan planner.",
          "Return only one strict JSON object with keys summary and steps.",
          "Each step must use an allow-listed kind and must not include workspaceId, projectId, userId, or actorUserId in input.",
          "Use manual.review when the goal lacks concrete IDs needed for an executable step.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          goal: input.goal,
          target: input.target,
          allowedStepKinds: agenticPlanStepKindSchema.options,
          allowedRisks: agentActionRiskSchema.options,
        }),
      },
    ],
    maxOutputTokens: 1_600,
    temperature: 0.1,
    thinkingLevel: "low",
  })) {
    if ("delta" in chunk) {
      text += chunk.delta;
      if (text.length > 24_000) break;
    }
  }
  return text;
}

function parseModelPlannerJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: false };
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = fenced?.trim() ?? text.slice(
    Math.max(0, text.indexOf("{")),
    text.lastIndexOf("}") + 1,
  );
  if (!candidate.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    return { ok: false };
  }
}

function normalizePlanningResult(result: AgenticPlanPlanningResult): AgenticPlanPlanningResult {
  if (result.plannerKind !== "model") {
    return {
      plannerKind: "deterministic",
      summary: result.summary ?? summaryForSteps(result.steps, "deterministic"),
      steps: result.steps.length > 0 ? result.steps : planStepsForGoal("manual review"),
    };
  }
  return normalizeModelPlannerOutput({
    summary: result.summary,
    steps: result.steps,
  });
}

function normalizeModelPlannerOutput(raw: unknown): AgenticPlanPlanningResult {
  const parsed = modelPlannerOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const steps = [unsafeModelStepReview("manual.review", "The planner output did not match the model plan schema.")];
    return {
      plannerKind: "model",
      summary: summaryForSteps(steps, "model"),
      steps,
    };
  }

  const steps = dedupeStepKinds(parsed.data.steps.map(normalizeModelStep));
  return {
    plannerKind: "model",
    summary: parsed.data.summary ?? summaryForSteps(steps, "model"),
    steps,
  };
}

function normalizeModelStep(step: z.infer<typeof modelPlannerStepSchema>): PlannedStepInput {
  const input = step.input ?? {};
  switch (step.kind) {
    case "note.review_update": {
      const parsed = noteUpdateActionInputSchema.safeParse(input);
      return parsed.success
        ? { ...step, risk: "write", input: parsed.data }
        : unsafeModelStepReview(step.kind, "note.review_update requires a validated note update draft.");
    }
    case "document.generate": {
      const parsed = generateProjectObjectActionSchema.safeParse(input);
      return parsed.success
        ? { ...step, risk: "expensive", input: parsed.data }
        : unsafeModelStepReview(step.kind, "document.generate requires a validated generation request.");
    }
    case "file.export": {
      const parsed = exportProjectObjectActionSchema.safeParse(input);
      return parsed.success
        ? { ...step, risk: "external", input: parsed.data }
        : unsafeModelStepReview(step.kind, "file.export requires a validated export target.");
    }
    case "code.run": {
      const parsed = codeWorkspaceCommandRunRequestSchema.safeParse(input);
      return parsed.success
        ? { ...step, risk: "expensive", input: parsed.data }
        : unsafeModelStepReview(step.kind, "code.run requires a validated code workspace snapshot and command.");
    }
    case "code.repair": {
      const parsed = idReferenceSchema.safeParse(input);
      return parsed.success
        ? { ...step, risk: "write", input: parsed.data }
        : unsafeModelStepReview(step.kind, "code.repair requires a validated failed run action id.");
    }
    case "import.retry": {
      const parsed = importRetryInputSchema.safeParse(input);
      return parsed.success
        ? { ...step, risk: "write", input: parsed.data }
        : unsafeModelStepReview(step.kind, "import.retry requires a validated failed import job id.");
    }
    case "agent.run": {
      const parsed = plan8AgentRunInputSchema.safeParse(input);
      return parsed.success
        ? { ...step, risk: agentRunRisk(parsed.data.agentName), input: parsed.data }
        : unsafeModelStepReview(step.kind, "agent.run requires a validated Plan8 agent input.");
    }
    case "manual.review":
      return {
        kind: "manual.review",
        title: step.title,
        rationale: step.rationale,
        risk: "low",
        input: {},
      };
  }
}

function unsafeModelStepReview(
  rejectedKind: AgenticPlanStepKind,
  reason: string,
): PlannedStepInput {
  return {
    kind: "manual.review",
    title: "Review unsafe model plan step",
    rationale: reason,
    risk: "low",
    input: { rejectedKind },
  };
}

export function planStepsForGoal(
  goal: string,
  target: Record<string, unknown> = {},
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
  target: Record<string, unknown>,
): PlannedStepInput | null {
  const agentName = plan8AgentNameForGoal(goalText);
  if (!agentName) return null;
  const input: Record<string, unknown> = { agentName };
  const noteId = typeof target.noteId === "string" ? target.noteId : null;
  if (agentName === "narrator" && noteId) input.noteId = noteId;
  if (agentName === "synthesis" && noteId) input.noteIds = [noteId];

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

async function syncAndRefreshPlan(
  repo: AgenticPlanRepository,
  projectId: string,
  plan: AgenticPlan,
): Promise<AgenticPlan> {
  const changed = await repo.syncLinkedRunStatuses?.(plan);
  if (!changed) return plan;
  return refreshPlanStatus(repo, projectId, plan.id);
}

async function syncLinkedStepStatuses(conn: DB, plan: AgenticPlan): Promise<boolean> {
  const linkedSteps = plan.steps.filter((step) => step.linkedRunType && step.linkedRunId);
  if (linkedSteps.length === 0) return false;

  const snapshots = await loadLinkedRunSnapshots(conn, linkedSteps);
  let changed = false;
  for (const step of linkedSteps) {
    const snapshot = snapshots.get(linkedRunKey(step.linkedRunType!, step.linkedRunId!));
    if (!snapshot) continue;
    const nextStatus = stepStatusFromLinkedRunStatus(step.linkedRunType!, snapshot.status);
    const nextErrorCode = snapshot.errorCode;
    const nextErrorMessage = snapshot.errorMessage;
    if (
      step.status === nextStatus
      && (step.errorCode ?? null) === nextErrorCode
      && (step.errorMessage ?? null) === nextErrorMessage
    ) {
      continue;
    }
    await conn
      .update(agenticPlanSteps)
      .set({
        status: nextStatus,
        errorCode: nextErrorCode,
        errorMessage: nextErrorMessage,
        updatedAt: new Date(),
        completedAt: terminalStepStatus(nextStatus) ? new Date() : null,
      })
      .where(eq(agenticPlanSteps.id, step.id));
    changed = true;
  }
  return changed;
}

type LinkedRunSnapshot = {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
};

async function loadLinkedRunSnapshots(
  conn: DB,
  steps: AgenticPlanStep[],
): Promise<Map<string, LinkedRunSnapshot>> {
  const snapshots = new Map<string, LinkedRunSnapshot>();
  const agentActionIds = linkedRunIdsFor(steps, "agent_action");
  const importJobIds = linkedRunIdsFor(steps, "import_job");
  const plan8RunIds = linkedRunIdsFor(steps, "plan8_agent");

  if (agentActionIds.length > 0) {
    const rows = await conn
      .select({
        id: agentActions.id,
        status: agentActions.status,
        errorCode: agentActions.errorCode,
      })
      .from(agentActions)
      .where(inArray(agentActions.id, agentActionIds));
    for (const row of rows) {
      snapshots.set(linkedRunKey("agent_action", row.id), {
        status: row.status,
        errorCode: row.errorCode,
        errorMessage: null,
      });
    }
  }

  if (importJobIds.length > 0) {
    const rows = await conn
      .select({
        id: importJobs.id,
        status: importJobs.status,
        errorSummary: importJobs.errorSummary,
      })
      .from(importJobs)
      .where(inArray(importJobs.id, importJobIds));
    for (const row of rows) {
      snapshots.set(linkedRunKey("import_job", row.id), {
        status: row.status,
        errorCode: row.status === "failed" ? "import_failed" : null,
        errorMessage: row.status === "failed" ? row.errorSummary : null,
      });
    }
  }

  if (plan8RunIds.length > 0) {
    const rows = await conn
      .select({
        runId: agentRuns.runId,
        status: agentRuns.status,
        errorMessage: agentRuns.errorMessage,
      })
      .from(agentRuns)
      .where(inArray(agentRuns.runId, plan8RunIds));
    for (const row of rows) {
      snapshots.set(linkedRunKey("plan8_agent", row.runId), {
        status: row.status,
        errorCode: row.status === "failed" ? "plan8_agent_failed" : null,
        errorMessage: row.status === "failed" ? row.errorMessage : null,
      });
    }
  }

  return snapshots;
}

function linkedRunIdsFor(steps: AgenticPlanStep[], linkedRunType: string): string[] {
  return [
    ...new Set(
      steps
        .filter((step) => step.linkedRunType === linkedRunType && step.linkedRunId)
        .map((step) => step.linkedRunId!),
    ),
  ];
}

function linkedRunKey(linkedRunType: string, linkedRunId: string): string {
  return `${linkedRunType}:${linkedRunId}`;
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
      evidenceRefs: step.evidenceRefs,
      evidenceFreshnessStatus: step.evidenceFreshnessStatus,
      staleEvidenceBlocks: step.staleEvidenceBlocks,
      verificationStatus: step.verificationStatus,
      recoveryCode: step.recoveryCode,
      retryCount: step.retryCount,
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

function summaryForSteps(
  steps: PlannedStepInput[],
  plannerKind: AgenticPlanPlannerKind = "deterministic",
): string {
  const labels = steps.map((step) => step.kind).join(", ");
  return `${steps.length}-step ${plannerKind} plan: ${labels}`;
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
