import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, ingestJobs, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { getRedis, resetRedisForTest } from "../src/lib/redis.js";

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
    },
  });
}

describe("GET /api/ingest/stream/:workflowId", () => {
  let owner: SeedResult;

  beforeEach(async () => {
    owner = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await db.delete(ingestJobs).where(eq(ingestJobs.userId, owner.userId));
    // Drain any keys we leaked into Redis so subsequent runs are clean.
    const r = getRedis();
    const keys = await r.keys("ingest:*");
    if (keys.length) await r.del(...keys);
    resetRedisForTest();
    await owner.cleanup();
  });

  it("returns 404 when ingest_jobs row is missing", async () => {
    const res = await authedFetch(
      "/api/ingest/stream/wf-missing",
      { userId: owner.userId },
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not the dispatcher", async () => {
    const workflowId = `ingest-${crypto.randomUUID()}`;
    await db.insert(ingestJobs).values({
      workflowId,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: owner.projectId,
      source: "upload",
    });
    const other = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(`/api/ingest/stream/${workflowId}`, {
        userId: other.userId,
      });
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it("returns 401 unauthenticated", async () => {
    const res = await app.request("/api/ingest/stream/anything");
    expect(res.status).toBe(401);
  });

  it("replays Redis backlog as SSE on connect", async () => {
    const workflowId = `ingest-${crypto.randomUUID()}`;
    await db.insert(ingestJobs).values({
      workflowId,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: owner.projectId,
      source: "upload",
    });

    // Seed two backlog events; LPUSH order matters (newest first).
    const r = getRedis();
    const ev2 = JSON.stringify({
      workflowId,
      seq: 2,
      ts: "2026-04-27T00:00:01.000Z",
      kind: "stage_changed",
      payload: { stage: "parsing", pct: null },
    });
    const ev1 = JSON.stringify({
      workflowId,
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "started",
      payload: { mime: "application/pdf", fileName: "x.pdf", url: null, totalUnits: null },
    });
    await r.lpush(`ingest:replay:${workflowId}`, ev1, ev2);

    const res = await authedFetch(`/api/ingest/stream/${workflowId}`, {
      userId: owner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buffer = "";
    // Read until we have at least the two backlog frames.
    while (!buffer.includes('"seq":2')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += dec.decode(value);
    }
    expect(buffer).toContain('"kind":"started"');
    expect(buffer).toContain('"kind":"stage_changed"');
    // Order: seq=1 must arrive before seq=2 (chronological replay).
    expect(buffer.indexOf('"seq":1')).toBeLessThan(buffer.indexOf('"seq":2'));

    await reader.cancel();
  });
});
