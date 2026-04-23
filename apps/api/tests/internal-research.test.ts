import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, notes, researchRuns, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

const SECRET = "test-internal-secret-abc";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function internalFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Internal-Secret": SECRET,
      "content-type": "application/json",
    },
  });
}

describe("POST /api/internal/notes (research extension)", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("accepts plateValue + userId and returns noteId", async () => {
    const plate = [
      { type: "research-meta", runId: "r", model: "m", plan: "p",
        sources: [], children: [{ text: "" }] },
      { type: "p", children: [{ text: "body" }] },
    ];
    const res = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "run-xyz",
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "research topic",
        plateValue: plate,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { noteId: string; id: string };
    expect(body.noteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.id).toBe(body.noteId); // legacy field retained

    const [row] = await db.select().from(notes).where(eq(notes.id, body.noteId));
    expect(row).toBeDefined();
    expect(row!.title).toBe("research topic");
    expect(row!.content).toEqual(plate);
    expect(row!.contentText).toContain("body"); // plateValue → text derivation
  });

  it("is idempotent on idempotencyKey — returns same noteId on retry", async () => {
    // Pre-insert a researchRuns row with id="run-abc" so the handler's
    // idempotency check can back-fill and then look up noteId on retry.
    // The plan's test omitted this setup step — without it the UPDATE is a
    // no-op on both calls, resulting in two distinct noteIds.
    const runId = randomUUID();
    await db.insert(researchRuns).values({
      id: runId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      userId: ctx.userId,
      topic: "test topic",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
      workflowId: runId,
    });

    try {
      const payload = {
        idempotencyKey: runId,
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "t",
        plateValue: [{ type: "p", children: [{ text: "x" }] }],
      };
      const a = await internalFetch("/api/internal/notes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const b = await internalFetch("/api/internal/notes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const a1 = (await a.json()) as { noteId: string };
      const b1 = (await b.json()) as { noteId: string };
      expect(a1.noteId).toBe(b1.noteId);
    } finally {
      // Clean up the run row (notes cascade from workspace cleanup, but
      // researchRuns must be deleted before workspace to avoid FK issues)
      await db.delete(researchRuns).where(eq(researchRuns.id, runId));
    }
  });

  it("still accepts the legacy ingest-expansion payload shape", async () => {
    const res = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "legacy",
        type: "source",
        sourceType: "pdf",
        content: null,
        contentText: "",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects when workspaceId mismatches the project's workspace", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const res = await internalFetch("/api/internal/notes", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "k",
          projectId: ctx.projectId,
          workspaceId: other.workspaceId, // wrong
          userId: ctx.userId,
          title: "t",
          plateValue: [],
        }),
      });
      expect(res.status).toBe(400);
    } finally {
      await other.cleanup();
    }
  });
});
