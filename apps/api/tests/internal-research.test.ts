import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  and,
  db,
  eq,
  notes,
  researchRuns,
  researchRunArtifacts,
  wikiLinks,
} from "@opencairn/db";
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

  it("syncs wiki links from worker-supplied plateValue", async () => {
    const res = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "research with link",
        plateValue: [
          {
            type: "p",
            children: [
              { text: "Related: " },
              {
                type: "wiki-link",
                targetId: ctx.noteId,
                children: [{ text: "seed note" }],
              },
            ],
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { noteId: string };
    const rows = await db
      .select({ id: wikiLinks.id })
      .from(wikiLinks)
      .where(
        and(
          eq(wikiLinks.sourceNoteId, body.noteId),
          eq(wikiLinks.targetNoteId, ctx.noteId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("syncs worker-supplied title wiki links from imported plateValue", async () => {
    const res = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "research with title link",
        plateValue: [
          {
            type: "p",
            children: [
              { text: "Related: " },
              {
                type: "wikilink",
                noteId: null,
                label: "test",
                children: [{ text: "test" }],
              },
            ],
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { noteId: string };
    const rows = await db
      .select({ id: wikiLinks.id })
      .from(wikiLinks)
      .where(
        and(
          eq(wikiLinks.sourceNoteId, body.noteId),
          eq(wikiLinks.targetNoteId, ctx.noteId),
        ),
      );
    expect(rows).toHaveLength(1);
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

describe("POST /api/internal/research/image-bytes", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns base64 + mimeType for a known artifact", async () => {
    const [run] = await db
      .insert(researchRuns)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        userId: ctx.userId,
        topic: "t",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
        status: "researching",
        workflowId: "wf",
      })
      .returning({ id: researchRuns.id });
    await db.insert(researchRunArtifacts).values({
      runId: run.id,
      seq: 0,
      kind: "image",
      payload: {
        url: "https://fake.googleusercontent/r/1.png",
        mimeType: "image/png",
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/D2+J6cAAAAASUVORK5CYII=",
      },
    });

    const res = await internalFetch("/api/internal/research/image-bytes", {
      method: "POST",
      body: JSON.stringify({
        url: "https://fake.googleusercontent/r/1.png",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { base64: string; mimeType: string };
    expect(body.mimeType).toBe("image/png");
    expect(body.base64.startsWith("iVBOR")).toBe(true);
  });

  it("returns 404 when no artifact matches the URL", async () => {
    const res = await internalFetch("/api/internal/research/image-bytes", {
      method: "POST",
      body: JSON.stringify({ url: "https://unknown" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects missing secret header", async () => {
    const res = await app.request("/api/internal/research/image-bytes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/internal/research/runs/:id/artifacts", () => {
  let ctx: SeedResult;
  let runId: string;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    const [run] = await db
      .insert(researchRuns)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        userId: ctx.userId,
        topic: "t",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
        status: "researching",
        workflowId: "wf-art",
      })
      .returning({ id: researchRuns.id });
    runId = run.id;
  });
  afterEach(async () => {
    await db.delete(researchRuns).where(eq(researchRuns.id, runId));
    await ctx.cleanup();
  });

  it("inserts a streamed artifact with auto-assigned seq", async () => {
    const res = await internalFetch(
      `/api/internal/research/runs/${runId}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "text_delta",
          payload: { text: "first chunk" },
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; seq: number };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.seq).toBe(0);

    const [row] = await db
      .select()
      .from(researchRunArtifacts)
      .where(eq(researchRunArtifacts.id, body.id));
    expect(row).toBeDefined();
    expect(row!.runId).toBe(runId);
    expect(row!.kind).toBe("text_delta");
    expect(row!.payload).toEqual({ text: "first chunk" });
  });

  it("monotonically increases seq across calls in the same run", async () => {
    const a = await internalFetch(
      `/api/internal/research/runs/${runId}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "thought_summary", payload: { text: "a" } }),
      },
    );
    const b = await internalFetch(
      `/api/internal/research/runs/${runId}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "text_delta", payload: { text: "b" } }),
      },
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const ja = (await a.json()) as { seq: number };
    const jb = (await b.json()) as { seq: number };
    expect(ja.seq).toBe(0);
    expect(jb.seq).toBe(1);
  });

  it("returns 404 when the run does not exist", async () => {
    const fakeId = randomUUID();
    const res = await internalFetch(
      `/api/internal/research/runs/${fakeId}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "text_delta", payload: { text: "x" } }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("rejects non-uuid run ids", async () => {
    const res = await internalFetch(
      `/api/internal/research/runs/not-a-uuid/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "text_delta", payload: { text: "x" } }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown kinds via Zod", async () => {
    const res = await internalFetch(
      `/api/internal/research/runs/${runId}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "garbage", payload: {} }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects an image payload missing url/mimeType", async () => {
    // Per-kind shape validation — see researchArtifactWriteSchema in
    // internal.ts. A buggy worker emitting `{kind:"image", payload:{}}`
    // would otherwise poison the image-bytes lookup which matches on
    // payload->>'url'.
    const res = await internalFetch(
      `/api/internal/research/runs/${runId}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "image", payload: {} }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing secret header", async () => {
    const res = await app.request(
      `/api/internal/research/runs/${runId}/artifacts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "text_delta", payload: { text: "x" } }),
      },
    );
    expect(res.status).toBe(401);
  });
});
