import { describe, expect, it } from "vitest";
import {
  createAgenticPlan,
  recoverAgenticPlanStep,
  planStepsForGoal,
} from "./agentic-plans";
import {
  createMemoryAgenticPlanRepo,
  projectId,
} from "./agentic-plans-test-helper";

const userId = "user-1";

describe("agentic plan service", () => {
  it("plans a Korean note goal as a reviewable note update step", () => {
    expect(planStepsForGoal("노트 내용을 검토하고 업데이트해줘")[0]).toMatchObject({
      kind: "note.review_update",
      risk: "write",
    });
  });

  it("plans an English export goal as a file export step", () => {
    expect(planStepsForGoal("Export this report to Google Docs")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "file.export",
          risk: "external",
        }),
      ]),
    );
  });

  it("plans a code goal as an expensive code run step", () => {
    expect(planStepsForGoal("Run code tests for this workspace")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "code.run",
          risk: "expensive",
        }),
      ]),
    );
  });

  it("falls back to manual review for unknown goals", () => {
    expect(planStepsForGoal("Make this better")).toEqual([
      expect.objectContaining({
        kind: "manual.review",
        risk: "low",
      }),
    ]);
  });

  it("recovery retry appends a new step without deleting the failed step", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await createAgenticPlan(
      projectId,
      userId,
      { goal: "code test failure repair" },
      { repo, canReadProject: async () => true },
    );
    const failedStep = plan.steps[0]!;
    await repo.updateStepStatus({
      planId: plan.id,
      stepId: failedStep.id,
      status: "failed",
    });

    const recovered = await recoverAgenticPlanStep(
      projectId,
      userId,
      plan.id,
      { stepId: failedStep.id, strategy: "retry" },
      { repo, canWriteProject: async () => true },
    );

    expect(recovered.steps).toHaveLength(plan.steps.length + 1);
    expect(recovered.steps.find((step) => step.id === failedStep.id)?.status).toBe("failed");
    expect(recovered.steps.at(-1)).toMatchObject({
      kind: failedStep.kind,
      title: `Retry: ${failedStep.title}`,
      status: "approval_required",
    });
  });
});
