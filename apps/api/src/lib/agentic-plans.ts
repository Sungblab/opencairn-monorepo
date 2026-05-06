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
  AgentActionRisk,
  AgenticPlan,
  AgenticPlanStatus,
  AgenticPlanStep,
  AgenticPlanStepKind,
  AgenticPlanStepStatus,
  CreateAgenticPlanRequest,
  RecoverAgenticPlanStepRequest,
  StartAgenticPlanRequest,
} from "@opencairn/shared";
import { agenticPlanSchema } from "@opencairn/shared";
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

  if (!(await canReadProject(actorUserId, projectId, options))) {
    throw new AgenticPlanError("forbidden", 403);
  }

  const steps = planStepsForGoal(request.goal);
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
    if (step.risk === "low" && step.kind === "manual.review") {
      await repo.updateStepStatus({
        planId,
        stepId: step.id,
        status: "blocked",
      });
    }
  }

  return refreshPlanStatus(repo, projectId, planId);
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

export function planStepsForGoal(goal: string): PlannedStepInput[] {
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
