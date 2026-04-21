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

  it("editor can save Plate array content and content_text is derived", async () => {
    const body = {
      title: "Greeting",
      content: [{ type: "p", children: [{ text: "Hello world" }] }],
    };
    const res = await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(notes).where(eq(notes.id, ctx.noteId));
    expect(row!.title).toBe("Greeting");
    expect(row!.content).toEqual(body.content);
    expect(row!.contentText).toContain("Hello world");
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

  it("title-only PATCH preserves existing content_text", async () => {
    await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({
        content: [{ type: "p", children: [{ text: "Persisted body" }] }],
      }),
    });
    const res = await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ title: "New title only" }),
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(notes).where(eq(notes.id, ctx.noteId));
    expect(row!.title).toBe("New title only");
    expect(row!.contentText).toContain("Persisted body");
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
