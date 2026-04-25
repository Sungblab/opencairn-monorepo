import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
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

describe("POST /api/notes (canvas)", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("rejects sourceType='canvas' without canvasLanguage (400)", async () => {
    const res = await authedFetch("/api/notes", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "Bad Canvas",
        sourceType: "canvas",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("creates canvas note (201) and GET returns canvasLanguage + contentText", async () => {
    const post = await authedFetch("/api/notes", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "Hello Canvas",
        sourceType: "canvas",
        canvasLanguage: "python",
        contentText: "print('hi')",
      }),
    });
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.canvasLanguage).toBe("python");
    expect(created.sourceType).toBe("canvas");
    expect(created.contentText).toBe("print('hi')");

    const get = await authedFetch(`/api/notes/${created.id}`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(get.status).toBe(200);
    const got = await get.json();
    expect(got.canvasLanguage).toBe("python");
    expect(got.contentText).toBe("print('hi')");
  });

  it("non-canvas note has canvasLanguage=null in GET", async () => {
    const post = await authedFetch("/api/notes", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ projectId: ctx.projectId, title: "Plain" }),
    });
    expect(post.status).toBe(201);
    const created = await post.json();
    const get = await authedFetch(`/api/notes/${created.id}`, {
      method: "GET",
      userId: ctx.userId,
    });
    const got = await get.json();
    expect(got.canvasLanguage).toBeNull();
  });
});
