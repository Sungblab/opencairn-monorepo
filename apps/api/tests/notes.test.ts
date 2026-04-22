import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, notes, eq } from "@opencairn/db";
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
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

describe("PATCH /api/notes/:id", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("editor can update meta fields (title, folderId)", async () => {
    const res = await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ title: "Greeting" }),
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(notes).where(eq(notes.id, ctx.noteId));
    expect(row!.title).toBe("Greeting");
  });

  it("viewer receives 403", async () => {
    const viewerCtx = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authedFetch(`/api/notes/${viewerCtx.noteId}`, {
        method: "PATCH",
        userId: viewerCtx.userId,
        body: JSON.stringify({ title: "nope" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await viewerCtx.cleanup();
    }
  });

  it("PATCH ignores content field (Yjs is canonical)", async () => {
    // Pre-seed content directly (simulating Hocuspocus persistence).
    await db
      .update(notes)
      .set({
        content: [{ type: "p", children: [{ text: "Persisted body" }] }],
        contentText: "Persisted body",
      })
      .where(eq(notes.id, ctx.noteId));

    // Caller tries to clobber via PATCH; schema must strip `content`.
    const res = await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({
        title: "New Title",
        content: [{ type: "p", children: [{ text: "SHOULD_NOT_PERSIST" }] }],
      }),
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(notes).where(eq(notes.id, ctx.noteId));
    expect(row!.title).toBe("New Title");
    expect(row!.contentText ?? "").not.toContain("SHOULD_NOT_PERSIST");
    expect(row!.contentText ?? "").toContain("Persisted body");
  });

  it("deleted note returns 404", async () => {
    await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(eq(notes.id, ctx.noteId));
    const res = await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/notes/search", () => {
  let ctx: SeedResult;
  beforeEach(async () => { ctx = await seedWorkspace({ role: "editor" }); });
  afterEach(async () => { await ctx.cleanup(); });

  it("returns title-ilike matches scoped to projectId", async () => {
    await db.insert(notes).values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      title: "Attention is all you need",
      content: null,
    });
    const res = await authedFetch(
      `/api/notes/search?q=Atten&projectId=${ctx.projectId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].title.toLowerCase()).toContain("atten");
  });

  it("returns 403 when caller lacks project read", async () => {
    const outsider = await seedWorkspace({ role: "editor" });
    try {
      const res = await authedFetch(
        `/api/notes/search?q=x&projectId=${ctx.projectId}`,
        { method: "GET", userId: outsider.userId },
      );
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });

  it("rejects q shorter than 1 char", async () => {
    const res = await authedFetch(
      `/api/notes/search?q=&projectId=${ctx.projectId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(400);
  });
});
