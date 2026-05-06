import { describe, expect, it } from "vitest";
import type { AgentAction } from "@opencairn/shared";
import {
  createAgenticPlan,
  recoverAgenticPlanStep,
  planStepsForGoal,
  startAgenticPlan,
} from "./agentic-plans";
import {
  createMemoryAgenticPlanRepo,
  projectId,
  workspaceId,
} from "./agentic-plans-test-helper";

const userId = "user-1";
const exportObjectId = "00000000-0000-4000-8000-000000000010";
const actionId = "00000000-0000-4000-8000-000000000020";
const importJobId = "00000000-0000-4000-8000-000000000030";
const retryJobId = "00000000-0000-4000-8000-000000000031";

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
      { repo, canWriteProject: async () => true },
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

  it("links a concrete file export plan step to an agent action when started", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Export generated report",
      goal: "Export generated report",
      status: "approval_required",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: file.export",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "file.export",
          title: "Export report",
          rationale: "The user approved an explicit export target.",
          risk: "external",
          input: {
            type: "export_project_object",
            objectId: exportObjectId,
            provider: "opencairn_download",
          },
        },
      ],
    });
    const step = plan.steps[0]!;
    const createdRequests: Array<{ projectId: string; actorUserId: string; request: unknown }> = [];

    const started = await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      createAgentAction: async (pid, actor, request) => {
        createdRequests.push({ projectId: pid, actorUserId: actor, request });
        return {
          action: agentAction({
            id: actionId,
            requestId: step.id,
            kind: "file.export",
            status: "approval_required",
            risk: "external",
            input: request.input ?? {},
          }),
          idempotent: false,
        };
      },
    });

    expect(createdRequests).toEqual([
      expect.objectContaining({
        projectId,
        actorUserId: userId,
        request: expect.objectContaining({
          requestId: step.id,
          sourceRunId: `agentic_plan:${plan.id}:step:${step.id}`,
          kind: "file.export",
          risk: "external",
          input: {
            type: "export_project_object",
            objectId: exportObjectId,
            provider: "opencairn_download",
          },
        }),
      }),
    ]);
    expect(started.steps[0]).toMatchObject({
      id: step.id,
      status: "approval_required",
      linkedRunType: "agent_action",
      linkedRunId: actionId,
      errorCode: null,
      errorMessage: null,
    });
  });

  it("blocks an executable plan step with a stable reason when required input is missing", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await createAgenticPlan(
      projectId,
      userId,
      { goal: "Export this report to Google Docs" },
      { repo, canWriteProject: async () => true },
    );

    const started = await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      createAgentAction: async () => {
        throw new Error("createAgentAction should not be called without concrete step input");
      },
    });

    const exportStep = started.steps.find((step) => step.kind === "file.export");
    expect(exportStep).toMatchObject({
      kind: "file.export",
      status: "blocked",
      linkedRunType: null,
      linkedRunId: null,
      errorCode: "agentic_plan_step_missing_input",
      errorMessage: expect.stringContaining("file.export"),
    });
  });

  it("does not rematerialize or clear a linked step on repeated start", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Export generated report",
      goal: "Export generated report",
      status: "approval_required",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: file.export",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "file.export",
          title: "Export report",
          rationale: "The user approved an explicit export target.",
          risk: "external",
          input: {
            type: "export_project_object",
            objectId: exportObjectId,
            provider: "opencairn_download",
          },
        },
      ],
    });
    const step = plan.steps[0]!;
    await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      createAgentAction: async (_, __, request) => ({
        action: agentAction({
          id: actionId,
          requestId: step.id,
          kind: "file.export",
          status: "approval_required",
          risk: "external",
          input: request.input ?? {},
        }),
        idempotent: false,
      }),
    });

    const repeated = await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      createAgentAction: async () => {
        throw new Error("linked steps should not create another action");
      },
    });

    expect(repeated.steps[0]).toMatchObject({
      id: step.id,
      status: "approval_required",
      linkedRunType: "agent_action",
      linkedRunId: actionId,
      errorCode: null,
    });
  });

  it("links an import retry plan step to the retry action when started", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Retry failed import",
      goal: "Retry failed import",
      status: "approval_required",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: import.retry",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "import.retry",
          title: "Retry import",
          rationale: "The failed import has an explicit job id.",
          risk: "write",
          input: {
            importJobId,
          },
        },
      ],
    });
    const calls: string[] = [];

    const started = await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      retryImportJob: async (jobId, actor) => {
        calls.push(`${actor}:${jobId}`);
        return {
          jobId: retryJobId,
          action: agentAction({
            id: actionId,
            requestId: retryJobId,
            sourceRunId: retryJobId,
            kind: "import.markdown_zip",
            status: "queued",
            risk: "write",
            input: { source: "markdown_zip" },
          }),
        };
      },
    });

    expect(calls).toEqual([`${userId}:${importJobId}`]);
    expect(started.steps[0]).toMatchObject({
      kind: "import.retry",
      status: "queued",
      linkedRunType: "agent_action",
      linkedRunId: actionId,
      errorCode: null,
    });
  });
});

function agentAction(overrides: Partial<AgentAction> = {}): AgentAction {
  const now = new Date("2026-05-06T00:00:00.000Z").toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000099",
    requestId: "00000000-0000-4000-8000-000000000098",
    workspaceId,
    projectId,
    actorUserId: userId,
    sourceRunId: null,
    kind: "workflow.placeholder",
    status: "completed",
    risk: "low",
    input: {},
    preview: null,
    result: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
