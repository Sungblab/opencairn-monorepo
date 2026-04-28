import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db, canvasOutputs, notes, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// Mock both s3 helpers used by the canvas route. uploadObject is a thin
// wrapper around minio.putObject; streamObject pulls + adapts the Node
// Readable into a Web ReadableStream. Mocking lets us drive the route
// end-to-end without a running MinIO + persists the recorded uploads in a
// module-level array so the stream test can replay them.
const uploadedObjects = new Map<string, { buf: Buffer; mime: string }>();
vi.mock("../src/lib/s3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/s3.js")>();
  return {
    ...actual,
    uploadObject: vi.fn(async (key: string, data: Buffer, mime: string) => {
      uploadedObjects.set(key, { buf: Buffer.from(data), mime });
      return key;
    }),
  };
});
vi.mock("../src/lib/s3-get.js", () => ({
  streamObject: vi.fn(async (key: string) => {
    const obj = uploadedObjects.get(key);
    if (!obj) {
      // Mimic minio's "NoSuchKey" — route should treat as 404 only if
      // it pre-checks existence; here we let the underlying call throw
      // so unknown-key behaviour surfaces in tests.
      throw new Error(`mock: no such key ${key}`);
    }
    return {
      stream: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(obj.buf));
          c.close();
        },
      }),
      contentType: obj.mime,
      contentLength: obj.buf.length,
    };
  }),
}));

// Feature flag default is OFF — Task 10 expects 501 templatesNotAvailable
// when authed regardless. Individual tests flip as needed.
process.env.FEATURE_CANVAS_TEMPLATES = "false";

const { createApp } = await import("../src/app.js");
const app = createApp();

// One ~32-byte PNG magic-bytes blob is enough — the route only hashes the
// buffer and forwards it to MinIO. We don't need a parseable PNG.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009077d3" +
    "ce0000000c4944415408d76360000200000005000119d4d31a0000000049454e44ae426082",
  "hex",
);
const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  "utf8",
);

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: { ...(headers ?? {}), cookie },
  });
}

// Build a multipart/form-data body via the platform FormData. Hono's
// parseBody() handles this transparently because the runtime is the
// undici Request impl that ships with Node 20+.
function buildOutputFormData(opts: {
  noteId?: string;
  runId?: string;
  mimeType?: string;
  file?: Buffer | null;
  fileMime?: string;
}): FormData {
  const fd = new FormData();
  if (opts.noteId !== undefined) fd.append("noteId", opts.noteId);
  if (opts.runId !== undefined) fd.append("runId", opts.runId);
  if (opts.mimeType !== undefined) fd.append("mimeType", opts.mimeType);
  if (opts.file) {
    // Copy into a fresh ArrayBuffer-backed Uint8Array so the typed BlobPart
    // contract (ArrayBufferView<ArrayBuffer>) is satisfied. TS rejects raw
    // Node Buffer + views over Buffer.buffer because Buffer can be backed by
    // a SharedArrayBuffer in the type system, even though at runtime it
    // virtually never is.
    const view = new Uint8Array(new ArrayBuffer(opts.file.byteLength));
    view.set(opts.file);
    const blob = new Blob([view], {
      type: opts.fileMime ?? opts.mimeType ?? "application/octet-stream",
    });
    fd.append("file", blob, "output.bin");
  }
  return fd;
}

async function postOutput(
  userId: string,
  fd: FormData,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request("/api/canvas/output", {
    method: "POST",
    headers: { cookie },
    body: fd,
  });
}

// Promote the seeded note to a canvas note. The default seedWorkspace
// creates a regular note (sourceType=null); /api/canvas/output enforces
// sourceType='canvas' to refuse uploads against arbitrary pages.
async function makeCanvas(noteId: string): Promise<void> {
  await db
    .update(notes)
    .set({ sourceType: "canvas", canvasLanguage: "python" })
    .where(eq(notes.id, noteId));
}

// ─────────────────────────────────────────────────────────────────────────
// Task 10 — POST /api/canvas/from-template
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/canvas/from-template", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("401 without session", async () => {
    const res = await app.request("/api/canvas/from-template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: ctx.projectId,
        templateId: randomUUID(),
      }),
    });
    expect(res.status).toBe(401);
  });

  it("400 on invalid uuid", async () => {
    const res = await authedFetch("/api/canvas/from-template", {
      method: "POST",
      userId: ctx.userId,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "nope", templateId: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("501 templatesNotAvailable when authed (flag default off)", async () => {
    const res = await authedFetch("/api/canvas/from-template", {
      method: "POST",
      userId: ctx.userId,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: ctx.projectId,
        templateId: randomUUID(),
      }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("templatesNotAvailable");
  });

  it("501 templatesNotAvailable when authed (flag explicitly on)", async () => {
    // Plan 6 will provide the real impl; until then, both flag positions
    // 501 — this regression-guards the "even when on, still 501" branch
    // so the route doesn't accidentally return 200 with no body.
    const prev = process.env.FEATURE_CANVAS_TEMPLATES;
    process.env.FEATURE_CANVAS_TEMPLATES = "true";
    try {
      const res = await authedFetch("/api/canvas/from-template", {
        method: "POST",
        userId: ctx.userId,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: ctx.projectId,
          templateId: randomUUID(),
        }),
      });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("templatesNotAvailable");
    } finally {
      process.env.FEATURE_CANVAS_TEMPLATES = prev ?? "false";
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task 11 — POST /api/canvas/output
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/canvas/output", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    uploadedObjects.clear();
    ctx = await seedWorkspace({ role: "editor" });
    await makeCanvas(ctx.noteId);
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("401 without session", async () => {
    const fd = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/png",
      file: PNG_BYTES,
    });
    const res = await app.request("/api/canvas/output", {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(401);
  });

  it("400 outputBadType when mimeType is image/jpeg", async () => {
    const fd = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/jpeg",
      file: PNG_BYTES,
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("outputBadType");
  });

  it("400 outputBadType on invalid noteId (not a uuid)", async () => {
    const fd = buildOutputFormData({
      noteId: "not-a-uuid",
      mimeType: "image/png",
      file: PNG_BYTES,
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("outputBadType");
  });

  it("400 outputBadType when file part is missing", async () => {
    const fd = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/png",
      // no file
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(400);
  });

  it("413 outputTooLarge when file > 2 MB", async () => {
    // 2 MB + 1 byte synthesises the just-over-cap branch. Buffer.alloc is
    // zero-filled, fine for hash + size check.
    const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1);
    const fd = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/png",
      file: tooBig,
      fileMime: "image/png",
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("outputTooLarge");
  });

  it("404 when note doesn't exist", async () => {
    const fd = buildOutputFormData({
      noteId: randomUUID(),
      mimeType: "image/png",
      file: PNG_BYTES,
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(404);
  });

  it("404 cross-workspace (no canRead)", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      await makeCanvas(other.noteId);
      const fd = buildOutputFormData({
        noteId: other.noteId,
        mimeType: "image/png",
        file: PNG_BYTES,
      });
      const res = await postOutput(ctx.userId, fd);
      expect(res.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });

  it("404 when caller can read but cannot write the canvas note", async () => {
    const viewer = await seedWorkspace({ role: "viewer" });
    try {
      await makeCanvas(viewer.noteId);
      const fd = buildOutputFormData({
        noteId: viewer.noteId,
        mimeType: "image/png",
        file: PNG_BYTES,
      });
      const res = await postOutput(viewer.userId, fd);
      expect(res.status).toBe(404);
    } finally {
      await viewer.cleanup();
    }
  });

  it("409 notCanvas when note.sourceType !== 'canvas'", async () => {
    // Reset the seed note to a regular page.
    await db
      .update(notes)
      .set({ sourceType: null, canvasLanguage: null })
      .where(eq(notes.id, ctx.noteId));
    const fd = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/png",
      file: PNG_BYTES,
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("notCanvas");
  });

  it("happy path — uploads PNG, inserts canvas_outputs row, returns id+urlPath+createdAt", async () => {
    const fd = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/png",
      file: PNG_BYTES,
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      urlPath: string;
      createdAt: string;
    };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.urlPath).toBe(`/api/canvas/outputs/${body.id}/file`);
    expect(typeof body.createdAt).toBe("string");

    const [row] = await db
      .select()
      .from(canvasOutputs)
      .where(eq(canvasOutputs.id, body.id));
    expect(row).toBeDefined();
    expect(row!.noteId).toBe(ctx.noteId);
    expect(row!.mimeType).toBe("image/png");
    expect(row!.bytes).toBe(PNG_BYTES.length);
    expect(row!.s3Key).toMatch(
      new RegExp(`^canvas-outputs/${ctx.workspaceId}/${ctx.noteId}/[a-f0-9]{64}\\.png$`),
    );
    expect(uploadedObjects.has(row!.s3Key)).toBe(true);
  });

  it("uploads SVG with .svg s3Key extension", async () => {
    const fd = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/svg+xml",
      file: SVG_BYTES,
    });
    const res = await postOutput(ctx.userId, fd);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    const [row] = await db
      .select()
      .from(canvasOutputs)
      .where(eq(canvasOutputs.id, body.id));
    expect(row!.s3Key.endsWith(".svg")).toBe(true);
    expect(row!.mimeType).toBe("image/svg+xml");
  });

  it("idempotent on (noteId, contentHash) — second upload reuses existing row", async () => {
    const fd1 = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/png",
      file: PNG_BYTES,
    });
    const r1 = await postOutput(ctx.userId, fd1);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { id: string; urlPath: string };

    const fd2 = buildOutputFormData({
      noteId: ctx.noteId,
      mimeType: "image/png",
      file: PNG_BYTES,
    });
    const r2 = await postOutput(ctx.userId, fd2);
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { id: string; urlPath: string };

    expect(b2.id).toBe(b1.id);
    expect(b2.urlPath).toBe(b1.urlPath);

    // Only one canvas_outputs row exists for this note.
    const rows = await db
      .select()
      .from(canvasOutputs)
      .where(eq(canvasOutputs.noteId, ctx.noteId));
    expect(rows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task 12 — GET /api/canvas/outputs and GET /api/canvas/outputs/:id/file
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/canvas/outputs", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    uploadedObjects.clear();
    ctx = await seedWorkspace({ role: "editor" });
    await makeCanvas(ctx.noteId);
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("401 without session", async () => {
    const res = await app.request(
      `/api/canvas/outputs?noteId=${ctx.noteId}`,
    );
    expect(res.status).toBe(401);
  });

  it("400 when noteId param missing", async () => {
    const res = await authedFetch("/api/canvas/outputs", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });

  it("404 cross-workspace (no canRead)", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      await makeCanvas(other.noteId);
      const res = await authedFetch(
        `/api/canvas/outputs?noteId=${other.noteId}`,
        { method: "GET", userId: ctx.userId },
      );
      expect(res.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });

  it("404 when note doesn't exist", async () => {
    const res = await authedFetch(
      `/api/canvas/outputs?noteId=${randomUUID()}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(404);
  });

  it("returns outputs ordered by createdAt DESC", async () => {
    // Upload PNG then SVG with a tiny gap so timestamps differ deterministically.
    const r1 = await postOutput(
      ctx.userId,
      buildOutputFormData({
        noteId: ctx.noteId,
        mimeType: "image/png",
        file: PNG_BYTES,
      }),
    );
    expect(r1.status).toBe(200);
    const id1 = ((await r1.json()) as { id: string }).id;
    await new Promise((r) => setTimeout(r, 25));
    const r2 = await postOutput(
      ctx.userId,
      buildOutputFormData({
        noteId: ctx.noteId,
        mimeType: "image/svg+xml",
        file: SVG_BYTES,
      }),
    );
    expect(r2.status).toBe(200);
    const id2 = ((await r2.json()) as { id: string }).id;

    const list = await authedFetch(
      `/api/canvas/outputs?noteId=${ctx.noteId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      outputs: Array<{
        id: string;
        runId: string | null;
        mimeType: string;
        bytes: number;
        createdAt: string;
        urlPath: string;
      }>;
    };
    expect(body.outputs.map((o) => o.id)).toEqual([id2, id1]);
    expect(body.outputs[0]!.mimeType).toBe("image/svg+xml");
    expect(body.outputs[0]!.urlPath).toBe(`/api/canvas/outputs/${id2}/file`);
    expect(body.outputs[0]!.bytes).toBe(SVG_BYTES.length);
    expect(typeof body.outputs[0]!.createdAt).toBe("string");
    // ISO timestamp shape — sortable lexicographically.
    expect(body.outputs[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty list when note has no outputs", async () => {
    const res = await authedFetch(
      `/api/canvas/outputs?noteId=${ctx.noteId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outputs: unknown[] };
    expect(body.outputs).toEqual([]);
  });
});

describe("GET /api/canvas/outputs/:id/file", () => {
  let ctx: SeedResult;
  let outputId: string;

  beforeEach(async () => {
    uploadedObjects.clear();
    ctx = await seedWorkspace({ role: "editor" });
    await makeCanvas(ctx.noteId);
    const r = await postOutput(
      ctx.userId,
      buildOutputFormData({
        noteId: ctx.noteId,
        mimeType: "image/png",
        file: PNG_BYTES,
      }),
    );
    expect(r.status).toBe(200);
    outputId = ((await r.json()) as { id: string }).id;
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("401 without session", async () => {
    const res = await app.request(`/api/canvas/outputs/${outputId}/file`);
    expect(res.status).toBe(401);
  });

  it("404 when output doesn't exist", async () => {
    const res = await authedFetch(
      `/api/canvas/outputs/${randomUUID()}/file`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(404);
  });

  it("404 cross-workspace (no canRead on the owning note)", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(
        `/api/canvas/outputs/${outputId}/file`,
        { method: "GET", userId: other.userId },
      );
      expect(res.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });

  it("streams the binary with content-type + cache-control headers", async () => {
    const res = await authedFetch(
      `/api/canvas/outputs/${outputId}/file`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(PNG_BYTES)).toBe(true);
  });
});
