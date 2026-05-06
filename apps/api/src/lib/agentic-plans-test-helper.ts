import { randomUUID } from "node:crypto";
import type {
  AgenticPlan,
  AgenticPlanStepStatus,
} from "@opencairn/shared";
import type { AgenticPlanRepository } from "./agentic-plans";

export const workspaceId = "00000000-0000-4000-8000-000000000001";
export const projectId = "00000000-0000-4000-8000-000000000002";

export function createMemoryAgenticPlanRepo(): AgenticPlanRepository {
  const plans = new Map<string, AgenticPlan>();
  return {
    async findProjectScope(pid) {
      return pid === projectId ? { workspaceId } : null;
    },
    async insertPlan(values) {
      const now = new Date().toISOString();
      const planId = randomUUID();
      const plan: AgenticPlan = {
        id: planId,
        workspaceId: values.workspaceId,
        projectId: values.projectId,
        actorUserId: values.actorUserId,
        title: values.title,
        goal: values.goal,
        status: values.status,
        target: {
          workspaceId: values.workspaceId,
          projectId: values.projectId,
          ...values.target,
        },
        plannerKind: values.plannerKind,
        summary: values.summary,
        currentStepOrdinal: values.currentStepOrdinal,
        steps: values.steps.map((step, index) => ({
          id: randomUUID(),
          planId,
          ordinal: index + 1,
          kind: step.kind,
          title: step.title,
          rationale: step.rationale,
          status: "approval_required",
          risk: step.risk,
          input: step.input ?? {},
          linkedRunType: null,
          linkedRunId: null,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        })),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      plans.set(plan.id, plan);
      return clone(plan);
    },
    async listByProject({ projectId: pid, status, limit }) {
      return Array.from(plans.values())
        .filter((plan) => plan.projectId === pid)
        .filter((plan) => !status || plan.status === status)
        .slice(0, limit)
        .map(clone);
    },
    async findById({ projectId: pid, planId }) {
      const plan = plans.get(planId);
      return plan && plan.projectId === pid ? clone(plan) : null;
    },
    async updateStepStatus({ planId, stepId, status }) {
      const plan = plans.get(planId);
      if (!plan) return;
      const step = plan.steps.find((candidate) => candidate.id === stepId);
      if (!step) return;
      step.status = status;
      step.updatedAt = new Date().toISOString();
      step.completedAt = terminalStepStatus(status) ? step.updatedAt : null;
    },
    async updateStep({ planId, stepId, status, linkedRunType, linkedRunId, errorCode, errorMessage }) {
      const plan = plans.get(planId);
      if (!plan) return;
      const step = plan.steps.find((candidate) => candidate.id === stepId);
      if (!step) return;
      const now = new Date().toISOString();
      if (status !== undefined) {
        step.status = status;
        step.completedAt = terminalStepStatus(status) ? now : null;
      }
      if (linkedRunType !== undefined) step.linkedRunType = linkedRunType;
      if (linkedRunId !== undefined) step.linkedRunId = linkedRunId;
      if (errorCode !== undefined) step.errorCode = errorCode;
      if (errorMessage !== undefined) step.errorMessage = errorMessage;
      step.updatedAt = now;
    },
    async appendStep({ planId, step }) {
      const plan = plans.get(planId);
      if (!plan) return;
      const now = new Date().toISOString();
      plan.steps.push({
        id: randomUUID(),
        planId,
        ordinal: step.ordinal,
        kind: step.kind,
        title: step.title,
        rationale: step.rationale,
        status: step.status,
        risk: step.risk,
        input: step.input ?? {},
        linkedRunType: null,
        linkedRunId: null,
        errorCode: step.errorCode ?? null,
        errorMessage: step.errorMessage ?? null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
    },
    async updatePlanStatus({ planId, status, currentStepOrdinal, completedAt }) {
      const plan = plans.get(planId);
      if (!plan) return;
      plan.status = status;
      plan.currentStepOrdinal = currentStepOrdinal;
      plan.completedAt = completedAt?.toISOString() ?? null;
      plan.updatedAt = new Date().toISOString();
    },
  };
}

function clone(plan: AgenticPlan): AgenticPlan {
  return structuredClone(plan);
}

function terminalStepStatus(status: AgenticPlanStepStatus): boolean {
  return ["completed", "failed", "cancelled", "skipped"].includes(status);
}
