import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  db,
  notes,
  projects,
  concepts,
  conceptEdges,
  conceptNotes,
  wikiLogs,
  eq,
  and,
  sql,
} from "@opencairn/db";
import { getTemporalClient } from "../lib/temporal-client";
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

// `vector(n)` literal for pgvector cosine similarity queries. Drizzle's custom
// type serialiser already produces `[f1,f2,...]` strings; we wrap them into
// `::vector` casts at query time.
function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Plan 3 — source note ingestion callback
// ---------------------------------------------------------------------------

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

// Compiler shares the ingest task queue — one worker process handles
// both workflows. Split later if the compile path needs its own
// concurrency budget (Plan 4 Task 8 "per-project semaphore" is the
// first candidate for that split).
const COMPILER_TASK_QUEUE =
  process.env.TEMPORAL_COMPILER_TASK_QUEUE ??
  process.env.TEMPORAL_TASK_QUEUE ??
  "ingest";

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

    // Plan 4 — Compiler agent trigger. Kick a Temporal workflow that will
    // extract concepts from the source note, dedupe against existing project
    // concepts, and write wiki logs. Best-effort: failure here must not fail
    // the ingest (the source note itself is already persisted).
    if (body.triggerCompiler) {
      try {
        const client = await getTemporalClient();
        const workflowId = `compiler-${noteId}`;
        await client.workflow.start("CompilerWorkflow", {
          taskQueue: COMPILER_TASK_QUEUE,
          workflowId,
          args: [
            {
              note_id: noteId,
              project_id: body.projectId,
              workspace_id: proj.workspaceId,
              user_id: body.userId,
            },
          ],
        });
      } catch (err) {
        console.warn(
          `[internal] failed to start CompilerWorkflow for note ${noteId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
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

// ---------------------------------------------------------------------------
// Plan 4 — Compiler agent support
// ---------------------------------------------------------------------------

// GET /internal/notes/:id — worker fetches note body + scope metadata so the
// Compiler agent can operate without shipping the note payload in the
// workflow input (keeps Temporal history small; content can be MBs).
internal.get("/notes/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ error: "Invalid note id" }, 400);
  }
  const [row] = await db
    .select({
      id: notes.id,
      projectId: notes.projectId,
      workspaceId: notes.workspaceId,
      title: notes.title,
      contentText: notes.contentText,
      sourceType: notes.sourceType,
      sourceUrl: notes.sourceUrl,
      type: notes.type,
    })
    .from(notes)
    .where(eq(notes.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// POST /internal/concepts/search — vector kNN over a project's concepts.
// Uses pgvector `<=>` cosine-distance operator; similarity = 1 - distance.
const conceptSearchSchema = z.object({
  projectId: z.string().uuid(),
  embedding: z.array(z.number()),
  k: z.number().int().positive().max(50).default(10),
  // Optional name substring pre-filter (case-insensitive) — lets the
  // compiler do "dedupe by identical name" cheaply before the vector cost.
  nameIlike: z.string().min(1).max(200).optional(),
});

internal.post(
  "/concepts/search",
  zValidator("json", conceptSearchSchema),
  async (c) => {
    const body = c.req.valid("json");
    const vec = vectorLiteral(body.embedding);

    // Raw SQL because drizzle's pgvector support is limited.
    const rows = await db.execute(sql`
      SELECT
        id,
        name,
        description,
        1 - (embedding <=> ${vec}::vector) AS similarity
      FROM concepts
      WHERE project_id = ${body.projectId}
        ${body.nameIlike ? sql`AND name ILIKE ${`%${body.nameIlike}%`}` : sql``}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vec}::vector ASC
      LIMIT ${body.k}
    `);

    // drizzle-orm returns rows under `.rows` for raw queries on node-postgres.
    const data = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows ?? rows;
    return c.json({ results: data });
  },
);

// POST /internal/concepts/upsert — idempotent upsert by (project_id, name).
// Returns the concept id and whether the row was newly created. If an
// existing row is updated, its description is kept unless the incoming one
// is longer (compiler heuristic — richer descriptions win).
const conceptUpsertSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().default(""),
  embedding: z.array(z.number()),
});

internal.post(
  "/concepts/upsert",
  zValidator("json", conceptUpsertSchema),
  async (c) => {
    const body = c.req.valid("json");

    const [existing] = await db
      .select({ id: concepts.id, description: concepts.description })
      .from(concepts)
      .where(
        and(
          eq(concepts.projectId, body.projectId),
          eq(concepts.name, body.name),
        ),
      );

    if (existing) {
      const currentLen = (existing.description ?? "").length;
      if (body.description.length > currentLen) {
        await db
          .update(concepts)
          .set({ description: body.description, embedding: body.embedding })
          .where(eq(concepts.id, existing.id));
      }
      return c.json({ id: existing.id, created: false });
    }

    const id = randomUUID();
    await db.insert(concepts).values({
      id,
      projectId: body.projectId,
      name: body.name,
      description: body.description,
      embedding: body.embedding,
    });
    return c.json({ id, created: true }, 201);
  },
);

// POST /internal/concept-edges — idempotent edge upsert. Edges have no
// natural PK, so we dedupe on (source_id, target_id, relation_type). A
// repeat call strengthens the weight (max of existing and incoming).
const conceptEdgeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  relationType: z.string().min(1).max(100).default("related-to"),
  weight: z.number().min(0).max(1).default(1.0),
  evidenceNoteId: z.string().uuid().nullable().optional(),
});

internal.post(
  "/concept-edges",
  zValidator("json", conceptEdgeSchema),
  async (c) => {
    const body = c.req.valid("json");
    if (body.sourceId === body.targetId) {
      return c.json({ error: "Self-edge not allowed" }, 400);
    }

    const [existing] = await db
      .select({ id: conceptEdges.id, weight: conceptEdges.weight })
      .from(conceptEdges)
      .where(
        and(
          eq(conceptEdges.sourceId, body.sourceId),
          eq(conceptEdges.targetId, body.targetId),
          eq(conceptEdges.relationType, body.relationType),
        ),
      );

    if (existing) {
      if (body.weight > existing.weight) {
        await db
          .update(conceptEdges)
          .set({
            weight: body.weight,
            evidenceNoteId: body.evidenceNoteId ?? null,
          })
          .where(eq(conceptEdges.id, existing.id));
      }
      return c.json({ id: existing.id, created: false });
    }

    const id = randomUUID();
    await db.insert(conceptEdges).values({
      id,
      sourceId: body.sourceId,
      targetId: body.targetId,
      relationType: body.relationType,
      weight: body.weight,
      evidenceNoteId: body.evidenceNoteId ?? null,
    });
    return c.json({ id, created: true }, 201);
  },
);

// POST /internal/concept-notes — link a concept to a note. The table has a
// composite primary key (concept_id, note_id), so we use ON CONFLICT DO
// NOTHING semantics — duplicate links are silently ignored.
const conceptNoteSchema = z.object({
  conceptId: z.string().uuid(),
  noteId: z.string().uuid(),
});

internal.post(
  "/concept-notes",
  zValidator("json", conceptNoteSchema),
  async (c) => {
    const body = c.req.valid("json");
    await db
      .insert(conceptNotes)
      .values({ conceptId: body.conceptId, noteId: body.noteId })
      .onConflictDoNothing();
    return c.json({ ok: true });
  },
);

// POST /internal/wiki-logs — append an audit row describing what an agent
// did to a note. Used by Compiler/Research/Librarian to build the public
// edit history visible in the note's sidebar.
const wikiLogSchema = z.object({
  noteId: z.string().uuid(),
  agent: z.string().min(1).max(100),
  action: z.enum(["create", "update", "merge", "link", "unlink"]),
  diff: z.record(z.unknown()).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
});

internal.post(
  "/wiki-logs",
  zValidator("json", wikiLogSchema),
  async (c) => {
    const body = c.req.valid("json");
    const id = randomUUID();
    await db.insert(wikiLogs).values({
      id,
      noteId: body.noteId,
      agent: body.agent,
      action: body.action,
      diff: body.diff ?? null,
      reason: body.reason ?? null,
    });
    return c.json({ id }, 201);
  },
);

export const internalRoutes = internal;
