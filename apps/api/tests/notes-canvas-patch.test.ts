import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { seedMultiRoleWorkspace, type SeedMultiRoleResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: { ...(headers ?? {}), cookie, "content-type": "application/json" },
  });
}

describe("PATCH /api/notes/:id/canvas", () => {
  let ctx: SeedMultiRoleResult;
  let canvasId: string;
  let plainId: string;

  beforeEach(async () => {
    ctx = await seedMultiRoleWorkspace();

    // Create a canvas note via the public POST API (uses Task 3 wiring).
    const c = await authedFetch("/api/notes", {
      method: "POST",
      userId: ctx.ownerUserId,
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "C",
        sourceType: "canvas",
        canvasLanguage: "python",
        contentText: "old",
      }),
    });
    canvasId = (await c.json()).id;

    // Create a non-canvas note (default plain note).
    const p = await authedFetch("/api/notes", {
      method: "POST",
      userId: ctx.ownerUserId,
      body: JSON.stringify({ projectId: ctx.projectId, title: "P" }),
    });
    plainId = (await p.json()).id;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("200 + saves source + language for owner", async () => {
    const res = await authedFetch(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      userId: ctx.ownerUserId,
      body: JSON.stringify({ source: "print('new')", language: "python" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contentText).toBe("print('new')");
    expect(body.canvasLanguage).toBe("python");
  });

  it("language omitted preserves existing value", async () => {
    const res = await authedFetch(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      userId: ctx.ownerUserId,
      body: JSON.stringify({ source: "console.log('x')" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canvasLanguage).toBe("python");
    expect(body.contentText).toBe("console.log('x')");
  });

  it("409 notCanvas for non-canvas note", async () => {
    const res = await authedFetch(`/api/notes/${plainId}/canvas`, {
      method: "PATCH",
      userId: ctx.ownerUserId,
      body: JSON.stringify({ source: "x" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notCanvas");
  });

  it("403 for viewer with canRead but no canWrite", async () => {
    const res = await authedFetch(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      userId: ctx.viewerUserId,
      body: JSON.stringify({ source: "hax" }),
    });
    expect(res.status).toBe(403);
  });

  it("404 for non-existent note (canRead fails, hides existence)", async () => {
    // Random v4 UUID that satisfies isUuid() (version nibble 4, variant 8/9/a/b)
    // but doesn't exist in the DB — exercises the canRead-fails → 404 branch.
    const res = await authedFetch(
      `/api/notes/deadbeef-dead-4bee-8dad-deadbeefdead/canvas`,
      {
        method: "PATCH",
        userId: ctx.ownerUserId,
        body: JSON.stringify({ source: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("rejects source > 64KB (Zod 400)", async () => {
    const big = "a".repeat(64 * 1024 + 1);
    const res = await authedFetch(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      userId: ctx.ownerUserId,
      body: JSON.stringify({ source: big }),
    });
    expect([400, 413]).toContain(res.status); // Zod max → 400; Hono bodyLimit → 413 if you add one
  });
});
