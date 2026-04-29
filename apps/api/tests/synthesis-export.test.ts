import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Force feature flag ON for this suite — must happen BEFORE createApp.
process.env.FEATURE_SYNTHESIS_EXPORT = "true";

// Hoisted spies (vitest hoists vi.mock; closures over later const won't capture).
const { startSpy, cancelSpy } = vi.hoisted(() => ({
  startSpy: vi.fn().mockResolvedValue({ firstExecutionRunId: "wf-1" }),
  cancelSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/synthesis-export-client.js", () => ({
  startSynthesisExportRun: startSpy,
  signalSynthesisExportCancel: cancelSpy,
  workflowIdFor: (id: string) => `synthesis-export-${id}`,
}));

vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({}),
  taskQueue: () => "ingest",
}));

vi.mock("../src/lib/s3-get.js", () => ({
  streamObject: vi.fn().mockResolvedValue({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("# fake doc"));
        controller.close();
      },
    }),
    contentType: "text/markdown; charset=utf-8",
    contentLength: 10,
  }),
}));

import { createApp } from "../src/app.js";
import { db, synthesisRuns, synthesisDocuments, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedRequest(
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
      "Content-Type": "application/json",
    },
  });
}

describe("POST /api/synthesis-export/run", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
    startSpy.mockClear();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns 404 when feature flag is OFF", async () => {
    const old = process.env.FEATURE_SYNTHESIS_EXPORT;
    process.env.FEATURE_SYNTHESIS_EXPORT = "false";
    try {
      const res = await authedRequest("/api/synthesis-export/run", {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          format: "md",
          template: "report",
          userPrompt: "x",
          explicitSourceIds: [],
          noteIds: [],
          autoSearch: false,
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      process.env.FEATURE_SYNTHESIS_EXPORT = old;
    }
  });

  it("returns 401 without an auth cookie", async () => {
    const res = await app.request("/api/synthesis-export/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        format: "md",
        template: "report",
        userPrompt: "x",
        explicitSourceIds: [],
        noteIds: [],
        autoSearch: false,
      }),
    });
    expect(res.status).toBe(401);
  });

  it("creates a run, fires the workflow, and returns runId", async () => {
    const res = await authedRequest("/api/synthesis-export/run", {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        format: "md",
        template: "report",
        userPrompt: "Synthesize my notes.",
        explicitSourceIds: [],
        noteIds: [],
        autoSearch: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await db
      .select()
      .from(synthesisRuns)
      .where(eq(synthesisRuns.id, body.runId));
    expect(row!.status).toBe("pending");
    expect(row!.workflowId).toBe(`synthesis-export-${body.runId}`);
    expect(startSpy).toHaveBeenCalledOnce();
  });

  it("rejects an invalid Zod payload with 400", async () => {
    const res = await authedRequest("/api/synthesis-export/run", {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({ workspaceId: seed.workspaceId, format: "pptx" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/synthesis-export/runs/:id/stream", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns text/event-stream and emits a queued event", async () => {
    const [run] = await db
      .insert(synthesisRuns)
      .values({
        workspaceId: seed.workspaceId,
        userId: seed.userId,
        format: "md",
        template: "report",
        userPrompt: "x",
        autoSearch: false,
      })
      .returning();

    const cookie = await signSessionCookie(seed.userId);
    const res = await app.request(
      `/api/synthesis-export/runs/${run!.id}/stream`,
      {
        method: "GET",
        headers: { cookie },
      },
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("data:");
    await reader.cancel();
  }, 10_000);

  it("returns 404 for an unknown run id", async () => {
    const cookie = await signSessionCookie(seed.userId);
    const ghostId = crypto.randomUUID();
    const res = await app.request(
      `/api/synthesis-export/runs/${ghostId}/stream`,
      {
        method: "GET",
        headers: { cookie },
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("synthesis-export run list/detail/document/resynth/delete", () => {
  let seed: SeedResult;
  let runId: string;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
    cancelSpy.mockClear();
    const res = await authedRequest("/api/synthesis-export/run", {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        format: "md",
        template: "report",
        userPrompt: "x",
        explicitSourceIds: [],
        noteIds: [],
        autoSearch: false,
      }),
    });
    const body = (await res.json()) as { runId: string };
    runId = body.runId;
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("GET /runs lists workspace runs", async () => {
    const res = await authedRequest(
      `/api/synthesis-export/runs?workspaceId=${seed.workspaceId}`,
      { method: "GET", userId: seed.userId },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.find((r) => r.id === runId)).toBeDefined();
  });

  it("GET /runs requires workspaceId query", async () => {
    const res = await authedRequest("/api/synthesis-export/runs", {
      method: "GET",
      userId: seed.userId,
    });
    expect(res.status).toBe(400);
  });

  it("GET /runs/:id returns detail with sources + documents arrays", async () => {
    const res = await authedRequest(`/api/synthesis-export/runs/${runId}`, {
      method: "GET",
      userId: seed.userId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      sources: unknown[];
      documents: unknown[];
    };
    expect(body.id).toBe(runId);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(Array.isArray(body.documents)).toBe(true);
  });

  it("GET /runs/:id returns 404 for unknown run", async () => {
    const ghost = crypto.randomUUID();
    const res = await authedRequest(`/api/synthesis-export/runs/${ghost}`, {
      method: "GET",
      userId: seed.userId,
    });
    expect(res.status).toBe(404);
  });

  it("GET /document returns 404 when no document is recorded", async () => {
    const res = await authedRequest(
      `/api/synthesis-export/runs/${runId}/document?format=md`,
      { method: "GET", userId: seed.userId },
    );
    expect(res.status).toBe(404);
  });

  it("GET /document streams the recorded document for the requested format", async () => {
    await db.insert(synthesisDocuments).values({
      runId,
      format: "md",
      s3Key: `synthesis/runs/${runId}/document.md`,
      bytes: 10,
    });

    const res = await authedRequest(
      `/api/synthesis-export/runs/${runId}/document?format=md`,
      { method: "GET", userId: seed.userId },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toContain(
      `synthesis-${runId}.md`,
    );
    const text = await res.text();
    expect(text).toContain("# fake doc");
  });

  it("POST /resynthesize creates a fresh run with a new id", async () => {
    const res = await authedRequest(
      `/api/synthesis-export/runs/${runId}/resynthesize`,
      {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({ userPrompt: "Try again with a longer intro." }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).not.toBe(runId);
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await db
      .select()
      .from(synthesisRuns)
      .where(eq(synthesisRuns.id, body.runId));
    expect(row!.workflowId).toBe(`synthesis-export-${body.runId}`);
  });

  it("DELETE /runs/:id signals cancel, removes the row, and returns 204", async () => {
    const res = await authedRequest(`/api/synthesis-export/runs/${runId}`, {
      method: "DELETE",
      userId: seed.userId,
    });
    expect(res.status).toBe(204);
    expect(cancelSpy).toHaveBeenCalledOnce();
    const [row] = await db
      .select()
      .from(synthesisRuns)
      .where(eq(synthesisRuns.id, runId));
    expect(row).toBeUndefined();
  });

  it("DELETE /runs/:id returns 404 for unknown run", async () => {
    const ghost = crypto.randomUUID();
    const res = await authedRequest(`/api/synthesis-export/runs/${ghost}`, {
      method: "DELETE",
      userId: seed.userId,
    });
    expect(res.status).toBe(404);
  });
});
