import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db, notes, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// Mock the S3 streamer so tests don't require a running MinIO. The mock path
// MUST match the module specifier used by the route (`../src/lib/s3-get` in
// note-assets.ts). Vitest resolves .ts/.js interchangeably here.
vi.mock("../src/lib/s3-get.js", () => ({
  streamObject: vi.fn(async () => ({
    stream: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("PDF-BYTES"));
        c.close();
      },
    }),
    contentType: "application/pdf",
    contentLength: 9,
  })),
}));

// Import AFTER the mock so createApp() wires the mocked streamObject when
// note-assets.ts is evaluated. (In practice streamObject is imported
// top-of-file but only invoked per-request — the order is still correct.)
const { createApp } = await import("../src/app.js");
const app = createApp();

async function authedGet(path: string, userId: string): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie } });
}

describe("GET /api/notes/:id/file", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("streams the MinIO object when sourceFileKey is set", async () => {
    await db
      .update(notes)
      .set({ sourceFileKey: "uploads/test.pdf", sourceType: "pdf" })
      .where(eq(notes.id, ctx.noteId));
    const res = await authedGet(`/api/notes/${ctx.noteId}/file`, ctx.userId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("PDF-BYTES");
  });

  it("returns 404 when sourceFileKey is null", async () => {
    const res = await authedGet(`/api/notes/${ctx.noteId}/file`, ctx.userId);
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-UUID id", async () => {
    const res = await authedGet(`/api/notes/not-a-uuid/file`, ctx.userId);
    expect(res.status).toBe(400);
  });

  it("returns 403 when user has no read access", async () => {
    // Seed a separate workspace — its user has no membership in ctx's
    // workspace, so canRead on ctx.noteId resolves to none.
    const other = await seedWorkspace({ role: "editor" });
    try {
      await db
        .update(notes)
        .set({ sourceFileKey: "uploads/test.pdf", sourceType: "pdf" })
        .where(eq(notes.id, ctx.noteId));
      const res = await authedGet(
        `/api/notes/${ctx.noteId}/file`,
        other.userId,
      );
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });
});

describe("GET /api/notes/:id/data", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("parses JSON from contentText", async () => {
    await db
      .update(notes)
      .set({ contentText: JSON.stringify({ answer: 42 }) })
      .where(eq(notes.id, ctx.noteId));
    const res = await authedGet(`/api/notes/${ctx.noteId}/data`, ctx.userId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { answer: 42 } });
  });

  it("returns { data: null } for empty contentText", async () => {
    const res = await authedGet(`/api/notes/${ctx.noteId}/data`, ctx.userId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it("returns { data: null } for non-JSON contentText (does not 500)", async () => {
    await db
      .update(notes)
      .set({ contentText: "not json at all" })
      .where(eq(notes.id, ctx.noteId));
    const res = await authedGet(`/api/notes/${ctx.noteId}/data`, ctx.userId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it("returns 403 when user has no read access", async () => {
    const other = await seedWorkspace({ role: "editor" });
    try {
      const res = await authedGet(
        `/api/notes/${ctx.noteId}/data`,
        other.userId,
      );
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });
});
