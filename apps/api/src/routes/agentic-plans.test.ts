import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AgenticPlan } from "@opencairn/shared";
import { createAgenticPlanRoutes } from "./agentic-plans";
import type { AppEnv } from "../lib/types";
import { createMemoryAgenticPlanRepo } from "../lib/agentic-plans-test-helper";

const userId = "user-1";
const projectId = "00000000-0000-4000-8000-000000000002";
const otherProjectId = "00000000-0000-4000-8000-000000000099";

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
    const app = createTestApp({ repo, canWriteProject: async () => false });
    const createResponse = await app.request(`/api/projects/${projectId}/agentic-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "Make this better" }),
    });
    const created = await createResponse.json() as { plan: AgenticPlan };

    const response = await app.request(
      `/api/projects/${projectId}/agentic-plans/${created.plan.id}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(403);
  });
});

function createTestApp(options?: {
  repo?: ReturnType<typeof createMemoryAgenticPlanRepo>;
  canWriteProject?: () => Promise<boolean>;
}) {
  const repo = options?.repo ?? createMemoryAgenticPlanRepo();
  return new Hono<AppEnv>().route(
    "/api",
    createAgenticPlanRoutes({
      repo,
      canReadProject: async () => true,
      canWriteProject: options?.canWriteProject ?? (async () => true),
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
    }),
  );
}
