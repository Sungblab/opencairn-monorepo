import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import crypto from "node:crypto";
import {
  db,
  canvasOutputs,
  notes,
  eq,
  and,
  desc,
  isNull,
} from "@opencairn/db";
import {
  canvasOutputCreateSchema,
  MAX_CANVAS_OUTPUT_BYTES,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { uploadObject } from "../lib/s3";
import { streamObject } from "../lib/s3-get";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// Plan 7 Canvas Phase 2 — public Canvas API.
//
// Hosts three concerns:
//   1. POST /from-template     — hidden until a template catalog exists.
//   2. POST /output            — matplotlib/SVG artifact upload (idempotent).
//   3. GET  /outputs[/:id/file] — listing + binary stream for the viewer.
//
// `/output` and `/outputs*` are gated by FEATURE_CANVAS_OUTPUT_STORE — when
// off, those routes 404 so a redeploy can disable persistence while the
// hidden template endpoint remains isolated until the catalog ships.

export const canvasRoutes = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Task 10 — POST /api/canvas/from-template
//
// Body schema validated up-front so probing with garbage payloads gets a 400
// before the auth check resolves. The template catalog is not exposed in the
// product surface yet, so this route is isolated as a 404 rather than exposed
// as an unfinished action.
// ─────────────────────────────────────────────────────────────────────────────

const fromTemplateSchema = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
  params: z.record(z.unknown()).optional(),
});

canvasRoutes.post(
  "/from-template",
  requireAuth,
  zValidator("json", fromTemplateSchema),
  async (c) => {
    return c.json({ error: "notFound" }, 404);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Output store flag-gate. Wraps /output + /outputs* only — the from-template
// route above is intentionally outside this gate so its dedicated flag can
// flip independently.
// ─────────────────────────────────────────────────────────────────────────────

function isOutputStoreEnabled(): boolean {
  // Default ON — matplotlib runs lose their artifacts if storage is off, but
  // ops can flip false to drop the cost during incidents. Match the env file
  // default (FEATURE_CANVAS_OUTPUT_STORE=true) so tests pass without setup.
  const raw = process.env.FEATURE_CANVAS_OUTPUT_STORE;
  if (raw === undefined) return true;
  return raw.toLowerCase() === "true";
}

function outputStoreGate() {
  // Hono middleware for the three output endpoints. 404 hides feature
  // existence — same shape as `/api/code` when FEATURE_CODE_AGENT is off.
  return async (
    c: import("hono").Context<AppEnv>,
    next: import("hono").Next,
  ): Promise<Response | void> => {
    if (!isOutputStoreEnabled()) return c.json({ error: "notFound" }, 404);
    await next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 11 — POST /api/canvas/output
//
// Multipart upload: { noteId, runId?, mimeType, file }. The route hashes the
// buffer (sha-256) and uses (noteId, hash) as the idempotency key — the same
// matplotlib figure replayed across a retry storms reuses its row instead of
// piling up duplicate s3 objects. canvas_outputs has a UNIQUE constraint on
// (note_id, content_hash) so the existence pre-check is just a
// nicer-error-message fast path; a concurrent insert would still be caught
// by the DB.
//
// Auth/error model mirrors /api/code/run: 4xx codes use string error keys
// (`outputBadType`, `outputTooLarge`, `notCanvas`) so the web client can
// branch deterministically.
// ─────────────────────────────────────────────────────────────────────────────

canvasRoutes.post(
  "/output",
  outputStoreGate(),
  requireAuth,
  // Pre-parse body-size guard. Without this a 50 MB upload still gets fully
  // buffered before our manual size check; bodyLimit() rejects at the
  // Content-Length / chunked-transfer boundary.
  bodyLimit({
    maxSize: MAX_CANVAS_OUTPUT_BYTES,
    onError: (c) => c.json({ error: "outputTooLarge" }, 413),
  }),
  async (c) => {
    const userId = c.get("userId");

    // parseBody returns Record<string, string | File | (string | File)[]>.
    // We pull each field out individually rather than passing the raw form
    // through Zod because Zod sees the File class as `unknown` here.
    const form = await c.req.parseBody();
    const noteIdField = form["noteId"];
    const runIdField = form["runId"];
    const mimeField = form["mimeType"];
    const fileField = form["file"];

    const parsed = canvasOutputCreateSchema.safeParse({
      noteId: typeof noteIdField === "string" ? noteIdField : undefined,
      runId:
        typeof runIdField === "string" && runIdField !== ""
          ? runIdField
          : undefined,
      mimeType: typeof mimeField === "string" ? mimeField : undefined,
    });
    if (!parsed.success) {
      return c.json({ error: "outputBadType" }, 400);
    }
    if (!(fileField instanceof File)) {
      return c.json({ error: "outputBadType" }, 400);
    }

    // Belt-and-suspenders size guard. bodyLimit() above caps the wire-level
    // ceiling but parseBody can technically receive a smaller declared
    // Content-Length than the actual payload depending on transfer-encoding;
    // checking file.size after the parse covers that.
    if (fileField.size > MAX_CANVAS_OUTPUT_BYTES) {
      return c.json({ error: "outputTooLarge" }, 413);
    }

    // Pull workspaceId + sourceType in a single SELECT so we hit the DB once
    // for the canRead/notCanvas guards. Skip soft-deleted notes — a deleted
    // canvas page should 404, same as /api/notes/:id behaves.
    const [note] = await db
      .select({
        id: notes.id,
        workspaceId: notes.workspaceId,
        sourceType: notes.sourceType,
      })
      .from(notes)
      .where(and(eq(notes.id, parsed.data.noteId), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "notFound" }, 404);

    // 404 instead of 403 to match /api/code/run — hide note existence across
    // workspaces so a probe can't enumerate ids.
    if (
      !(await canWrite(userId, { type: "note", id: parsed.data.noteId }))
    ) {
      return c.json({ error: "notFound" }, 404);
    }
    if (note.sourceType !== "canvas") {
      return c.json({ error: "notCanvas" }, 409);
    }

    const buf = Buffer.from(await fileField.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buf).digest("hex");

    // Idempotent fast path: if this (noteId, hash) pair already exists,
    // return the existing row without touching MinIO. Matters for matplotlib
    // re-runs that produce byte-identical PNGs.
    const existing = await db
      .select({
        id: canvasOutputs.id,
        createdAt: canvasOutputs.createdAt,
      })
      .from(canvasOutputs)
      .where(
        and(
          eq(canvasOutputs.noteId, parsed.data.noteId),
          eq(canvasOutputs.contentHash, hash),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return c.json({
        id: existing[0].id,
        urlPath: `/api/canvas/outputs/${existing[0].id}/file`,
        createdAt: existing[0].createdAt,
      });
    }

    // Pick file extension from the validated mime — Zod restricted us to
    // image/png + image/svg+xml so the conditional is exhaustive.
    const ext = parsed.data.mimeType === "image/svg+xml" ? "svg" : "png";
    const s3Key = `canvas-outputs/${note.workspaceId}/${parsed.data.noteId}/${hash}.${ext}`;
    await uploadObject(s3Key, buf, parsed.data.mimeType);

    const [row] = await db
      .insert(canvasOutputs)
      .values({
        noteId: parsed.data.noteId,
        runId: parsed.data.runId ?? null,
        contentHash: hash,
        mimeType: parsed.data.mimeType,
        s3Key,
        bytes: buf.length,
      })
      .returning({
        id: canvasOutputs.id,
        createdAt: canvasOutputs.createdAt,
      });

    return c.json({
      id: row!.id,
      urlPath: `/api/canvas/outputs/${row!.id}/file`,
      createdAt: row!.createdAt,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task 12 — GET /api/canvas/outputs?noteId=...
//
// Lists all outputs for a single note. Auth: canRead on the owning note.
// Cross-workspace ids and missing notes both 404 to hide existence. Order is
// createdAt DESC so the canvas viewer can render newest-first without an
// extra client-side sort.
// ─────────────────────────────────────────────────────────────────────────────

canvasRoutes.get("/outputs", outputStoreGate(), requireAuth, async (c) => {
  const userId = c.get("userId");
  const noteId = c.req.query("noteId");
  if (!noteId || !isUuid(noteId)) {
    return c.json({ error: "badRequest" }, 400);
  }

  // Skip soft-deleted notes for the same reason as /output: a deleted
  // canvas page should disappear from the API surface.
  const [note] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
  if (!note) return c.json({ error: "notFound" }, 404);
  if (!(await canRead(userId, { type: "note", id: noteId }))) {
    return c.json({ error: "notFound" }, 404);
  }

  const rows = await db
    .select({
      id: canvasOutputs.id,
      runId: canvasOutputs.runId,
      mimeType: canvasOutputs.mimeType,
      bytes: canvasOutputs.bytes,
      createdAt: canvasOutputs.createdAt,
    })
    .from(canvasOutputs)
    .where(eq(canvasOutputs.noteId, noteId))
    .orderBy(desc(canvasOutputs.createdAt));

  return c.json({
    outputs: rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      mimeType: r.mimeType,
      bytes: r.bytes,
      createdAt: r.createdAt.toISOString(),
      urlPath: `/api/canvas/outputs/${r.id}/file`,
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 12 (cont'd) — GET /api/canvas/outputs/:id/file
//
// Streams the binary from MinIO. canRead on the OWNING NOTE (not the workspace
// directly) so per-page permission overrides apply. cache-control is private
// + 1h: outputs are immutable (content_hash uniqueness) so the browser is
// safe to cache, but private prevents shared CDNs from holding a copy.
// ─────────────────────────────────────────────────────────────────────────────

canvasRoutes.get(
  "/outputs/:id/file",
  outputStoreGate(),
  requireAuth,
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "notFound" }, 404);

    const [out] = await db
      .select({
        noteId: canvasOutputs.noteId,
        s3Key: canvasOutputs.s3Key,
        mimeType: canvasOutputs.mimeType,
      })
      .from(canvasOutputs)
      .where(eq(canvasOutputs.id, id));
    if (!out) return c.json({ error: "notFound" }, 404);
    if (!(await canRead(userId, { type: "note", id: out.noteId }))) {
      return c.json({ error: "notFound" }, 404);
    }

    const obj = await streamObject(out.s3Key);
    // streamObject pulls the content-type from MinIO metadata, but we trust
    // the row's mimeType (validated on insert) over whatever S3 echoed back —
    // a misconfigured bucket policy can mutate Content-Type and we don't
    // want PNGs surfacing as octet-stream.
    c.header("Content-Type", out.mimeType);
    c.header("Cache-Control", "private, max-age=3600");
    if (obj.contentLength > 0) {
      c.header("Content-Length", String(obj.contentLength));
    }
    return c.body(obj.stream);
  },
);
