import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db, ingestJobs, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// The status handler talks to Temporal. In test we stub out the client
// so the handler never opens a real gRPC connection — the auth/owner
// layer is what we want to exercise here.
vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: async () => ({
    workflow: {
      getHandle: (workflowId: string) => ({
        describe: async () => ({
          status: { name: "RUNNING" },
          startTime: new Date("2026-04-23T00:00:00Z"),
          closeTime: null,
          workflowId,
        }),
      }),
    },
  }),
}));

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

describe("GET /api/ingest/status/:workflowId", () => {
  let owner: SeedResult;

  beforeEach(async () => {
    owner = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await db.delete(ingestJobs).where(eq(ingestJobs.userId, owner.userId));
    await owner.cleanup();
  });

  it("returns 404 when no ingest_jobs row exists for the workflow id", async () => {
    const res = await authedFetch(
      `/api/ingest/status/ingest-00000000-0000-0000-0000-000000000000`,
      { userId: owner.userId },
    );
    expect(res.status).toBe(404);
  });

  it("owner of the ingest row gets the status payload", async () => {
    const workflowId = `ingest-${crypto.randomUUID()}`;
    await db.insert(ingestJobs).values({
      workflowId,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: owner.projectId,
      source: "upload",
    });

    const res = await authedFetch(`/api/ingest/status/${workflowId}`, {
      userId: owner.userId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workflowId).toBe(workflowId);
    expect(body.status).toBe("RUNNING");
  });

  it("a different authenticated user hits 403 on someone else's workflow", async () => {
    const workflowId = `ingest-${crypto.randomUUID()}`;
    await db.insert(ingestJobs).values({
      workflowId,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: owner.projectId,
      source: "upload",
    });

    const otherCtx = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(`/api/ingest/status/${workflowId}`, {
        userId: otherCtx.userId,
      });
      // Even though the other user is an admin of their OWN workspace,
      // the workflow lives under the original owner's account.
      expect(res.status).toBe(403);
    } finally {
      await otherCtx.cleanup();
    }
  });

  it("unauthenticated request is rejected by requireAuth (401)", async () => {
    const workflowId = `ingest-${crypto.randomUUID()}`;
    await db.insert(ingestJobs).values({
      workflowId,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: owner.projectId,
      source: "upload",
    });

    const res = await app.request(`/api/ingest/status/${workflowId}`);
    expect(res.status).toBe(401);
  });
});
