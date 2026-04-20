import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, notes, projects, eq } from "@opencairn/db";
import type { AppEnv } from "../lib/types";

// Internal-only routes — reachable by worker callbacks on the docker network.
// Auth is a shared secret (INTERNAL_API_SECRET) carried in `X-Internal-Secret`;
// this header must NEVER be exposed on the public ingress. See
// docs/superpowers/plans/2026-04-09-plan-3-ingest-pipeline.md Task 9.

const internal = new Hono<AppEnv>();

internal.use("*", async (c, next) => {
  const secret = c.req.header("X-Internal-Secret");
  const expected = process.env.INTERNAL_API_SECRET;
  // If the server has no secret configured, fail closed — never match an
  // undefined expected to an undefined header.
  if (!expected || secret !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// NOTE: `userId` and `parentNoteId` are accepted from the worker for audit
// logging / future threading but are NOT persisted — the `notes` table
// doesn't carry a user_id or parent_id column (ownership via workspace,
// hierarchy via folders). Plan 3 plan doc assumed columns that don't exist;
// we keep the wire format faithful so the worker side can stay generic.
const sourceNoteSchema = z.object({
  userId: z.string(),
  projectId: z.string().uuid(),
  parentNoteId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(512),
  content: z.string(),
  sourceType: z.enum([
    "pdf",
    "audio",
    "video",
    "image",
    "youtube",
    "web",
    "unknown",
  ]),
  objectKey: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  mimeType: z.string().min(1).max(255),
  triggerCompiler: z.boolean().default(false),
});

function toPlateDoc(text: string): Record<string, unknown> {
  // Match the Plate v49 shape used by the editor (Plan 2). One paragraph
  // block with the extracted text as a single child run. Editor opens the
  // note and can chunk/reformat in-place later.
  return {
    type: "doc",
    children: [{ type: "p", children: [{ text }] }],
  };
}

internal.post(
  "/source-notes",
  zValidator("json", sourceNoteSchema),
  async (c) => {
    const body = c.req.valid("json");

    // Derive workspaceId from project — notes.workspaceId is NOT NULL
    // (denormalised for query speed, same pattern as notes.ts POST).
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);

    const noteId = randomUUID();
    await db.insert(notes).values({
      id: noteId,
      projectId: body.projectId,
      workspaceId: proj.workspaceId,
      title: body.title,
      content: toPlateDoc(body.content),
      contentText: body.content,
      type: "source",
      sourceType: body.sourceType,
      sourceFileKey: body.objectKey ?? null,
      sourceUrl: body.sourceUrl ?? null,
      mimeType: body.mimeType,
      isAuto: true,
    });

    // TODO Plan 5: enqueue Compiler Agent workflow when triggerCompiler is true.
    if (body.triggerCompiler) {
      console.log(
        `[internal] compiler trigger queued for note ${noteId} (user=${body.userId} project=${body.projectId})`,
      );
    }

    return c.json({ noteId }, 201);
  },
);

// Plan 3 Task 10 — dead-letter failure receiver. The worker posts here after
// it has moved a failed upload under the quarantine prefix. v0 is a
// structured log; Plan 5 will wire this to a jobs table + admin dashboard.
const failureSchema = z.object({
  userId: z.string(),
  projectId: z.string().uuid(),
  sourceUrl: z.string().url().nullable().optional(),
  objectKey: z.string().nullable().optional(),
  quarantineKey: z.string().nullable().optional(),
  reason: z.string(),
});

internal.post(
  "/ingest-failures",
  zValidator("json", failureSchema),
  async (c) => {
    const body = c.req.valid("json");
    console.warn("[ingest-failure]", JSON.stringify(body));
    return c.json({ ok: true }, 202);
  },
);

export const internalRoutes = internal;
