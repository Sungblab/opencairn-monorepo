import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db, researchRuns, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// --- Temporal client mock ---
// Hoisted — vitest.mock must not capture closures.
const workflowStartSpy = vi.fn().mockResolvedValue(undefined);
const workflowSignalSpy = vi.fn().mockResolvedValue(undefined);
const workflowCancelSpy = vi.fn().mockResolvedValue(undefined);
const getHandleSpy = vi.fn(() => ({
  signal: workflowSignalSpy,
  cancel: workflowCancelSpy,
}));
vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: async () => ({
    workflow: {
      start: workflowStartSpy,
      getHandle: getHandleSpy,
    },
  }),
}));

// Feature flag on for all tests; individual tests can override.
process.env.FEATURE_DEEP_RESEARCH = "true";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

describe("POST /api/research/runs", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowStartSpy.mockClear();
    workflowSignalSpy.mockClear();
    workflowCancelSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("creates run, inserts DB row, and starts workflow", async () => {
    const res = await authedFetch("/api/research/runs", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        topic: "LLM scaling laws evolution 2024-2026",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, body.runId));
    expect(row).toBeDefined();
    expect(row!.status).toBe("planning");
    expect(row!.workflowId).toBe(body.runId);
    expect(row!.billingPath).toBe("byok");

    expect(workflowStartSpy).toHaveBeenCalledTimes(1);
    const [wfName, wfOpts] = workflowStartSpy.mock.calls[0];
    expect(wfName).toBe("DeepResearchWorkflow");
    expect(wfOpts.workflowId).toBe(body.runId);
    expect(wfOpts.args[0].run_id).toBe(body.runId);
    expect(wfOpts.args[0].user_id).toBe(ctx.userId);
  });

  it("returns 403 when user lacks write on project", async () => {
    const viewer = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authedFetch("/api/research/runs", {
        method: "POST",
        userId: viewer.userId,
        body: JSON.stringify({
          workspaceId: viewer.workspaceId,
          projectId: viewer.projectId,
          topic: "test",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
        }),
      });
      expect(res.status).toBe(403);
      expect(workflowStartSpy).not.toHaveBeenCalled();
    } finally {
      await viewer.cleanup();
    }
  });

  it("returns 400 on zod validation failure", async () => {
    const res = await authedFetch("/api/research/runs", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        topic: "",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 on managed billingPath when FEATURE_MANAGED_DEEP_RESEARCH is off", async () => {
    process.env.FEATURE_MANAGED_DEEP_RESEARCH = "false";
    const res = await authedFetch("/api/research/runs", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        topic: "test",
        model: "deep-research-preview-04-2026",
        billingPath: "managed",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("managed_disabled");
  });

  it("returns 404 when project is in a different workspace than declared", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch("/api/research/runs", {
        method: "POST",
        userId: ctx.userId,
        // projectId belongs to `other`, workspaceId belongs to `ctx`
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          projectId: other.projectId,
          topic: "test",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });

  it("returns 404 when FEATURE_DEEP_RESEARCH is off", async () => {
    process.env.FEATURE_DEEP_RESEARCH = "false";
    try {
      const res = await authedFetch("/api/research/runs", {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          topic: "test",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      process.env.FEATURE_DEEP_RESEARCH = "true";
    }
  });
});
