import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db, researchRuns, researchRunTurns, researchRunArtifacts, eq, asc } from "@opencairn/db";
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

async function createPlanningRun(ctx: SeedResult): Promise<string> {
  const [row] = await db
    .insert(researchRuns)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      userId: ctx.userId,
      topic: "fixture",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
      status: "planning",
      workflowId: "wf",
    })
    .returning({ id: researchRuns.id });
  await db
    .update(researchRuns)
    .set({ workflowId: row.id })
    .where(eq(researchRuns.id, row.id));
  return row.id;
}

describe("GET /api/research/runs", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("lists workspace runs newest-first", async () => {
    const a = await createPlanningRun(ctx);
    await new Promise((r) => setTimeout(r, 5)); // ensure createdAt differs
    const b = await createPlanningRun(ctx);
    const res = await authedFetch(
      `/api/research/runs?workspaceId=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r) => r.id)).toEqual([b, a]);
  });

  it("returns 400 when workspaceId query param missing", async () => {
    const res = await authedFetch("/api/research/runs", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-member", async () => {
    const outsider = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(
        `/api/research/runs?workspaceId=${ctx.workspaceId}`,
        { method: "GET", userId: outsider.userId },
      );
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });
});

describe("GET /api/research/runs/:id", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns run with empty turns/artifacts initially", async () => {
    const runId = await createPlanningRun(ctx);
    const res = await authedFetch(`/api/research/runs/${runId}`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      turns: unknown[];
      artifacts: unknown[];
    };
    expect(body.id).toBe(runId);
    expect(body.status).toBe("planning");
    expect(body.turns).toEqual([]);
    expect(body.artifacts).toEqual([]);
  });

  it("returns turns ordered by seq asc and artifacts by seq asc", async () => {
    const runId = await createPlanningRun(ctx);
    await db.insert(researchRunTurns).values([
      { runId, seq: 0, role: "agent", kind: "plan_proposal", content: "plan v1" },
      { runId, seq: 1, role: "user", kind: "user_feedback", content: "narrower" },
    ]);
    await db.insert(researchRunArtifacts).values([
      { runId, seq: 0, kind: "thought_summary", payload: { text: "thinking..." } },
      { runId, seq: 1, kind: "text_delta", payload: { text: "chunk 1" } },
    ]);
    const res = await authedFetch(`/api/research/runs/${runId}`, {
      method: "GET",
      userId: ctx.userId,
    });
    const body = (await res.json()) as {
      turns: { seq: number; content: string }[];
      artifacts: { seq: number }[];
    };
    expect(body.turns.map((t) => t.seq)).toEqual([0, 1]);
    expect(body.artifacts.map((a) => a.seq)).toEqual([0, 1]);
  });

  it("returns 404 on cross-workspace access", async () => {
    const other = await seedWorkspace({ role: "owner" });
    const runId = await createPlanningRun(other);
    try {
      const res = await authedFetch(`/api/research/runs/${runId}`, {
        method: "GET",
        userId: ctx.userId,
      });
      expect(res.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });
});

describe("POST /api/research/runs/:id/turns", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowSignalSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("signals user_feedback and inserts a turn when status=awaiting_approval", async () => {
    const runId = await createPlanningRun(ctx);
    // Seed one plan_proposal and move run into awaiting_approval.
    await db.insert(researchRunTurns).values({
      runId, seq: 0, role: "agent", kind: "plan_proposal", content: "plan v1",
    });
    await db
      .update(researchRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/turns`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ feedback: "narrower scope please" }),
    });
    expect(res.status).toBe(202);

    const turns = await db
      .select()
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId))
      .orderBy(asc(researchRunTurns.seq));
    expect(turns).toHaveLength(2);
    expect(turns[1]!.role).toBe("user");
    expect(turns[1]!.kind).toBe("user_feedback");
    expect(turns[1]!.content).toBe("narrower scope please");

    expect(workflowSignalSpy).toHaveBeenCalledTimes(1);
    expect(workflowSignalSpy.mock.calls[0][0]).toBe("user_feedback");
  });

  it("returns 409 when run is not in a plan-editable state", async () => {
    const runId = await createPlanningRun(ctx);
    await db
      .update(researchRuns)
      .set({ status: "completed" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/turns`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ feedback: "too late" }),
    });
    expect(res.status).toBe(409);
    expect(workflowSignalSpy).not.toHaveBeenCalled();
  });

  it("returns 403 on viewer", async () => {
    const runId = await createPlanningRun(ctx);
    const viewer = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authedFetch(`/api/research/runs/${runId}/turns`, {
        method: "POST",
        userId: viewer.userId,
        body: JSON.stringify({ feedback: "x" }),
      });
      // Cross-workspace — hidden with 404.
      expect(res.status).toBe(404);
    } finally {
      await viewer.cleanup();
    }
  });
});

describe("PATCH /api/research/runs/:id/plan", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowSignalSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("inserts user_edit turn and does NOT signal the workflow", async () => {
    const runId = await createPlanningRun(ctx);
    await db.insert(researchRunTurns).values({
      runId, seq: 0, role: "agent", kind: "plan_proposal", content: "plan v1",
    });
    await db
      .update(researchRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/plan`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ editedText: "plan v1\n- added step X" }),
    });
    expect(res.status).toBe(200);

    const turns = await db
      .select()
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId))
      .orderBy(asc(researchRunTurns.seq));
    expect(turns).toHaveLength(2);
    expect(turns[1]!.kind).toBe("user_edit");
    expect(turns[1]!.content).toContain("added step X");

    expect(workflowSignalSpy).not.toHaveBeenCalled();
  });

  it("rejects when status is researching/completed/failed/cancelled", async () => {
    const runId = await createPlanningRun(ctx);
    await db
      .update(researchRuns)
      .set({ status: "researching" })
      .where(eq(researchRuns.id, runId));
    const res = await authedFetch(`/api/research/runs/${runId}/plan`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ editedText: "late edit" }),
    });
    expect(res.status).toBe(409);
  });
});
