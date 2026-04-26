import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db, codeRuns, codeTurns, notes, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// --- Temporal client mock ---
// Hoisted spies — vitest.mock factory must not capture closures.
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
  taskQueue: () => "ingest",
}));

// Feature flag on for all tests by default; individual tests override.
process.env.FEATURE_CODE_AGENT = "true";

// Internal secret for the worker-callback routes. Set BEFORE app construction
// so the requireInternalSecret middleware reads the same value the test sends.
const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET ?? "test-internal-secret-code-agent";
process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;

// app must be created AFTER the mock above so the route module's import of
// temporal-client resolves to the mocked exports.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = await import("../src/app.js");
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

async function internalFetch(
  path: string,
  init: RequestInit & { secret?: string },
): Promise<Response> {
  const { secret, headers, ...rest } = init;
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      "content-type": "application/json",
      ...(secret === undefined ? {} : { "X-Internal-Secret": secret }),
    },
  });
}

// Helper: create a canvas note for a seeded workspace. The default seed gives
// us a regular note (sourceType=null); canvas runs require sourceType='canvas'.
async function createCanvasNote(
  ctx: SeedResult,
  language: "python" | "javascript" | "html" | "react" = "python",
): Promise<string> {
  const id = randomUUID();
  await db.insert(notes).values({
    id,
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    title: "canvas note",
    type: "note",
    sourceType: "canvas",
    canvasLanguage: language,
    inheritParent: true,
  });
  return id;
}

describe("POST /api/code/run", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowStartSpy.mockClear();
    workflowSignalSpy.mockClear();
    workflowCancelSpy.mockClear();
    process.env.FEATURE_CODE_AGENT = "true";
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns 404 when FEATURE_CODE_AGENT is off", async () => {
    process.env.FEATURE_CODE_AGENT = "false";
    try {
      const noteId = await createCanvasNote(ctx);
      const res = await authedFetch("/api/code/run", {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          noteId,
          prompt: "draw a sine wave",
          language: "python",
        }),
      });
      expect(res.status).toBe(404);
      expect(workflowStartSpy).not.toHaveBeenCalled();
    } finally {
      process.env.FEATURE_CODE_AGENT = "true";
    }
  });

  it("returns 404 when note doesn't exist", async () => {
    const res = await authedFetch("/api/code/run", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        noteId: randomUUID(),
        prompt: "hello",
        language: "python",
      }),
    });
    expect(res.status).toBe(404);
    expect(workflowStartSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when user lacks write permission on the note", async () => {
    // Cross-workspace note — the seed user has no permission on it.
    const other = await seedWorkspace({ role: "owner" });
    try {
      const noteId = await createCanvasNote(other);
      const res = await authedFetch("/api/code/run", {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          noteId,
          prompt: "hello",
          language: "python",
        }),
      });
      expect(res.status).toBe(404);
      expect(workflowStartSpy).not.toHaveBeenCalled();
    } finally {
      await other.cleanup();
    }
  });

  it("returns 409 when note is not a canvas note", async () => {
    // ctx.noteId is a regular note (sourceType=null) per the seed helper.
    const res = await authedFetch("/api/code/run", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        noteId: ctx.noteId,
        prompt: "hello",
        language: "python",
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("notCanvas");
    expect(workflowStartSpy).not.toHaveBeenCalled();
  });

  it("returns 409 when language doesn't match the canvas note's language", async () => {
    const noteId = await createCanvasNote(ctx, "python");
    const res = await authedFetch("/api/code/run", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        noteId,
        prompt: "hello",
        language: "javascript",
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("wrongLanguage");
    expect(workflowStartSpy).not.toHaveBeenCalled();
  });

  it("returns 400 on prompt > 4000 chars (zod)", async () => {
    const noteId = await createCanvasNote(ctx);
    const tooLong = "x".repeat(4001);
    const res = await authedFetch("/api/code/run", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        noteId,
        prompt: tooLong,
        language: "python",
      }),
    });
    expect(res.status).toBe(400);
    expect(workflowStartSpy).not.toHaveBeenCalled();
  });

  it("happy path — inserts code_runs row, starts workflow, returns runId", async () => {
    const noteId = await createCanvasNote(ctx, "python");
    const res = await authedFetch("/api/code/run", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        noteId,
        prompt: "draw a sine wave",
        language: "python",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await db
      .select()
      .from(codeRuns)
      .where(eq(codeRuns.id, body.runId));
    expect(row).toBeDefined();
    expect(row!.noteId).toBe(noteId);
    expect(row!.workspaceId).toBe(ctx.workspaceId);
    expect(row!.userId).toBe(ctx.userId);
    expect(row!.language).toBe("python");
    expect(row!.workflowId).toBe(body.runId);

    expect(workflowStartSpy).toHaveBeenCalledTimes(1);
    const [wfName, wfOpts] = workflowStartSpy.mock.calls[0];
    expect(wfName).toBe("CodeAgentWorkflow");
    // wrapper derives workflowId via workflowIdFor()
    expect(wfOpts.workflowId).toBe(`code-agent-${body.runId}`);
    expect(wfOpts.args[0]).toMatchObject({
      runId: body.runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "draw a sine wave",
      language: "python",
    });
  });
});

describe("GET /api/code/runs/:runId/stream", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    process.env.FEATURE_CODE_AGENT = "true";
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns 404 when run doesn't exist", async () => {
    const res = await authedFetch(
      `/api/code/runs/${randomUUID()}/stream`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when run belongs to a different user", async () => {
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerUserId, // different user — testUser is editor, not owner
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "pending",
    });
    const res = await authedFetch(`/api/code/runs/${runId}/stream`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(404);
  });

  it("returns text/event-stream content-type and emits initial queued event", async () => {
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "pending",
    });
    // Drive the run to a terminal state so the SSE loop closes promptly.
    void (async () => {
      await new Promise((r) => setTimeout(r, 50));
      await db
        .update(codeRuns)
        .set({ status: "completed" })
        .where(eq(codeRuns.id, runId));
    })();

    const res = await authedFetch(`/api/code/runs/${runId}/stream`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const seen: string[] = [];
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(decoder.decode(value));
      if (seen.join("").includes('"kind":"done"')) break;
    }
    const all = seen.join("");
    expect(all).toContain('"kind":"queued"');
    expect(all).toContain('"runId"');
  }, 10_000);

  it("emits awaiting_feedback during the wait, then closes on terminal", async () => {
    // Verifies the SSE loop projects awaiting_feedback to the wire while the
    // run sits idle, AND that re-emit-every-iteration behaviour means a client
    // tuning in mid-state still sees the event before any state transition.
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "pending",
    });
    // Bounce: pending → awaiting_feedback (let the loop emit at least one
    // awaiting_feedback frame) → completed (lets the loop exit).
    void (async () => {
      await new Promise((r) => setTimeout(r, 50));
      await db
        .update(codeRuns)
        .set({ status: "awaiting_feedback" })
        .where(eq(codeRuns.id, runId));
      // Wait > one POLL_MS tick so the loop iterates while in awaiting_feedback
      // before we flip to terminal.
      await new Promise((r) => setTimeout(r, 2_500));
      await db
        .update(codeRuns)
        .set({ status: "completed" })
        .where(eq(codeRuns.id, runId));
    })();

    const res = await authedFetch(`/api/code/runs/${runId}/stream`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const seen: string[] = [];
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(decoder.decode(value));
      if (seen.join("").includes('"kind":"done"')) break;
    }
    const all = seen.join("");
    expect(all).toContain('"kind":"awaiting_feedback"');
    expect(all).toContain('"kind":"done"');
  }, 15_000);

  it("emits done on terminal status (completed)", async () => {
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "running",
    });
    void (async () => {
      await new Promise((r) => setTimeout(r, 50));
      await db
        .update(codeRuns)
        .set({ status: "completed" })
        .where(eq(codeRuns.id, runId));
    })();

    const res = await authedFetch(`/api/code/runs/${runId}/stream`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const seen: string[] = [];
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(decoder.decode(value));
      if (seen.join("").includes('"kind":"done"')) break;
    }
    const all = seen.join("");
    expect(all).toContain('"kind":"done"');
    expect(all).toContain('"status":"completed"');
  }, 10_000);

  it("emits error on failed status", async () => {
    // codeAgentEventSchema's `done` event allows only the four non-failed
    // terminal statuses; `failed` is reported via the `error` event instead so
    // the client can branch on the discriminator.
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "running",
    });
    void (async () => {
      await new Promise((r) => setTimeout(r, 50));
      await db
        .update(codeRuns)
        .set({ status: "failed" })
        .where(eq(codeRuns.id, runId));
    })();

    const res = await authedFetch(`/api/code/runs/${runId}/stream`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const seen: string[] = [];
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(decoder.decode(value));
      // The error event closes the loop just like done does — both are
      // terminal — so we stop reading once we see it.
      if (seen.join("").includes('"kind":"error"')) break;
    }
    const all = seen.join("");
    expect(all).toContain('"kind":"error"');
    expect(all).toContain('"code":"workflowFailed"');
  }, 10_000);
});

describe("POST /api/code/feedback", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowSignalSpy.mockClear();
    process.env.FEATURE_CODE_AGENT = "true";
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("signals client_feedback on the run's workflow handle", async () => {
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "running",
    });
    const res = await authedFetch("/api/code/feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ runId, kind: "ok", stdout: "hello" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(workflowSignalSpy).toHaveBeenCalledTimes(1);
    expect(workflowSignalSpy.mock.calls[0][0]).toBe("client_feedback");
    const payload = workflowSignalSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.kind).toBe("ok");
    expect(payload.stdout).toBe("hello");
  });

  it("returns 409 when the run is already in a terminal state", async () => {
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "completed",
    });
    const res = await authedFetch("/api/code/feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ runId, kind: "ok" }),
    });
    expect(res.status).toBe(409);
    expect(workflowSignalSpy).not.toHaveBeenCalled();
  });

  it("returns 404 on cross-user run access", async () => {
    const noteId = await createCanvasNote(ctx);
    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerUserId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "running",
    });
    const res = await authedFetch("/api/code/feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ runId, kind: "ok" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("internal code routes (worker callbacks)", () => {
  let ctx: SeedResult;
  let runId: string;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    const noteId = await createCanvasNote(ctx);
    runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt: "x",
      language: "python",
      workflowId: runId,
      status: "pending",
    });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("POST /api/internal/code/turns inserts a turn row", async () => {
    const res = await internalFetch("/api/internal/code/turns", {
      method: "POST",
      secret: INTERNAL_SECRET,
      body: JSON.stringify({
        runId,
        seq: 0,
        kind: "generate",
        source: "print('hi')",
        explanation: "first attempt",
      }),
    });
    expect(res.status).toBe(200);
    const turns = await db
      .select()
      .from(codeTurns)
      .where(eq(codeTurns.runId, runId));
    expect(turns).toHaveLength(1);
    expect(turns[0]!.kind).toBe("generate");
    expect(turns[0]!.source).toBe("print('hi')");
    expect(turns[0]!.explanation).toBe("first attempt");
  });

  it("POST /api/internal/code/turns is idempotent on (runId, seq)", async () => {
    await internalFetch("/api/internal/code/turns", {
      method: "POST",
      secret: INTERNAL_SECRET,
      body: JSON.stringify({
        runId,
        seq: 0,
        kind: "generate",
        source: "v1",
      }),
    });
    // Second insert with same (runId, seq) — must be a no-op rather than 500.
    const res = await internalFetch("/api/internal/code/turns", {
      method: "POST",
      secret: INTERNAL_SECRET,
      body: JSON.stringify({
        runId,
        seq: 0,
        kind: "generate",
        source: "v2",
      }),
    });
    expect(res.status).toBe(200);
    const turns = await db
      .select()
      .from(codeTurns)
      .where(eq(codeTurns.runId, runId));
    expect(turns).toHaveLength(1);
  });

  it("POST /api/internal/code/turns returns 401 without the internal secret", async () => {
    const res = await internalFetch("/api/internal/code/turns", {
      method: "POST",
      // no secret header
      body: JSON.stringify({
        runId,
        seq: 0,
        kind: "generate",
        source: "x",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /api/internal/code/runs/:id/status updates code_runs.status", async () => {
    const res = await internalFetch(
      `/api/internal/code/runs/${runId}/status`,
      {
        method: "PATCH",
        secret: INTERNAL_SECRET,
        body: JSON.stringify({ status: "running" }),
      },
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ status: codeRuns.status })
      .from(codeRuns)
      .where(eq(codeRuns.id, runId));
    expect(row!.status).toBe("running");
  });

  it("PATCH /api/internal/code/runs/:id/status returns 401 without secret", async () => {
    const res = await internalFetch(
      `/api/internal/code/runs/${runId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "running" }),
      },
    );
    expect(res.status).toBe(401);
  });
});
