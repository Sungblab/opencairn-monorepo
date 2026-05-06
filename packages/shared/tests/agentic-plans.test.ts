import { describe, expect, it } from "vitest";
import {
  agenticPlanSchema,
  agenticPlanStepKindSchema,
  createAgenticPlanRequestSchema,
} from "../src/agentic-plans";
import {
  workflowConsoleRunFromAgenticPlan,
  workflowConsoleRunSchema,
} from "../src/workflow-console";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const planId = "00000000-0000-4000-8000-000000000010";
const userId = "user-1";
const createdAt = "2026-05-06T00:00:00.000Z";
const updatedAt = "2026-05-06T00:01:00.000Z";

function planFixture() {
  return agenticPlanSchema.parse({
    id: planId,
    workspaceId,
    projectId,
    actorUserId: userId,
    title: "Prepare launch notes",
    goal: "Review the note and prepare a file export",
    status: "approval_required",
    target: {
      workspaceId,
      projectId,
    },
    plannerKind: "deterministic",
    summary: "2-step plan for review and export.",
    currentStepOrdinal: 1,
    steps: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        planId,
        ordinal: 1,
        kind: "note.review_update",
        title: "Review note update",
        rationale: "The goal references note content.",
        status: "completed",
        risk: "write",
        input: {},
        createdAt,
        updatedAt,
        completedAt: updatedAt,
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        planId,
        ordinal: 2,
        kind: "file.export",
        title: "Prepare export",
        rationale: "The goal asks for an export.",
        status: "approval_required",
        risk: "external",
        input: {},
        createdAt,
        updatedAt,
      },
    ],
    createdAt,
    updatedAt,
  });
}

describe("agentic plan contracts", () => {
  it("rejects a goal shorter than three characters", () => {
    expect(() => createAgenticPlanRequestSchema.parse({ goal: "go" })).toThrow();
  });

  it("accepts a project-level target with workspace and project ids", () => {
    const plan = planFixture();

    expect(plan.target).toEqual({
      workspaceId,
      projectId,
    });
  });

  it("accepts model-backed planner kind", () => {
    const plan = agenticPlanSchema.parse({
      ...planFixture(),
      plannerKind: "model",
      summary: "1-step model plan.",
    });

    expect(plan.plannerKind).toBe("model");
  });

  it("rejects unknown step kinds", () => {
    expect(() => agenticPlanStepKindSchema.parse("unknown.step")).toThrow();
  });

  it("projects plans into workflow console runs", () => {
    const run = workflowConsoleRunFromAgenticPlan(planFixture());

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: `agentic_plan:${planId}`,
      runType: "agentic_plan",
      sourceId: planId,
      status: "approval_required",
      progress: {
        current: 1,
        total: 2,
        percent: 50,
      },
      approvals: [
        {
          approvalId:
            "agentic_plan:00000000-0000-4000-8000-000000000010:step:00000000-0000-4000-8000-000000000012:approval",
          risk: "external",
          status: "requested",
        },
      ],
    });
  });

  it("projects blocked plan step reasons into workflow console errors", () => {
    const run = workflowConsoleRunFromAgenticPlan({
      ...planFixture(),
      status: "blocked",
      steps: planFixture().steps.map((step) =>
        step.kind === "file.export"
          ? {
              ...step,
              status: "blocked",
              errorCode: "agentic_plan_step_missing_input",
              errorMessage: "file.export requires a concrete validated input payload before it can be linked.",
            }
          : step,
      ),
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      status: "blocked",
      error: {
        code: "agentic_plan_step_missing_input",
        message: "file.export requires a concrete validated input payload before it can be linked.",
        retryable: true,
      },
    });
  });
});
