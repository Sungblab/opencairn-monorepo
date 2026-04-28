import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { _resetRateLimits } from "../src/lib/rate-limit.js";

// Mock Temporal client — unit tests must not require a running server.
const startSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: { start: startSpy },
  }),
  taskQueue: () => "ingest",
}));

describe("POST /api/literature/import", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    _resetRateLimits();
    startSpy.mockClear();
  });

  afterEach(async () => {
    await seed.cleanup();
    vi.restoreAllMocks();
  });

  it("dispatches LitImportWorkflow and returns 202 + queued count", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        ids: ["10.1234/test"],
        projectId: seed.projectId,
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      jobId: string;
      workflowId: string;
      skipped: string[];
      queued: number;
    };
    expect(body.jobId).toBeTruthy();
    expect(body.workflowId.startsWith("lit-import-")).toBe(true);
    expect(body.queued).toBe(1);
    expect(body.skipped).toEqual([]);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for empty ids array", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({ ids: [], projectId: seed.projectId }),
    });
    expect(res.status).toBe(400);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for ids > 50", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        ids: Array.from({ length: 51 }, (_, i) => `10.${i}/test`),
        projectId: seed.projectId,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when projectId is missing", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({ ids: ["10.1/x"] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when user has no write access to the project", async () => {
    // viewer role on a different workspace cannot write to seed's project.
    const other = await seedWorkspace({ role: "viewer" });
    try {
      const app = createApp();
      const res = await app.request("/api/literature/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(other.userId),
        },
        body: JSON.stringify({
          ids: ["10.1234/test"],
          projectId: seed.projectId,
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it("returns 401 when unauthenticated", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: ["10.1234/test"],
        projectId: seed.projectId,
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/literature/import/:jobId", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    _resetRateLimits();
  });

  afterEach(async () => {
    await seed.cleanup();
    vi.restoreAllMocks();
  });

  it("returns 404 for unknown jobId", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/literature/import/00000000-0000-0000-0000-000000000000",
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-uuid jobId", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import/not-a-uuid", {
      headers: { cookie: await signSessionCookie(seed.userId) },
    });
    expect(res.status).toBe(404);
  });
});
