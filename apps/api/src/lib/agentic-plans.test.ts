import { describe, expect, it } from "vitest";
import type { AgentAction } from "@opencairn/shared";
import {
  createAgenticPlan,
  getAgenticPlan,
  listAgenticPlans,
  recordAgenticPlanHandoff,
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
const plan8RunId = "00000000-0000-4000-8000-000000000040";
const childPlan8RunId = "00000000-0000-4000-8000-000000000041";

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

  it("plans a Plan8 librarian goal as a concrete agent run step", () => {
    expect(planStepsForGoal("Run the librarian agent for this project")).toEqual([
      expect.objectContaining({
        kind: "agent.run",
        risk: "write",
        input: {
          agentName: "librarian",
        },
      }),
    ]);
  });

  it("threads a target note into narrator agent run planning", () => {
    expect(planStepsForGoal("Create narrator audio", { noteId: exportObjectId })).toEqual([
      expect.objectContaining({
        kind: "agent.run",
        risk: "expensive",
        input: {
          agentName: "narrator",
          noteId: exportObjectId,
        },
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

  it("links an import retry plan step to the retry job when no action is returned", async () => {
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

    const started = await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      retryImportJob: async () => ({
        jobId: retryJobId,
        action: null,
      }),
    });

    expect(started.steps[0]).toMatchObject({
      kind: "import.retry",
      status: "queued",
      linkedRunType: "import_job",
      linkedRunId: retryJobId,
      errorCode: null,
    });
  });

  it("links an agent run plan step to a Plan8 agent run when started", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Run librarian",
      goal: "Run librarian",
      status: "approval_required",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: agent.run",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "agent.run",
          title: "Run librarian",
          rationale: "The user approved a concrete Plan8 agent run.",
          risk: "write",
          input: {
            agentName: "librarian",
          },
        },
      ],
    });
    const calls: Array<{ projectId: string; actorUserId: string; agentName: string }> = [];

    const started = await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      runPlan8Agent: async (pid, actor, input) => {
        calls.push({ projectId: pid, actorUserId: actor, agentName: input.agentName });
        return {
          runId: plan8RunId,
          status: "running",
        };
      },
    });

    expect(calls).toEqual([{ projectId, actorUserId: userId, agentName: "librarian" }]);
    expect(started.steps[0]).toMatchObject({
      kind: "agent.run",
      status: "running",
      linkedRunType: "plan8_agent",
      linkedRunId: plan8RunId,
      errorCode: null,
    });
  });

  it("refreshes linked run status when reading a plan", async () => {
    const baseRepo = createMemoryAgenticPlanRepo();
    const repo = {
      ...baseRepo,
      async syncLinkedRunStatuses(plan) {
        const step = plan.steps[0]!;
        await baseRepo.updateStep({
          planId: plan.id,
          stepId: step.id,
          status: "completed",
          errorCode: null,
          errorMessage: null,
        });
        return true;
      },
    } satisfies typeof baseRepo;
    const plan = await baseRepo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Run librarian",
      goal: "Run librarian",
      status: "running",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: agent.run",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "agent.run",
          title: "Run librarian",
          rationale: "The linked run has completed.",
          risk: "write",
          input: {
            agentName: "librarian",
          },
        },
      ],
    });
    const step = plan.steps[0]!;
    await baseRepo.updateStep({
      planId: plan.id,
      stepId: step.id,
      status: "running",
      linkedRunType: "plan8_agent",
      linkedRunId: plan8RunId,
    });

    const refreshed = await getAgenticPlan(projectId, userId, plan.id, {
      repo,
      canReadProject: async () => true,
    });

    expect(refreshed).toMatchObject({
      status: "completed",
      currentStepOrdinal: null,
    });
    expect(refreshed.steps[0]).toMatchObject({
      status: "completed",
      linkedRunType: "plan8_agent",
      linkedRunId: plan8RunId,
    });
  });

  it("applies list status filters after refreshing linked runs", async () => {
    const baseRepo = createMemoryAgenticPlanRepo();
    const repo = {
      ...baseRepo,
      async syncLinkedRunStatuses(plan) {
        const step = plan.steps[0]!;
        await baseRepo.updateStep({
          planId: plan.id,
          stepId: step.id,
          status: "completed",
          errorCode: null,
          errorMessage: null,
        });
        return true;
      },
    } satisfies typeof baseRepo;
    const plan = await baseRepo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Run librarian",
      goal: "Run librarian",
      status: "running",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: agent.run",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "agent.run",
          title: "Run librarian",
          rationale: "The linked run has completed.",
          risk: "write",
          input: {
            agentName: "librarian",
          },
        },
      ],
    });
    const step = plan.steps[0]!;
    await baseRepo.updateStep({
      planId: plan.id,
      stepId: step.id,
      status: "running",
      linkedRunType: "plan8_agent",
      linkedRunId: plan8RunId,
    });

    const plans = await listAgenticPlans(projectId, userId, {
      status: "completed",
      limit: 10,
    }, {
      repo,
      canReadProject: async () => true,
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      id: plan.id,
      status: "completed",
    });
  });

  it("blocks an agent run plan step when agent input is incomplete", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Run narrator",
      goal: "Run narrator",
      status: "approval_required",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: agent.run",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "agent.run",
          title: "Run narrator",
          rationale: "Narrator needs an explicit note id.",
          risk: "expensive",
          input: {
            agentName: "narrator",
          },
        },
      ],
    });

    const started = await startAgenticPlan(projectId, userId, plan.id, {}, {
      repo,
      canWriteProject: async () => true,
      runPlan8Agent: async () => {
        throw new Error("incomplete agent.run input should not launch");
      },
    });

    expect(started.steps[0]).toMatchObject({
      kind: "agent.run",
      status: "blocked",
      linkedRunType: null,
      linkedRunId: null,
      errorCode: "agentic_plan_step_missing_input",
    });
  });

  it("records a runtime handoff as a linked child plan step", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Run librarian",
      goal: "Run librarian",
      status: "running",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: agent.run",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "agent.run",
          title: "Run librarian",
          rationale: "The root agent run is already linked.",
          risk: "write",
          input: {
            agentName: "librarian",
          },
        },
      ],
    });
    await repo.updateStep({
      planId: plan.id,
      stepId: plan.steps[0]!.id,
      status: "running",
      linkedRunType: "plan8_agent",
      linkedRunId: plan8RunId,
    });

    const updated = await recordAgenticPlanHandoff(projectId, {
      parentRunId: plan8RunId,
      childRunId: childPlan8RunId,
      childAgentName: "synthesis",
      reason: "Needs a focused synthesis pass.",
      childStatus: "running",
    }, {
      repo,
    });

    expect(updated?.steps).toHaveLength(2);
    expect(updated?.steps[1]).toMatchObject({
      ordinal: 2,
      kind: "agent.run",
      title: "Handoff to synthesis",
      status: "running",
      linkedRunType: "plan8_agent",
      linkedRunId: childPlan8RunId,
      input: {
        agentName: "synthesis",
        handoff: {
          parentRunId: plan8RunId,
          childRunId: childPlan8RunId,
          reason: "Needs a focused synthesis pass.",
        },
      },
    });
  });

  it("does not append duplicate runtime handoff child steps", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Run librarian",
      goal: "Run librarian",
      status: "running",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: agent.run",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "agent.run",
          title: "Run librarian",
          rationale: "The root agent run is already linked.",
          risk: "write",
          input: {
            agentName: "librarian",
          },
        },
      ],
    });
    await repo.updateStep({
      planId: plan.id,
      stepId: plan.steps[0]!.id,
      status: "running",
      linkedRunType: "plan8_agent",
      linkedRunId: plan8RunId,
    });

    await recordAgenticPlanHandoff(projectId, {
      parentRunId: plan8RunId,
      childRunId: childPlan8RunId,
      childAgentName: "synthesis",
      reason: "Needs a focused synthesis pass.",
      childStatus: "running",
    }, { repo });
    const repeated = await recordAgenticPlanHandoff(projectId, {
      parentRunId: plan8RunId,
      childRunId: childPlan8RunId,
      childAgentName: "synthesis",
      reason: "Needs a focused synthesis pass.",
      childStatus: "running",
    }, { repo });

    expect(repeated?.steps).toHaveLength(2);
  });

  it("rejects runtime handoff cycles", async () => {
    const repo = createMemoryAgenticPlanRepo();

    await expect(
      recordAgenticPlanHandoff(projectId, {
        parentRunId: plan8RunId,
        childRunId: plan8RunId,
        childAgentName: "synthesis",
        reason: "Self handoff should not be recorded.",
        childStatus: "running",
      }, { repo }),
    ).rejects.toMatchObject({
      code: "agentic_plan_handoff_cycle",
      status: 409,
    });
  });

  it("rejects runtime handoffs beyond the bounded depth limit", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Run librarian",
      goal: "Run librarian",
      status: "running",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: agent.run",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "agent.run",
          title: "Run librarian",
          rationale: "The root agent run is already linked.",
          risk: "write",
          input: {
            agentName: "librarian",
          },
        },
      ],
    });
    await repo.updateStep({
      planId: plan.id,
      stepId: plan.steps[0]!.id,
      status: "running",
      linkedRunType: "plan8_agent",
      linkedRunId: plan8RunId,
    });
    const runIds = [
      childPlan8RunId,
      "00000000-0000-4000-8000-000000000042",
      "00000000-0000-4000-8000-000000000043",
      "00000000-0000-4000-8000-000000000044",
    ];
    let parentRunId = plan8RunId;
    for (const runId of runIds) {
      await recordAgenticPlanHandoff(projectId, {
        parentRunId,
        childRunId: runId,
        childAgentName: "synthesis",
        reason: "Nested handoff.",
        childStatus: "running",
      }, { repo });
      parentRunId = runId;
    }

    await expect(
      recordAgenticPlanHandoff(projectId, {
        parentRunId,
        childRunId: "00000000-0000-4000-8000-000000000045",
        childAgentName: "synthesis",
        reason: "Too deep.",
        childStatus: "running",
      }, { repo }),
    ).rejects.toMatchObject({
      code: "agentic_plan_handoff_depth_exceeded",
      status: 409,
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
