import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db, notes, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// Mock the S3 streamer so tests don't require a running MinIO. The mock path
// MUST match the module specifier used by the route (`../src/lib/s3-get` in
// note-assets.ts). Vitest resolves .ts/.js interchangeably here.
vi.mock("../src/lib/s3-get.js", () => ({
  statObject: vi.fn(async () => ({
    contentType: "application/pdf",
    contentLength: 9,
  })),
  streamObject: vi.fn(async (_key: string, range?: { start: number; end: number }) => ({
    stream: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(range ? "PDF" : "PDF-BYTES"));
        c.close();
      },
    }),
    contentType: "application/pdf",
    contentLength: range ? range.end - range.start + 1 : 9,
    totalLength: 9,
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

async function authedGetWithHeaders(
  path: string,
  userId: string,
  headers: Record<string, string>,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { ...headers, cookie } });
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

  it("supports byte ranges for PDF viewers", async () => {
    await db
      .update(notes)
      .set({ sourceFileKey: "uploads/test.pdf", sourceType: "pdf" })
      .where(eq(notes.id, ctx.noteId));
    const res = await authedGetWithHeaders(
      `/api/notes/${ctx.noteId}/file`,
      ctx.userId,
      { range: "bytes=0-2" },
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-range")).toBe("bytes 0-2/9");
    expect(res.headers.get("content-length")).toBe("3");
    expect(await res.text()).toBe("PDF");
  });

  it("percent-encodes RFC 5987 reserved chars in filename* so single quotes don't break the header", async () => {
    // `'` is the RFC 5987 delimiter inside `filename*=UTF-8''value`. A raw
    // `'` in the filename would split the parameter value on strict parsers
    // (Content-Disposition header corruption). This regression-guards the
    // custom percent-encoding for !'()* on top of encodeURIComponent.
    await db
      .update(notes)
      .set({
        title: "it's a 한글 note!.pdf",
        sourceFileKey: "uploads/test.pdf",
        sourceType: "pdf",
      })
      .where(eq(notes.id, ctx.noteId));
    const res = await authedGet(`/api/notes/${ctx.noteId}/file`, ctx.userId);
    const disposition = res.headers.get("content-disposition") ?? "";
    // UTF-8 name is fully percent-encoded; single quote → %27, exclamation
    // mark → %21. The bare `'` in `filename*=UTF-8''` after `UTF-8` is the
    // RFC 5987 literal delimiter and should appear exactly twice.
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toMatch(/filename\*=UTF-8''[^;]*'/);
    expect(disposition).toContain("%27"); // encoded '
    expect(disposition).toContain("%21"); // encoded !
    expect(disposition).toContain("%ED%95%9C"); // encoded 한
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
