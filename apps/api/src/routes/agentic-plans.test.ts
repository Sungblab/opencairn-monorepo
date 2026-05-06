import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AgentAction, AgenticPlan, CreateAgentActionRequest } from "@opencairn/shared";
import { createAgenticPlanRoutes } from "./agentic-plans";
import type { AppEnv } from "../lib/types";
import {
  createMemoryAgenticPlanRepo,
  workspaceId,
} from "../lib/agentic-plans-test-helper";

const userId = "user-1";
const projectId = "00000000-0000-4000-8000-000000000002";
const otherProjectId = "00000000-0000-4000-8000-000000000099";
const exportObjectId = "00000000-0000-4000-8000-000000000010";
const actionId = "00000000-0000-4000-8000-000000000020";

describe("agentic plan routes", () => {
  it("creates, lists, reads, starts, and recovers a project plan", async () => {
    const app = createTestApp();

    const createResponse = await app.request(`/api/projects/${projectId}/agentic-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Make this better" }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { plan: AgenticPlan };
    expect(created.plan.steps).toHaveLength(1);
    expect(created.plan.steps[0]).toMatchObject({
      kind: "manual.review",
      status: "approval_required",
    });

    const listResponse = await app.request(`/api/projects/${projectId}/agentic-plans`);
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json() as { plans: AgenticPlan[] }).plans).toHaveLength(1);

    const getResponse = await app.request(
      `/api/projects/${projectId}/agentic-plans/${created.plan.id}`,
    );
    expect(getResponse.status).toBe(200);

    const startResponse = await app.request(
      `/api/projects/${projectId}/agentic-plans/${created.plan.id}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(startResponse.status).toBe(200);
    const started = await startResponse.json() as { plan: AgenticPlan };
    expect(started.plan.status).toBe("blocked");
    expect(started.plan.steps[0]?.status).toBe("blocked");

    const recoverResponse = await app.request(
      `/api/projects/${projectId}/agentic-plans/${created.plan.id}/recover`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: started.plan.steps[0]?.id,
          strategy: "manual_review",
        }),
      },
    );
    expect(recoverResponse.status).toBe(200);
    const recovered = await recoverResponse.json() as { plan: AgenticPlan };
    expect(recovered.plan.steps).toHaveLength(2);
    expect(recovered.plan.steps[1]).toMatchObject({
      kind: "manual.review",
      status: "approval_required",
    });
  });

  it("does not return a plan through another project route", async () => {
    const app = createTestApp();
    const createResponse = await app.request(`/api/projects/${projectId}/agentic-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Export this report" }),
    });
    const created = await createResponse.json() as { plan: AgenticPlan };

    const response = await app.request(
      `/api/projects/${otherProjectId}/agentic-plans/${created.plan.id}`,
    );

    expect(response.status).toBe(404);
  });

  it("requires write permission for start", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Manual review",
      goal: "Make this better",
      status: "approval_required",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: manual.review",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "manual.review",
          title: "Review goal",
          rationale: "Manual review is required.",
          risk: "low",
        },
      ],
    });
    const app = createTestApp({ repo, canWriteProject: async () => false });

    const response = await app.request(
      `/api/projects/${projectId}/agentic-plans/${plan.id}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(403);
  });

  it("requires write permission for create", async () => {
    const app = createTestApp({ canWriteProject: async () => false });

    const response = await app.request(`/api/projects/${projectId}/agentic-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Make this better" }),
    });

    expect(response.status).toBe(403);
  });

  it("starts a concrete plan step through the injected action materializer", async () => {
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
    const requests: CreateAgentActionRequest[] = [];
    const app = createTestApp({
      repo,
      createAgentAction: async (_, __, request) => {
        requests.push(request);
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

    const response = await app.request(
      `/api/projects/${projectId}/agentic-plans/${plan.id}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { plan: AgenticPlan };
    expect(requests).toHaveLength(1);
    expect(body.plan.steps[0]).toMatchObject({
      linkedRunType: "agent_action",
      linkedRunId: actionId,
      status: "approval_required",
    });
  });

  it("accepts cancel recovery and terminal-transitions the blocked step", async () => {
    const repo = createMemoryAgenticPlanRepo();
    const plan = await repo.insertPlan({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Blocked plan",
      goal: "Blocked plan",
      status: "blocked",
      target: { workspaceId, projectId },
      plannerKind: "deterministic",
      summary: "1-step deterministic plan: manual.review",
      currentStepOrdinal: 1,
      steps: [
        {
          kind: "manual.review",
          title: "Review missing source",
          rationale: "The source is missing.",
          risk: "low",
          recoveryCode: "missing_source",
        },
      ],
    });
    const step = plan.steps[0]!;
    await repo.updateStep({
      planId: plan.id,
      stepId: step.id,
      status: "blocked",
      recoveryCode: "missing_source",
      errorCode: "missing_source",
    });
    const app = createTestApp({ repo });

    const response = await app.request(
      `/api/projects/${projectId}/agentic-plans/${plan.id}/recover`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: step.id,
          strategy: "cancel",
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { plan: AgenticPlan };
    expect(body.plan.steps).toHaveLength(1);
    expect(body.plan.steps[0]).toMatchObject({
      status: "cancelled",
      errorCode: "cancelled",
    });
    expect(body.plan.status).toBe("cancelled");
  });
});

function createTestApp(options?: {
  repo?: ReturnType<typeof createMemoryAgenticPlanRepo>;
  canWriteProject?: () => Promise<boolean>;
  createAgentAction?: (
    projectId: string,
    actorUserId: string,
    request: CreateAgentActionRequest,
  ) => Promise<{ action: AgentAction; idempotent: boolean }>;
}) {
  const repo = options?.repo ?? createMemoryAgenticPlanRepo();
  return new Hono<AppEnv>().route(
    "/api",
    createAgenticPlanRoutes({
      repo,
      canReadProject: async () => true,
      canWriteProject: options?.canWriteProject ?? (async () => true),
      ...(options?.createAgentAction ? { createAgentAction: options.createAgentAction } : {}),
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
    }),
  );
}

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
