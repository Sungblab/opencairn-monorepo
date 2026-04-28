import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import {
  db,
  user,
  workspaces,
  workspaceMembers,
  workspaceInvites,
  folders,
  notes,
  projects,
  concepts,
  conceptEdges,
  conceptNotes,
  wikiLogs,
  projectSemaphoreSlots,
  embeddingBatches,
  importJobs,
  researchRuns,
  researchRunArtifacts,
  codeRuns,
  codeTurns,
  suggestions,
  staleAlerts,
  audioFiles,
  noteEnrichments,
  eq,
  and,
  isNull,
  sql,
  lt,
  count,
  inArray,
} from "@opencairn/db";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { signSessionForUser } from "../lib/test-session";
import { createMultiRoleSeed } from "../lib/test-seed-multi";
import { isUuid } from "../lib/validators";
import { plateValueToText } from "../lib/plate-text";
import { labelFromId } from "../lib/tree-queries";
import { canRead } from "../lib/permissions";
import { expandFromConcept } from "../lib/expand-graph";
import { projectHybridSearch } from "../lib/internal-hybrid-search";
import type { AppEnv } from "../lib/types";
import {
  assertResourceWorkspace,
  assertManyResourceWorkspace,
  WorkspaceMismatchError,
} from "../lib/internal-assert";
import { persistAndPublish } from "../lib/notification-events";
import { federatedSearch } from "../lib/literature-search";

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

// Runs `check`, catches WorkspaceMismatchError, returns a 403 Response.
// Non-mismatch errors rethrow for the global handler. [Tier 1 item 1-3]
async function guardWorkspace(
  c: Context<AppEnv>,
  check: () => Promise<void>,
): Promise<Response | null> {
  try {
    await check();
    return null;
  } catch (err) {
    if (err instanceof WorkspaceMismatchError) {
      return c.json({ error: "workspace_mismatch" }, 403);
    }
    throw err;
  }
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
    // Tier 0 item 0-1: soft-deleted notes stay hidden from the worker path so
    // the compiler does not re-embed a note after the owner emptied their
    // trash. permissions.ts enforces the same invariant for session paths.
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// GET /internal/concepts/:id — fetch a single concept row including its
// embedding. Used by ConnectorAgent (Plan 8) to retrieve the source
// concept's vector before doing the cross-project similarity search.
internal.get("/concepts/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ error: "Invalid concept id" }, 400);
  }
  const rowsRaw = await db.execute(sql`
    SELECT id, project_id, name, description, embedding
    FROM concepts
    WHERE id = ${id}
  `);
  const rows =
    (rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (rowsRaw as unknown as Array<Record<string, unknown>>);
  if (!rows.length) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  return c.json({
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    embedding: row.embedding ?? null,
  });
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

// POST /internal/workspace-concepts/search — cross-project kNN similarity
// search. Finds concepts in ALL projects of a workspace, excluding the
// source project. Used by ConnectorAgent to surface cross-project links.
//
// SQL: cosine similarity via pgvector `<=>` operator, joined to projects so
// we can filter by workspace_id and exclude the caller's own project.
const workspaceConceptSearchSchema = z.object({
  workspaceId: z.string().uuid(),
  embedding: z.array(z.number()),
  k: z.number().int().positive().max(50).default(10),
  excludeProjectId: z.string().uuid(),
});

internal.post(
  "/workspace-concepts/search",
  zValidator("json", workspaceConceptSearchSchema),
  async (c) => {
    const body = c.req.valid("json");
    const vec = vectorLiteral(body.embedding);

    const rows = await db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.project_id,
        1 - (c.embedding <=> ${vec}::vector) AS similarity
      FROM concepts c
      JOIN projects p ON p.id = c.project_id
      WHERE p.workspace_id = ${body.workspaceId}
        AND c.project_id != ${body.excludeProjectId}
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vec}::vector ASC
      LIMIT ${body.k}
    `);

    const data =
      (rows as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (rows as unknown as Array<Record<string, unknown>>);

    return c.json({
      results: data.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? ""),
        project_id: String(r.project_id),
        similarity: Number(r.similarity ?? 0),
      })),
    });
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

// ---------------------------------------------------------------------------
// Plan 4 Phase B — Research agent support (hybrid search over source notes)
// ---------------------------------------------------------------------------

// POST /internal/notes/hybrid-search — RRF-fused pgvector cosine + tsvector
// BM25 over notes scoped to a project. Returns the top-k merged results with
// per-channel scores so the caller can cite each hit and display a snippet.
//
// We run the two queries independently (each LIMIT k*2 so fusion has headroom
// for the complement case), then fuse in JS using the standard
// `1/(k_rrf + rank)` formula with k_rrf=60. Doing RRF in SQL is possible but
// Postgres window functions over CTEs for a k=10 case aren't meaningfully
// faster and make the query much harder to read.
//
// LightRAG / graph expansion (plan's "graph_hops") is deferred to Plan 5.
// v0 returns raw note hits which is sufficient for the Research agent to
// ground answers + cite — the graph layer enriches rather than replaces.
const hybridSearchSchema = z.object({
  projectId: z.string().uuid(),
  queryText: z.string().min(1).max(2000),
  queryEmbedding: z.array(z.number()),
  k: z.number().int().positive().max(50).default(10),
});

internal.post(
  "/notes/hybrid-search",
  zValidator("json", hybridSearchSchema),
  async (c) => {
    const body = c.req.valid("json");
    const results = await projectHybridSearch({
      projectId: body.projectId,
      queryText: body.queryText,
      queryEmbedding: body.queryEmbedding,
      k: body.k,
    });
    return c.json({ results });
  },
);

// ---------------------------------------------------------------------------
// Agent Runtime v2 · Sub-A — tool-demo retrieval support
// ---------------------------------------------------------------------------

// GET /internal/projects/:id/topics — top 30 concepts in the project ranked
// by note-link count. Used by `list_project_topics` tool as the Layer 3
// hierarchical retrieval entry point (see docs/architecture/context-budget.md).
internal.get("/projects/:id/topics", async (c) => {
  const projectId = c.req.param("id");
  if (!z.string().uuid().safeParse(projectId).success) {
    return c.json({ error: "Invalid project id" }, 400);
  }
  const rowsRaw = await db.execute(sql`
    SELECT c.id AS topic_id, c.name, COUNT(cn.note_id)::int AS concept_count
    FROM concepts c
    LEFT JOIN concept_notes cn ON cn.concept_id = c.id
    WHERE c.project_id = ${projectId}
    GROUP BY c.id, c.name
    ORDER BY concept_count DESC, c.name ASC
    LIMIT 30
  `);
  const rows =
    (rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (rowsRaw as unknown as Array<Record<string, unknown>>);
  return c.json({
    results: rows.map((r) => ({
      topic_id: String(r.topic_id),
      name: String(r.name),
      concept_count: Number(r.concept_count ?? 0),
    })),
  });
});

// ---------------------------------------------------------------------------
// Plan 5 Phase 2 — concept-graph expand for VisualizationAgent + tools
// ---------------------------------------------------------------------------

// POST /internal/projects/:id/graph/expand — N-hop subgraph fetch around a
// seed concept. Internal counterpart of the user-session GET route in
// routes/graph.ts; the worker `get_concept_graph` builtin tool calls this
// via AgentApiClient.expand_concept_graph.
//
// Workspace scope is enforced two ways (defense in depth, matches the
// internal-API memo): the request body MUST carry a `workspaceId` that
// matches `projects.workspaceId`, AND `userId` must satisfy `canRead` on
// the project. A worker bug that mixed two workspaces' state would fail
// the workspace match before any read occurs; a worker bug that
// re-purposed a foreign user would fail canRead.
const internalGraphExpandSchema = z.object({
  conceptId: z.string().uuid(),
  hops: z.coerce.number().int().min(1).max(3).default(1),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

internal.post(
  "/projects/:id/graph/expand",
  zValidator("json", internalGraphExpandSchema),
  async (c) => {
    const projectId = c.req.param("id");
    if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
    const { conceptId, hops, workspaceId, userId } = c.req.valid("json");

    // 1. Project must exist; its workspaceId must match the body's claim.
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!proj) return c.json({ error: "not-found" }, 404);
    if (proj.workspaceId !== workspaceId) {
      return c.json({ error: "workspace_mismatch" }, 403);
    }

    // 2. canRead enforcement using the carried userId — same surface as
    //    the user-session route would apply on a session-bound user.id.
    const allowed = await canRead(userId, { type: "project", id: projectId });
    if (!allowed) return c.json({ error: "forbidden" }, 403);

    // 3. Seed concept must live in this project — prevents a cross-project
    //    leak via a concept id stolen from another project's row set.
    const [seed] = await db
      .select({ id: concepts.id })
      .from(concepts)
      .where(and(eq(concepts.id, conceptId), eq(concepts.projectId, projectId)));
    if (!seed) return c.json({ error: "not-found" }, 404);

    // 4. Shared BFS + node/edge fetch — same SQL as the user-session route
    //    via the helper at lib/expand-graph.ts.
    const body = await expandFromConcept(projectId, conceptId, hops);
    return c.json(body);
  },
);

// ---------------------------------------------------------------------------
// Plan 4 Phase B — Librarian agent support
// ---------------------------------------------------------------------------

// GET /internal/projects/:id/orphan-concepts — concepts with no edges in
// either direction. Librarian detect_orphans step consumes this.
internal.get("/projects/:id/orphan-concepts", async (c) => {
  const projectId = c.req.param("id");
  if (!z.string().uuid().safeParse(projectId).success) {
    return c.json({ error: "Invalid project id" }, 400);
  }
  const rowsRaw = await db.execute(sql`
    SELECT c.id, c.name
    FROM concepts c
    WHERE c.project_id = ${projectId}
      AND NOT EXISTS (
        SELECT 1 FROM concept_edges e
        WHERE e.source_id = c.id OR e.target_id = c.id
      )
  `);
  const rows =
    (rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (rowsRaw as unknown as Array<Record<string, unknown>>);
  return c.json({
    results: rows.map((r) => ({ id: String(r.id), name: String(r.name) })),
  });
});

// GET /internal/projects/:id/concept-pairs — near-neighbour concept pairs for
// contradiction / duplicate analysis. `similarityMin` + `similarityMax` bound
// the band: `contradiction` check wants 0.75-0.95 (related but potentially
// conflicting), `duplicate` check wants >=0.97.
internal.get("/projects/:id/concept-pairs", async (c) => {
  const projectId = c.req.param("id");
  const similarityMinRaw = c.req.query("similarityMin");
  const similarityMaxRaw = c.req.query("similarityMax");
  const limitRaw = c.req.query("limit");
  if (!z.string().uuid().safeParse(projectId).success) {
    return c.json({ error: "Invalid project id" }, 400);
  }
  const similarityMin = similarityMinRaw ? Number(similarityMinRaw) : 0.75;
  const similarityMax = similarityMaxRaw ? Number(similarityMaxRaw) : 1.0;
  const limit = Math.min(Math.max(Number(limitRaw ?? 20), 1), 200);
  if (
    !Number.isFinite(similarityMin) ||
    !Number.isFinite(similarityMax) ||
    similarityMin >= similarityMax
  ) {
    return c.json({ error: "Invalid similarity bounds" }, 400);
  }

  // We use a self-join with `a.id < b.id` to avoid (A,B)+(B,A) duplicates and
  // cast to jsonb/text so node-postgres serialises uuids faithfully.
  const rowsRaw = await db.execute(sql`
    SELECT
      a.id AS id_a, a.name AS name_a, a.description AS desc_a,
      b.id AS id_b, b.name AS name_b, b.description AS desc_b,
      1 - (a.embedding <=> b.embedding) AS similarity
    FROM concepts a
    JOIN concepts b
      ON a.project_id = b.project_id AND a.id < b.id
    WHERE a.project_id = ${projectId}
      AND a.embedding IS NOT NULL
      AND b.embedding IS NOT NULL
      AND 1 - (a.embedding <=> b.embedding) >= ${similarityMin}
      AND 1 - (a.embedding <=> b.embedding) <= ${similarityMax}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `);
  const rows =
    (rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (rowsRaw as unknown as Array<Record<string, unknown>>);
  return c.json({
    results: rows.map((r) => ({
      idA: String(r.id_a),
      nameA: String(r.name_a ?? ""),
      descriptionA: String(r.desc_a ?? ""),
      idB: String(r.id_b),
      nameB: String(r.name_b ?? ""),
      descriptionB: String(r.desc_b ?? ""),
      similarity: Number(r.similarity ?? 0),
    })),
  });
});

// POST /internal/concepts/merge — collapse `duplicateIds` into `primaryId`.
// Re-points every concept_edges row + concept_notes link to the primary,
// then deletes the duplicates. Description is left untouched (Librarian's
// LLM already updated primary via /concepts/upsert before calling merge).
const mergeConceptsSchema = z.object({
  // Tier 1 item 1-3: require workspaceId so we can enforce that every
  // concept id in the payload belongs to the claimed workspace before we
  // start mutating. Prevents a worker bug from merging a foreign-workspace
  // concept (which would silently *delete* someone else's row).
  workspaceId: z.string().uuid(),
  primaryId: z.string().uuid(),
  duplicateIds: z.array(z.string().uuid()).min(1).max(50),
});

internal.post(
  "/concepts/merge",
  zValidator("json", mergeConceptsSchema),
  async (c) => {
    const body = c.req.valid("json");
    if (body.duplicateIds.includes(body.primaryId)) {
      return c.json({ error: "primary cannot be in duplicates" }, 400);
    }

    // Workspace scope check runs outside the transaction so a foreign-
    // workspace id returns 403 without ever opening a write transaction.
    try {
      await assertResourceWorkspace(db, body.workspaceId, {
        type: "concept",
        id: body.primaryId,
      });
      await assertManyResourceWorkspace(db, body.workspaceId, {
        type: "concept",
        ids: body.duplicateIds,
      });
    } catch (err) {
      if (err instanceof WorkspaceMismatchError) {
        return c.json({ error: "workspace_mismatch" }, 403);
      }
      throw err;
    }

    // Tier 1 item 1-1 (Plan 4 C-1 + Plan 1 H-5):
    //   * Use `db.transaction()` so the reparent-then-delete sequence is
    //     a real atomic unit. The old BEGIN/COMMIT string executed as a
    //     single node-postgres `execute` which does NOT roll back on
    //     interior failure — any error left concept_edges pointing at a
    //     row that had already been deleted.
    //   * Replace `sql.raw` string concatenation of the UUID array with
    //     `sql.join` so the duplicate ids travel as typed parameters
    //     rather than being interpolated into the query body.
    //   * `VALUES (...) :: uuid` casts keep the array typing explicit
    //     without a raw `ARRAY[]` literal.
    const dupArray = sql`ARRAY[${sql.join(
      body.duplicateIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`;

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE concept_edges SET source_id = ${body.primaryId}
        WHERE source_id = ANY(${dupArray})
      `);
      await tx.execute(sql`
        UPDATE concept_edges SET target_id = ${body.primaryId}
        WHERE target_id = ANY(${dupArray})
      `);
      // An edge from primary to itself is meaningless; delete the self-
      // loops that the reparent above may have just created.
      await tx.execute(sql`
        DELETE FROM concept_edges WHERE source_id = target_id
      `);
      await tx.execute(sql`
        INSERT INTO concept_notes (concept_id, note_id)
        SELECT ${body.primaryId}, note_id FROM concept_notes
        WHERE concept_id = ANY(${dupArray})
        ON CONFLICT DO NOTHING
      `);
      await tx.execute(sql`
        DELETE FROM concept_notes WHERE concept_id = ANY(${dupArray})
      `);
      await tx.execute(sql`
        DELETE FROM concepts WHERE id = ANY(${dupArray})
      `);
    });

    return c.json({ ok: true, mergedCount: body.duplicateIds.length });
  },
);

// GET /internal/projects/:id/link-candidates — concept pairs that frequently
// co-occur in the same note. Librarian strengthens these edges after each
// nightly run (weight := clamp(existing, cnt * 0.05, 1.0)).
internal.get("/projects/:id/link-candidates", async (c) => {
  const projectId = c.req.param("id");
  const minCoOccurrenceRaw = c.req.query("minCoOccurrence");
  const limitRaw = c.req.query("limit");
  if (!z.string().uuid().safeParse(projectId).success) {
    return c.json({ error: "Invalid project id" }, 400);
  }
  const minCoOccurrence = Math.max(Number(minCoOccurrenceRaw ?? 2), 1);
  const limit = Math.min(Math.max(Number(limitRaw ?? 100), 1), 1000);
  const rowsRaw = await db.execute(sql`
    SELECT cn1.concept_id AS src, cn2.concept_id AS tgt, COUNT(*)::int AS cnt
    FROM concept_notes cn1
    JOIN concept_notes cn2
      ON cn1.note_id = cn2.note_id AND cn1.concept_id < cn2.concept_id
    JOIN concepts c1 ON c1.id = cn1.concept_id AND c1.project_id = ${projectId}
    JOIN concepts c2 ON c2.id = cn2.concept_id AND c2.project_id = ${projectId}
    GROUP BY cn1.concept_id, cn2.concept_id
    HAVING COUNT(*) >= ${minCoOccurrence}
    ORDER BY cnt DESC
    LIMIT ${limit}
  `);
  const rows =
    (rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (rowsRaw as unknown as Array<Record<string, unknown>>);
  return c.json({
    results: rows.map((r) => ({
      sourceId: String(r.src),
      targetId: String(r.tgt),
      coOccurrenceCount: Number(r.cnt ?? 0),
    })),
  });
});

// POST /internal/notes/:id/refresh-tsv — safety valve: force-regenerate
// content_tsv for a single note. The trigger keeps the column fresh
// automatically; this endpoint exists so Librarian can rebuild after a
// migration changes the tokenizer config without a full reindex migration.
internal.post("/notes/:id/refresh-tsv", async (c) => {
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ error: "Invalid note id" }, 400);
  }
  // Tier 0 item 0-1: skip soft-deleted notes so a stray Librarian rebuild
  // does not regenerate the tsvector for rows the user already discarded.
  // Using drizzle's update builder with .returning() gives us a typed row
  // count (array length) without reaching into the raw pg driver shape.
  const updated = await db
    .update(notes)
    .set({
      contentTsv: sql`to_tsvector('simple',
        coalesce(${notes.title}, '') || ' ' || coalesce(${notes.contentText}, ''))`,
    })
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .returning({ id: notes.id });
  if (updated.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Plan 4 Phase B Task 8 — per-project semaphore (row-count slots)
// ---------------------------------------------------------------------------

// POST /internal/semaphores/acquire — try to claim a slot. Returns
// `{ acquired: true }` on success or `{ acquired: false, running: N }` if
// capacity is full. The worker activity spin-waits with a heartbeat.
//
// Design note (see also schema comment): we rejected a Temporal mutex
// workflow because (a) worker cannot touch PG directly, (b) mutex state
// still ends up persisted *somewhere*, and (c) a counted-slot table is
// observable — you can `SELECT * FROM project_semaphore_slots` during an
// incident and see exactly what's running. The `expires_at` column is the
// crash-safety belt: a holder that dies without releasing frees its slot
// automatically once `now() > expires_at`.
const semaphoreAcquireSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  holderId: z.string().min(1).max(200),
  purpose: z.string().min(1).max(100),
  maxConcurrent: z.number().int().positive().max(100).default(3),
  ttlSeconds: z.number().int().positive().max(60 * 60 * 4).default(60 * 30),
});

internal.post(
  "/semaphores/acquire",
  zValidator("json", semaphoreAcquireSchema),
  async (c) => {
    const body = c.req.valid("json");

    const guard = await guardWorkspace(c, () =>
      assertResourceWorkspace(db, body.workspaceId, {
        type: "project",
        id: body.projectId,
      }),
    );
    if (guard) return guard;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + body.ttlSeconds * 1000);

    // Tier 1 item 1-2 (Plan 4 C-2):
    //   The old sweep → count → insert sequence was three independent
    //   statements, so two concurrent acquires on the same project could
    //   both see `running < maxConcurrent` before either inserted. With
    //   `max = 3` and a burst of 4 workers, we observed double-commit
    //   in the wild. Wrap the whole transaction in
    //   `pg_advisory_xact_lock(hashtext(projectId))` so concurrent
    //   acquires on the same project serialize on the advisory lock and
    //   release it automatically at commit/rollback. The lock is per-
    //   project so different projects remain independently concurrent.
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${body.projectId}::text))`,
      );

      // 1. Sweep expired slots inside the lock so capacity reflects reality
      //    AND another concurrent acquire cannot race the sweep.
      await tx
        .delete(projectSemaphoreSlots)
        .where(
          and(
            eq(projectSemaphoreSlots.projectId, body.projectId),
            lt(projectSemaphoreSlots.expiresAt, now),
          ),
        );

      // 2. Idempotent renewal — if this holder already owns a slot, extend
      //    the deadline and report success. Covers the common case of an
      //    activity retry after a transient crash between acquire and the
      //    workflow body starting.
      const [existing] = await tx
        .select({ id: projectSemaphoreSlots.id })
        .from(projectSemaphoreSlots)
        .where(
          and(
            eq(projectSemaphoreSlots.projectId, body.projectId),
            eq(projectSemaphoreSlots.holderId, body.holderId),
          ),
        );
      if (existing) {
        await tx
          .update(projectSemaphoreSlots)
          .set({ expiresAt })
          .where(eq(projectSemaphoreSlots.id, existing.id));
        return { acquired: true as const, renewed: true as const };
      }

      // 3. Count and conditionally insert. With the advisory lock held,
      //    the count is consistent for the remainder of the transaction
      //    so a separate INSERT ... SELECT WHERE NOT EXISTS is not needed.
      const [runningRow] = await tx
        .select({ n: count() })
        .from(projectSemaphoreSlots)
        .where(eq(projectSemaphoreSlots.projectId, body.projectId));
      const running = Number(runningRow?.n ?? 0);
      if (running >= body.maxConcurrent) {
        return { acquired: false as const, running };
      }

      await tx.insert(projectSemaphoreSlots).values({
        projectId: body.projectId,
        holderId: body.holderId,
        purpose: body.purpose,
        expiresAt,
      });
      return { acquired: true as const, renewed: false as const };
    });

    return c.json(result);
  },
);

// POST /internal/semaphores/release — drop a holder's slot. Safe to call
// twice (no-op if already released).
const semaphoreReleaseSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  holderId: z.string().min(1).max(200),
});

internal.post(
  "/semaphores/release",
  zValidator("json", semaphoreReleaseSchema),
  async (c) => {
    const body = c.req.valid("json");

    const guard = await guardWorkspace(c, () =>
      assertResourceWorkspace(db, body.workspaceId, {
        type: "project",
        id: body.projectId,
      }),
    );
    if (guard) return guard;

    await db
      .delete(projectSemaphoreSlots)
      .where(
        and(
          eq(projectSemaphoreSlots.projectId, body.projectId),
          eq(projectSemaphoreSlots.holderId, body.holderId),
        ),
      );
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Plan 3b — embedding_batches lifecycle (worker-owned)
// ---------------------------------------------------------------------------

// The worker owns the full lifecycle of an `embedding_batches` row:
// create (before submit), update-state (on poll), mark-complete (on fetch).
// We expose three narrow endpoints rather than a generic PATCH so the
// contract from packages/llm batch_types.py stays legible here — each
// endpoint accepts exactly the fields worker activities need.

const embeddingBatchStates = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "timeout",
] as const;

const createEmbeddingBatchSchema = z.object({
  workspaceId: z.string().uuid().nullable(),
  provider: z.string().min(1).max(50),
  providerBatchName: z.string().min(1).max(500),
  inputCount: z.number().int().nonnegative(),
  inputS3Key: z.string().min(1).max(500),
});

internal.post(
  "/embedding-batches",
  zValidator("json", createEmbeddingBatchSchema),
  async (c) => {
    const body = c.req.valid("json");
    const now = new Date();
    // ON CONFLICT DO NOTHING on the unique index makes this idempotent —
    // if Temporal replays the submit activity after a worker crash, the
    // second insert is a no-op and we simply look up the existing row.
    const [inserted] = await db
      .insert(embeddingBatches)
      .values({
        workspaceId: body.workspaceId,
        provider: body.provider,
        providerBatchName: body.providerBatchName,
        state: "running",
        inputCount: body.inputCount,
        pendingCount: body.inputCount,
        inputS3Key: body.inputS3Key,
        submittedAt: now,
      })
      .onConflictDoNothing({
        target: embeddingBatches.providerBatchName,
      })
      .returning({ id: embeddingBatches.id });
    if (inserted) {
      return c.json({ id: inserted.id, created: true });
    }
    // Already existed — return the existing id for the replay case.
    const [existing] = await db
      .select({ id: embeddingBatches.id })
      .from(embeddingBatches)
      .where(eq(embeddingBatches.providerBatchName, body.providerBatchName));
    if (!existing) {
      return c.json({ error: "insert conflict but row missing" }, 500);
    }
    return c.json({ id: existing.id, created: false });
  },
);

const updateEmbeddingBatchSchema = z.object({
  state: z.enum(embeddingBatchStates),
  successCount: z.number().int().nonnegative().optional(),
  failureCount: z.number().int().nonnegative().optional(),
  pendingCount: z.number().int().nonnegative().optional(),
  outputS3Key: z.string().min(1).max(500).nullish(),
  error: z.string().max(2000).nullish(),
  markCompleted: z.boolean().optional(),
});

internal.patch(
  "/embedding-batches/:id",
  zValidator("json", updateEmbeddingBatchSchema),
  async (c) => {
    const id = c.req.param("id");
    // Match the UUID guard style used elsewhere in this file — an
    // invalid path param should surface as a clean 400, not a 500 from
    // Postgres' uuid cast.
    if (!z.string().uuid().safeParse(id).success) {
      return c.json({ error: "invalid uuid" }, 400);
    }
    const body = c.req.valid("json");
    // Drizzle's typed setters want us to only include fields we actually
    // want to touch; build the patch object conditionally so a poll that
    // only changes `state` doesn't clobber success/failure counts to null.
    const patch: Record<string, unknown> = { state: body.state };
    if (body.successCount !== undefined) patch.successCount = body.successCount;
    if (body.failureCount !== undefined) patch.failureCount = body.failureCount;
    if (body.pendingCount !== undefined) patch.pendingCount = body.pendingCount;
    if (body.outputS3Key !== undefined) patch.outputS3Key = body.outputS3Key;
    if (body.error !== undefined) patch.error = body.error;
    if (body.markCompleted) patch.completedAt = new Date();
    const [updated] = await db
      .update(embeddingBatches)
      .set(patch)
      .where(eq(embeddingBatches.id, id))
      .returning({ id: embeddingBatches.id });
    if (!updated) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Ingest Source Expansion — import-job lifecycle + flat note materialization
// ---------------------------------------------------------------------------

// GET /internal/import-jobs/:id — worker re-hydrates the job row between
// activities. We synthesize a `target` discriminated-union shape for the
// worker so it doesn't have to reimplement the "new vs existing" decision
// against raw columns.
internal.get("/import-jobs/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ error: "Invalid job id" }, 400);
  }
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .limit(1);
  if (!job) return c.json({ error: "not_found" }, 404);
  return c.json({
    id: job.id,
    workspaceId: job.workspaceId,
    userId: job.userId,
    source: job.source,
    status: job.status,
    totalItems: job.totalItems,
    completedItems: job.completedItems,
    failedItems: job.failedItems,
    sourceMetadata: job.sourceMetadata,
    // `target` is the worker-facing view. If targetProjectId is NULL the
    // activity will create a fresh project and PATCH the ids back.
    target: job.targetProjectId
      ? {
          kind: "existing" as const,
          projectId: job.targetProjectId,
          parentNoteId: job.targetParentNoteId,
        }
      : { kind: "new" as const },
  });
});

const importJobPatchSchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed"]).optional(),
  totalItems: z.number().int().nonnegative().optional(),
  completedItems: z.number().int().nonnegative().optional(),
  failedItems: z.number().int().nonnegative().optional(),
  targetProjectId: z.string().uuid().nullable().optional(),
  targetParentNoteId: z.string().uuid().nullable().optional(),
  errorSummary: z.string().max(4000).nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
});

internal.patch(
  "/import-jobs/:id",
  zValidator("json", importJobPatchSchema),
  async (c) => {
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return c.json({ error: "Invalid job id" }, 400);
    }
    const body = c.req.valid("json");
    // Build the patch object explicitly so we only touch fields the caller
    // provided — matches the embeddingBatches PATCH style above.
    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.totalItems !== undefined) patch.totalItems = body.totalItems;
    if (body.completedItems !== undefined)
      patch.completedItems = body.completedItems;
    if (body.failedItems !== undefined) patch.failedItems = body.failedItems;
    if (body.targetProjectId !== undefined)
      patch.targetProjectId = body.targetProjectId;
    if (body.targetParentNoteId !== undefined)
      patch.targetParentNoteId = body.targetParentNoteId;
    if (body.errorSummary !== undefined) patch.errorSummary = body.errorSummary;
    if (body.finishedAt !== undefined)
      patch.finishedAt = body.finishedAt ? new Date(body.finishedAt) : null;
    if (Object.keys(patch).length === 0) return c.json({ ok: true });
    const [updated] = await db
      .update(importJobs)
      .set(patch)
      .where(eq(importJobs.id, id))
      .returning({ id: importJobs.id });
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);

// POST /internal/projects — worker creates a landing project for a "new"
// target. userId is required: projects.createdBy is NOT NULL with RESTRICT
// on user deletion, so the import job's owner is the only sensible author.
const internalProjectCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
});

internal.post(
  "/projects",
  zValidator("json", internalProjectCreateSchema),
  async (c) => {
    const body = c.req.valid("json");
    const [proj] = await db
      .insert(projects)
      .values({
        workspaceId: body.workspaceId,
        name: body.name,
        createdBy: body.userId,
      })
      .returning({ id: projects.id });
    return c.json({ id: proj.id });
  },
);

// POST /internal/notes — generic note insert for the import pipeline.
// Mirrors /internal/source-notes but accepts pre-rendered Plate content and
// skips the Compiler trigger (imports run the Compiler later, in bulk,
// once all pages have landed). parentNoteId and importPath/importJobId are
// accepted for forward-compat but NOT persisted — the notes table has no
// parent or import columns today (same precedent as /source-notes).
// POST /internal/notes — shared by the import pipeline AND the Deep Research
// persist_report activity (Phase C). Two call-site shapes supported:
//
//   A. Ingest-expansion (legacy): { projectId, title, type, sourceType,
//        content, contentText, parentNoteId?, importJobId?, importPath? }
//        — pre-rendered content + contentText, no idempotency.
//
//   B. Deep Research (Phase C):  { idempotencyKey, projectId, workspaceId,
//        userId, title, plateValue }
//        — pre-rendered Plate value; contentText derived here. workspaceId
//        must match projectId's workspace.
//
// We do not gate by payload shape explicitly; the Zod schema permits both
// and the handler branches on presence of `idempotencyKey`.
const internalNoteCreateSchema = z
  .object({
    projectId: z.string().uuid(),
    parentNoteId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(512).default("Untitled"),
    type: z.enum(["note", "source"]).default("note"),
    sourceType: z
      .enum(["pdf", "audio", "video", "image", "youtube", "web", "unknown", "notion", "paper"])
      .nullable()
      .optional(),
    content: z.unknown().nullable().optional(),
    contentText: z.string().nullable().optional(),
    importJobId: z.string().uuid().optional(),
    importPath: z.string().max(1024).optional(),
    // Plan: Literature Search & Auto-Import — paper notes carry their DOI
    // for cross-workspace dedupe (notes_workspace_doi_idx partial unique).
    doi: z.string().max(255).nullable().optional(),
    // --- Phase C additions ---
    idempotencyKey: z.string().min(1).max(128).optional(),
    workspaceId: z.string().uuid().optional(),
    userId: z.string().min(1).max(200).optional(),
    plateValue: z.unknown().optional(),
  })
  .refine(
    (v) => !(v.idempotencyKey && !v.plateValue),
    { message: "plateValue required when idempotencyKey is present" },
  );

internal.post(
  "/notes",
  zValidator("json", internalNoteCreateSchema),
  async (c) => {
    const body = c.req.valid("json");

    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);

    // If workspaceId was supplied (Phase C shape), enforce consistency.
    if (body.workspaceId && body.workspaceId !== proj.workspaceId) {
      return c.json({ error: "workspace_mismatch" }, 400);
    }

    // Idempotency — if the key matches an already-inserted research run's
    // noteId, return it instead of inserting again. Keyed on researchRuns.id
    // which equals the worker-supplied idempotencyKey (= run_id) by contract.
    // Guard: researchRuns.id is a UUID column; skip the query if the key is
    // not UUID-shaped to avoid a Postgres cast error.
    if (isUuid(body.idempotencyKey)) {
      const [existing] = await db
        .select({ noteId: researchRuns.noteId })
        .from(researchRuns)
        .where(eq(researchRuns.id, body.idempotencyKey));
      if (existing?.noteId) {
        return c.json({ id: existing.noteId, noteId: existing.noteId }, 201);
      }
    }

    // Resolve the note content and contentText from either payload shape.
    const content =
      (body.plateValue as unknown) ??
      body.content ??
      null;
    let contentText = body.contentText ?? "";
    if (!contentText && body.plateValue) {
      contentText = plateValueToText(body.plateValue as never) ?? "";
    }

    const id = randomUUID();
    await db.insert(notes).values({
      id,
      projectId: body.projectId,
      workspaceId: proj.workspaceId,
      title: body.title,
      type: body.type,
      sourceType: body.sourceType ?? null,
      content,
      contentText,
      isAuto: true,
      doi: body.doi ?? null,
    });

    // Back-fill researchRuns.noteId so a retry of this call hits the
    // idempotency branch above. UUID guard mirrors the read path above —
    // the column is uuid type, so non-UUID keys must be skipped.
    if (isUuid(body.idempotencyKey)) {
      // updatedAt is stamped by Drizzle's $onUpdate on researchRuns —
      // explicit set is redundant.
      await db
        .update(researchRuns)
        .set({ noteId: id })
        .where(eq(researchRuns.id, body.idempotencyKey));
    }

    return c.json({ id, noteId: id }, 201);
  },
);

// GET /internal/notes?workspaceId=<uuid>&doi=<doi>
// Plan: Literature Search & Auto-Import — DOI dedupe lookup. Worker calls
// this before fetching/inserting a paper so a second import of the same DOI
// (in the same workspace) returns the existing noteId instead of producing
// a duplicate row. The partial unique index notes_workspace_doi_idx is the
// hard floor; this endpoint is the cooperative check that lets the worker
// short-circuit upstream of the I/O for PDF download.
internal.get("/notes", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const doi = c.req.query("doi");
  if (!workspaceId || !isUuid(workspaceId) || !doi) {
    return c.json({ error: "workspaceId (uuid) and doi are required" }, 400);
  }
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        eq(notes.workspaceId, workspaceId),
        eq(notes.doi, doi),
        isNull(notes.deletedAt),
      ),
    );
  return c.json({ exists: !!row, noteId: row?.id ?? null });
});

// ── Literature Search & Auto-Import — agent-tool surface ─────────────────────
// Public endpoints (apps/api/src/routes/literature.ts) are session-gated.
// These mirror them for the worker's literature_search / literature_import
// tools, which run inside Temporal activities and authenticate via the
// shared internal secret instead of a session cookie.

// GET /internal/literature/search?q=&workspaceId=&limit=&sources=
internal.get("/literature/search", async (c) => {
  const q = c.req.query("q");
  const workspaceId = c.req.query("workspaceId");
  const limitRaw = c.req.query("limit");
  const sourcesRaw = c.req.query("sources");
  if (!q || !workspaceId || !isUuid(workspaceId)) {
    return c.json({ error: "q and workspaceId (uuid) required" }, 400);
  }
  const limit = Math.min(Number(limitRaw) || 10, 50);
  const allowed = new Set(["arxiv", "semantic_scholar", "crossref"] as const);
  const srcList = (sourcesRaw
    ?.split(",")
    .map((s) => s.trim())
    .filter((s): s is "arxiv" | "semantic_scholar" | "crossref" =>
      allowed.has(s as "arxiv" | "semantic_scholar" | "crossref"),
    ) ?? ["arxiv", "semantic_scholar"]) as (
    | "arxiv"
    | "semantic_scholar"
    | "crossref"
  )[];

  const { results, sourceMeta } = await federatedSearch({
    query: q,
    sources: srcList,
    limit,
  });
  return c.json({ results, total: results.length, sources: sourceMeta });
});

// POST /internal/literature/import
// Body: { ids, projectId, userId, workspaceId }. The worker tool forwards
// ToolContext fields verbatim; we still validate that projectId belongs to
// workspaceId so a buggy agent can't smuggle a write into the wrong tenant.
internal.post("/literature/import", async (c) => {
  let body: {
    ids?: unknown;
    projectId?: unknown;
    userId?: unknown;
    workspaceId?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  if (
    !Array.isArray(body.ids) ||
    body.ids.length === 0 ||
    body.ids.length > 50 ||
    !body.ids.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return c.json({ error: "ids must be 1..50 non-empty strings" }, 400);
  }
  if (
    typeof body.projectId !== "string" ||
    typeof body.workspaceId !== "string" ||
    typeof body.userId !== "string" ||
    !isUuid(body.projectId) ||
    !isUuid(body.workspaceId) ||
    body.userId.length === 0
  ) {
    return c.json(
      { error: "projectId (uuid), workspaceId (uuid), userId required" },
      400,
    );
  }

  const ids = body.ids as string[];
  const { projectId, workspaceId, userId } = body;

  // Workspace consistency — projectId must live inside the claimed
  // workspaceId. Internal API workspace-scope rule (see
  // feedback_internal_api_workspace_scope memory) — every write route
  // cross-checks projects.workspaceId.
  const [proj] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!proj) return c.json({ error: "project_not_found" }, 404);
  if (proj.workspaceId !== workspaceId) {
    return c.json({ error: "workspace_mismatch" }, 400);
  }

  // DOI dedupe pre-check (same shape as the public route). Bound to the
  // candidate doiIds (route caps ids at 50) so we don't scan the entire
  // workspace and bypass notes_workspace_doi_idx. Same fix as PR review
  // #1/#2 for the public route.
  const skipped: string[] = [];
  const doiIds = ids.filter((id) => !id.startsWith("arxiv:"));
  if (doiIds.length > 0) {
    const rows = await db
      .select({ doi: notes.doi })
      .from(notes)
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          isNull(notes.deletedAt),
          inArray(notes.doi, doiIds),
        ),
      );
    const existing = new Set(
      rows.map((r) => r.doi).filter((d): d is string => !!d),
    );
    for (const d of doiIds) if (existing.has(d)) skipped.push(d);
  }
  const freshIds = ids.filter((id) => !skipped.includes(id));
  if (freshIds.length === 0) {
    return c.json(
      { jobId: null, workflowId: null, skipped, queued: 0 },
      202,
    );
  }

  const jobId = randomUUID();
  const workflowId = `lit-import-${randomUUID()}`;
  await db.insert(importJobs).values({
    id: jobId,
    workspaceId,
    userId,
    source: "literature_search",
    workflowId,
    sourceMetadata: { selectedIds: freshIds, viaAgent: true },
  });
  const client = await getTemporalClient();
  await client.workflow.start("LitImportWorkflow", {
    taskQueue: taskQueue(),
    workflowId,
    args: [
      {
        job_id: jobId,
        user_id: userId,
        workspace_id: workspaceId,
        ids: freshIds,
      },
    ],
  });
  return c.json({ jobId, workflowId, skipped, queued: freshIds.length }, 202);
});

// PATCH /internal/notes/:id — worker backfills content after the Markdown
// converter (Task 8) finishes. Narrow allowlist so the same endpoint can't
// be (ab)used to rewrite arbitrary columns like workspace_id.
const internalNotePatchSchema = z.object({
  content: z.unknown().optional(),
  contentText: z.string().optional(),
  title: z.string().min(1).max(512).optional(),
  sourceType: z
    .enum(["pdf", "audio", "video", "image", "youtube", "web", "unknown", "notion", "paper"])
    .nullable()
    .optional(),
});

internal.patch(
  "/notes/:id",
  zValidator("json", internalNotePatchSchema),
  async (c) => {
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return c.json({ error: "invalid uuid" }, 400);
    }
    const body = c.req.valid("json");
    const patch: Record<string, unknown> = {};
    if (body.content !== undefined) patch.content = body.content;
    if (body.contentText !== undefined) patch.contentText = body.contentText;
    if (body.title !== undefined) patch.title = body.title;
    if (body.sourceType !== undefined) patch.sourceType = body.sourceType;
    if (Object.keys(patch).length === 0) return c.json({ ok: true });
    // Tier 0 item 0-1: soft-deleted notes must not be revived via this
    // worker-facing backfill — the UI hides them and the trigger column
    // alone does not block the UPDATE, so we filter here.
    const [updated] = await db
      .update(notes)
      .set(patch)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
      .returning({ id: notes.id });
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Plan 2A Task 14 — E2E test seed
// ---------------------------------------------------------------------------

// POST /internal/test-seed — create a user + workspace + project + Welcome
// note, then return a signed Better Auth session cookie so Playwright can
// attach it and drive the UI. Double-gated: the internal middleware above
// already checks X-Internal-Secret; we additionally refuse to run when
// NODE_ENV === "production" so a leaked secret in prod can't mint sessions.
internal.post("/test-seed", async (c) => {
  if (process.env.NODE_ENV === "production") {
    return c.json({ error: "test-seed disabled in production" }, 403);
  }

  const parsed = (await c.req.json().catch(() => ({}))) as {
    mode?:
      | "default"
      | "onboarding-empty"
      | "onboarding-invite"
      | "canvas-phase2";
  };
  const mode = parsed.mode ?? "default";

  const userId = randomUUID();
  const email = `e2e-${userId}@example.com`;
  await db.insert(user).values({
    id: userId,
    email,
    name: `E2E User ${userId.slice(0, 8)}`,
    emailVerified: true,
  });

  const { setCookie, name, value, expiresAt } =
    await signSessionForUser(userId);
  const baseReply = {
    userId,
    email,
    sessionCookie: setCookie,
    cookieName: name,
    cookieValue: value,
    expiresAt: expiresAt.toISOString(),
  };

  if (mode === "onboarding-empty") {
    // Fresh user, no workspace, no invite — used by the "first workspace"
    // flow E2E tests.
    return c.json(baseReply);
  }

  if (mode === "onboarding-invite") {
    // Separate owner user + workspace, then issue an invite to the fresh
    // user's email so the accept-card path can be exercised.
    const ownerId = randomUUID();
    await db.insert(user).values({
      id: ownerId,
      email: `e2e-owner-${ownerId}@example.com`,
      name: "Owner",
      emailVerified: true,
    });
    const workspaceId = randomUUID();
    const inviteWorkspaceSlug = `e2e-inv-${workspaceId.slice(0, 8)}`;
    await db.insert(workspaces).values({
      id: workspaceId,
      slug: inviteWorkspaceSlug,
      name: "Invite Target WS",
      ownerId,
      planType: "free",
    });
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: ownerId,
      role: "owner",
    });
    const inviteToken = randomBytes(32).toString("base64url");
    await db.insert(workspaceInvites).values({
      workspaceId,
      email,
      role: "member",
      token: inviteToken,
      invitedBy: ownerId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return c.json({ ...baseReply, inviteToken, inviteWorkspaceSlug });
  }

  if (mode === "canvas-phase2") {
    // Plan 7 Canvas Phase 2 — seed a workspace + project + a single canvas
    // note (sourceType='canvas', canvasLanguage='python') so Playwright tests
    // for the Code Agent / Monaco / SSE run pages have a deterministic
    // landing target. The canvas metadata pair is required by the
    // notes_canvas_language_check constraint (migration 0022).
    const workspaceId = randomUUID();
    const slug = `e2e-canvas-${workspaceId.slice(0, 8)}`;
    const projectId = randomUUID();
    const noteId = randomUUID();

    await db.insert(workspaces).values({
      id: workspaceId,
      slug,
      name: "E2E Canvas Workspace",
      ownerId: userId,
      planType: "free",
    });

    await db.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: "owner",
    });

    await db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "E2E Canvas Project",
      createdBy: userId,
      defaultRole: "editor",
    });

    await db.insert(notes).values({
      id: noteId,
      projectId,
      workspaceId,
      title: "Canvas Sample",
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "print('hello')",
      inheritParent: true,
    });

    return c.json({
      ...baseReply,
      wsSlug: slug,
      workspaceId,
      projectId,
      noteId,
    });
  }

  // default mode — existing workspace + project + Welcome note.
  const workspaceId = randomUUID();
  const slug = `e2e-ws-${workspaceId.slice(0, 8)}`;
  const projectId = randomUUID();
  const noteId = randomUUID();

  await db.insert(workspaces).values({
    id: workspaceId,
    slug,
    name: "E2E Workspace",
    ownerId: userId,
    planType: "free",
  });

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: "owner",
  });

  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    name: "E2E Project",
    createdBy: userId,
    defaultRole: "editor",
  });

  // One pre-seeded "Welcome" note — downstream E2E tests (Task 16 wiki-link
  // combobox) depend on having at least one searchable title in the project.
  await db.insert(notes).values({
    id: noteId,
    projectId,
    workspaceId,
    title: "Welcome",
    inheritParent: true,
  });

  return c.json({
    ...baseReply,
    wsSlug: slug,
    workspaceId,
    projectId,
    noteId,
  });
});

// ---------------------------------------------------------------------------
// App Shell Phase 2 — bulk seed for the 5k-node perf fixture
// ---------------------------------------------------------------------------

// POST /internal/test-seed-bulk — inflate an existing project with N folders
// and M notes so `tests/e2e/fixtures/seed-5k-nodes.ts` can stress the sidebar
// tree virtualisation. Folders are laid out across `maxDepth` levels, each
// row getting a random parent from the preceding level; notes pick a random
// folder (or the project root ~10% of the time). Caller supplies the
// projectId; we derive workspaceId from it so the seed never crosses a
// workspace boundary by accident. Same double-gate as /test-seed: the
// internal-secret middleware above + a NODE_ENV=production refusal.
const testSeedBulkSchema = z.object({
  projectId: z.string().uuid(),
  folders: z.number().int().min(0).max(5000).default(500),
  notes: z.number().int().min(0).max(20000).default(4500),
  maxDepth: z.number().int().min(1).max(8).default(3),
});

internal.post(
  "/test-seed-bulk",
  // Prod refusal runs BEFORE the Zod validator so a malformed payload in
  // production returns the same 403 as a well-formed one — otherwise a 400
  // from the schema leaks the endpoint's existence to an attacker who only
  // has the internal secret. The Zod guard is still useful in non-prod.
  async (c, next) => {
    if (process.env.NODE_ENV === "production") {
      return c.json({ error: "test-seed-bulk disabled in production" }, 403);
    }
    return next();
  },
  zValidator("json", testSeedBulkSchema),
  async (c) => {
    const body = c.req.valid("json");

    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);

    // Distribute folders across `maxDepth` levels as evenly as possible. The
    // final depth is `maxDepth - 1` (roots are depth 0), so a maxDepth of 3
    // yields three levels; with 500 folders that's ~167 per level.
    const perDepth: number[] = new Array(body.maxDepth).fill(0);
    for (let i = 0; i < body.folders; i += 1) {
      perDepth[i % body.maxDepth] += 1;
    }

    type Built = {
      id: string;
      parentId: string | null;
      path: string;
      depth: number;
    };
    const built: Built[] = [];
    for (let depth = 0; depth < body.maxDepth; depth += 1) {
      const parents =
        depth === 0 ? [] : built.filter((b) => b.depth === depth - 1);
      // If an upstream level ended up empty (possible when perDepth[depth-1]
      // rounded to 0), fall back to the closest non-empty ancestor so the
      // generator degrades gracefully rather than dropping child folders.
      const fallbackParents =
        depth === 0 || parents.length > 0
          ? parents
          : built.filter((b) => b.depth < depth);
      for (let i = 0; i < perDepth[depth]; i += 1) {
        const id = randomUUID();
        if (depth === 0) {
          built.push({ id, parentId: null, path: labelFromId(id), depth });
          continue;
        }
        const pool = fallbackParents;
        const parent = pool[Math.floor(Math.random() * pool.length)];
        built.push({
          id,
          parentId: parent.id,
          path: `${parent.path}.${labelFromId(id)}`,
          depth,
        });
      }
    }

    // Insert folders depth-by-depth so each level's rows can safely reference
    // parents inserted in the previous level. Within a level we still batch
    // in chunks to keep the INSERT statement size bounded.
    const CHUNK = 500;
    for (let depth = 0; depth < body.maxDepth; depth += 1) {
      const atDepth = built.filter((b) => b.depth === depth);
      for (let i = 0; i < atDepth.length; i += CHUNK) {
        const slice = atDepth.slice(i, i + CHUNK);
        await db.insert(folders).values(
          slice.map((b, idx) => ({
            id: b.id,
            projectId: body.projectId,
            parentId: b.parentId,
            name: `perf-folder-${depth}-${i + idx}`,
            position: i + idx,
            path: b.path,
          })),
        );
      }
    }

    const folderIds = built.map((b) => b.id);

    // Notes: random folder parent so virtualisation has to paint across many
    // expanded subtrees. ~10% land at the project root to exercise the
    // top-level leaf path too.
    const noteIds: string[] = [];
    const noteRows: Array<{
      id: string;
      projectId: string;
      workspaceId: string;
      folderId: string | null;
      title: string;
      inheritParent: boolean;
    }> = [];
    for (let i = 0; i < body.notes; i += 1) {
      const id = randomUUID();
      noteIds.push(id);
      const useRoot = built.length === 0 || Math.random() < 0.1;
      const folderId = useRoot
        ? null
        : built[Math.floor(Math.random() * built.length)].id;
      noteRows.push({
        id,
        projectId: body.projectId,
        workspaceId: proj.workspaceId,
        folderId,
        title: `perf-note-${i}`,
        inheritParent: true,
      });
    }
    for (let i = 0; i < noteRows.length; i += CHUNK) {
      await db.insert(notes).values(noteRows.slice(i, i + CHUNK));
    }

    return c.json({ folderIds, noteIds }, 201);
  },
);

// ---------------------------------------------------------------------------
// Plan 2B Task 20 — multi-role E2E test seed
// ---------------------------------------------------------------------------

// POST /internal/test-seed-multi-role — create one workspace with four roles
// (owner/editor/commenter/viewer) + shared note + private note + sibling
// workspace, then mint a signed session cookie for EACH role user so the
// Playwright collab E2E can assign one cookie per browser context.
//
// Same double gate as `/test-seed`: the internal middleware already enforces
// the shared-secret header; we additionally refuse in production so a leaked
// secret still can't mint four sessions at once on prod.
internal.post("/test-seed-multi-role", async (c) => {
  if (process.env.NODE_ENV === "production") {
    return c.json(
      { error: "test-seed-multi-role disabled in production" },
      403,
    );
  }

  const seed = await createMultiRoleSeed();

  // Sign one session per role user. `signSessionForUser` inserts a real
  // `session` row so Better Auth's getSession() resolves against DB state
  // rather than a bypass — behaviour matches /test-seed.
  const [ownerSess, editorSess, commenterSess, viewerSess] = await Promise.all(
    [
      signSessionForUser(seed.ownerUserId),
      signSessionForUser(seed.editorUserId),
      signSessionForUser(seed.commenterUserId),
      signSessionForUser(seed.viewerUserId),
    ],
  );

  const toCookiePayload = (
    userId: string,
    s: Awaited<ReturnType<typeof signSessionForUser>>,
  ) => ({
    userId,
    sessionCookie: s.setCookie,
    cookieName: s.name,
    cookieValue: s.value,
    expiresAt: s.expiresAt.toISOString(),
  });

  return c.json({
    workspaceId: seed.workspaceId,
    wsSlug: seed.wsSlug,
    projectId: seed.projectId,
    noteId: seed.noteId,
    privateNoteId: seed.privateNoteId,
    otherWorkspaceId: seed.otherWorkspaceId,
    owner: toCookiePayload(seed.ownerUserId, ownerSess),
    editor: toCookiePayload(seed.editorUserId, editorSess),
    commenter: toCookiePayload(seed.commenterUserId, commenterSess),
    viewer: toCookiePayload(seed.viewerUserId, viewerSess),
  });
});

// POST /internal/research/runs/:id/artifacts — streamed artifact write. The
// worker's execute_deep_research activity calls this once per Google
// Interactions stream event (thought/text/citation/image) so the row lands
// in `research_run_artifacts` immediately and the UI / persist_report can
// replay it later. `seq` is auto-assigned inside a transaction holding a
// row-level lock on the parent run, so a Temporal activity retry that
// re-streams events while a previous attempt is still in flight cannot
// produce two inserts at the same seq (the (run_id, seq) unique index would
// reject the second one and 500 the caller; the lock keeps each insert
// monotonic instead).
//
// Audit S4-008 (2026-04-28): this endpoint was promised by the Phase C
// comment in execute_research.py but never implemented; the worker side
// also pointed at `/internal/...` instead of `/api/internal/...`. Both paths
// are repaired here + in the worker call sites.
//
// Payload shapes are documented at `packages/db/src/schema/research.ts:123`
// and enforced here via a discriminated union so a buggy worker can't poison
// downstream lookups (e.g. the image-bytes endpoint matches on
// `payload->>'url'`, which would silently 404 if `image` payloads omitted
// the field).
const researchArtifactWriteSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thought_summary"),
    payload: z.object({ text: z.string().min(1).max(20000) }),
  }),
  z.object({
    kind: z.literal("text_delta"),
    payload: z.object({ text: z.string().max(20000) }),
  }),
  z.object({
    kind: z.literal("image"),
    payload: z.object({
      url: z.string().min(1).max(4096),
      mimeType: z.string().min(1).max(128),
      base64: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal("citation"),
    payload: z.object({
      sourceUrl: z.string().min(1).max(4096),
      title: z.string().max(2000),
    }),
  }),
]);

internal.post(
  "/research/runs/:id/artifacts",
  zValidator("json", researchArtifactWriteSchema),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "invalid uuid" }, 400);
    const body = c.req.valid("json");

    // Wrap the MAX(seq) read + INSERT in a transaction with FOR UPDATE on
    // the parent run row. Without the lock a Temporal activity retry that
    // overlaps the previous attempt could read stale MAX and insert at a
    // duplicate seq, hitting the (run_id, seq) unique index.
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(eq(researchRuns.id, id))
        .for("update");
      if (!run) return { found: false as const };

      const [seqRow] = await tx
        .select({
          maxSeq: sql<number | null>`MAX(${researchRunArtifacts.seq})`,
        })
        .from(researchRunArtifacts)
        .where(eq(researchRunArtifacts.runId, id));
      // node-postgres returns aggregate results as strings by default; an
      // un-cast `"5" + 1` would concatenate to `"51"` and explode the seq
      // space. Mirror the `Number()` pattern used for `count()` on line 998.
      const nextSeq = Number(seqRow?.maxSeq ?? -1) + 1;

      const [inserted] = await tx
        .insert(researchRunArtifacts)
        .values({
          runId: id,
          seq: nextSeq,
          kind: body.kind,
          payload: body.payload as Record<string, unknown>,
        })
        .returning({
          id: researchRunArtifacts.id,
          seq: researchRunArtifacts.seq,
        });
      return { found: true as const, inserted };
    });

    if (!result.found) return c.json({ error: "research_run_not_found" }, 404);
    return c.json(
      { id: result.inserted.id, seq: result.inserted.seq },
      201,
    );
  },
);

// POST /internal/research/image-bytes — replay image bytes captured during
// execute_deep_research. Matches against researchRunArtifacts.payload->>'url'.
// The worker's persist_report reads this back, uploads to MinIO, and only
// then materialises the final Plate block. Kept small: the worker already
// knows runId via its own workflow context, so we only need the URL here.
const researchImageBytesSchema = z.object({
  url: z.string().url().max(4096),
});

internal.post(
  "/research/image-bytes",
  zValidator("json", researchImageBytesSchema),
  async (c) => {
    const { url } = c.req.valid("json");
    const [row] = await db
      .select({ payload: researchRunArtifacts.payload })
      .from(researchRunArtifacts)
      .where(
        and(
          eq(researchRunArtifacts.kind, "image"),
          sql`${researchRunArtifacts.payload}->>'url' = ${url}`,
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);

    const payload = row.payload as {
      url?: string;
      mimeType?: string;
      base64?: string;
    };
    if (!payload.base64 || !payload.mimeType) {
      return c.json({ error: "artifact_missing_bytes" }, 404);
    }
    return c.json({ base64: payload.base64, mimeType: payload.mimeType }, 200);
  },
);

// ---------------------------------------------------------------------------
// Plan 2C Task 6 — Deep Research finalize callback
// ---------------------------------------------------------------------------
//
// The Temporal worker calls this when a Deep Research workflow reaches a
// terminal state (completed / failed / cancelled). Idempotency is enforced
// via SELECT ... FOR UPDATE inside a transaction: we capture
// `previouslyCompleted` BEFORE the UPDATE so a Temporal retry
// (RetryPolicy(maximum_attempts=5)) can land twice without double-firing
// the `research_complete` notification.
//
// Notification rules:
//   - completed (first transition only) → fire research_complete to userId
//   - completed (subsequent retries)    → no notification, alreadyFinalized:true
//   - failed / cancelled                → no notification (UI surfaces error
//                                          via the run row's status + error)
const finalizeResearchSchema = z.object({
  status: z.enum(["completed", "failed", "cancelled"]),
  // Set when the worker has materialised the report into a Plate note.
  // Optional because failed/cancelled never produce one.
  noteId: z.string().uuid().optional(),
  // Stored into researchRuns.error JSON only when status === "failed".
  errorCode: z.string().max(200).optional(),
  errorMessage: z.string().max(2000).optional(),
});

internal.patch(
  "/research/runs/:id/finalize",
  zValidator("json", finalizeResearchSchema),
  async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "invalid uuid" }, 400);
    const body = c.req.valid("json");

    const result = await db.transaction(async (tx) => {
      // FOR UPDATE locks the row for the rest of the tx so a parallel
      // worker retry can't read the same pre-completion state and both
      // believe they're the first to finalise.
      const [existing] = await tx
        .select({
          completedAt: researchRuns.completedAt,
          userId: researchRuns.userId,
          topic: researchRuns.topic,
          projectId: researchRuns.projectId,
        })
        .from(researchRuns)
        .where(eq(researchRuns.id, id))
        .for("update");
      if (!existing) return { found: false as const };

      // Capture BEFORE the UPDATE — this is the idempotency key. If
      // completedAt was already non-null we MUST NOT notify again.
      const previouslyCompleted = existing.completedAt !== null;
      const patch: Record<string, unknown> = {
        status: body.status,
        // Only stamp completedAt on a successful completion. failed/cancelled
        // are terminal but they MUST NOT poison the idempotency key — a
        // failed-then-recovered run (e.g. workflow restart, manual replay)
        // still needs to fire the research_complete notification on the
        // first transition into "completed".
        completedAt:
          existing.completedAt ??
          (body.status === "completed" ? new Date() : null),
      };
      if (body.status === "failed") {
        patch.error = {
          code: body.errorCode ?? "unknown",
          message: body.errorMessage ?? "",
          retryable: false,
        };
      }
      await tx
        .update(researchRuns)
        .set(patch)
        .where(eq(researchRuns.id, id));

      return {
        found: true as const,
        previouslyCompleted,
        userId: existing.userId,
        topic: existing.topic,
        projectId: existing.projectId,
      };
    });

    if (!result.found) return c.json({ error: "not_found" }, 404);

    // Fire AFTER the tx commits so a rolled-back finalise can't surface a
    // phantom drawer entry. Same convention as the comments / share routes
    // (Plan 2C Tasks 4–5). Swallow notification errors — the run's terminal
    // state is the source of truth; a missed drawer ping is recoverable on
    // the next refresh and must not 500 the worker callback.
    if (body.status === "completed" && !result.previouslyCompleted) {
      await persistAndPublish({
        userId: result.userId,
        kind: "research_complete",
        payload: {
          summary: `"${result.topic}" 리서치가 완료되었습니다`,
          runId: id,
          noteId: body.noteId,
          projectId: result.projectId,
          topic: result.topic,
        },
      }).catch(() => undefined);
    }

    return c.json({ ok: true, alreadyFinalized: result.previouslyCompleted });
  },
);

// ---------------------------------------------------------------------------
// Plan 7 Canvas Phase 2 — Code Agent worker callbacks
// ---------------------------------------------------------------------------
//
// Worker (apps/worker/src/worker/lib/code_persistence.py) calls these two
// endpoints to persist turn rows + flip the `code_runs.status` column. Both
// are gated by the shared-secret middleware above; FEATURE_CODE_AGENT itself
// is enforced at the worker registration layer + the public /api/code router,
// not here — so a callback retry from a workflow that started before the flag
// flipped off can still drain.

const codeTurnInsertSchema = z.object({
  runId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  // Mirror the Plan 7 spec literals on `kind` so a typo in the worker can't
  // silently land a junk value the SSE event-encoder will then refuse.
  kind: z.enum(["generate", "fix"]),
  source: z.string().max(64 * 1024),
  explanation: z.string().max(4 * 1024).nullable().optional(),
  prevError: z.string().max(8 * 1024).nullable().optional(),
});

internal.post(
  "/code/turns",
  zValidator("json", codeTurnInsertSchema),
  async (c) => {
    const body = c.req.valid("json");
    // (run_id, seq) is uniquely indexed (code_turns_run_seq_unique). Use
    // ON CONFLICT DO NOTHING so a Temporal activity retry that re-emits the
    // same seq is a no-op rather than a 500 the workflow has to handle.
    await db
      .insert(codeTurns)
      .values({
        runId: body.runId,
        seq: body.seq,
        kind: body.kind,
        source: body.source,
        explanation: body.explanation ?? null,
        prevError: body.prevError ?? null,
      })
      .onConflictDoNothing();
    return c.json({ ok: true });
  },
);

const codeRunStatusPatchSchema = z.object({
  // Allow the full set the workflow can transition through. Schema validation
  // protects against a stray status string the SSE consumer doesn't know how
  // to render.
  status: z.enum([
    "pending",
    "running",
    "awaiting_feedback",
    "completed",
    "max_turns",
    "cancelled",
    "abandoned",
    "failed",
  ]),
});

internal.patch(
  "/code/runs/:id/status",
  zValidator("json", codeRunStatusPatchSchema),
  async (c) => {
    const id = c.req.param("id");
    // Use the shared isUuid helper rather than a one-off Zod parse — keeps
    // the UUID acceptance set identical across every internal write route.
    if (!isUuid(id)) {
      return c.json({ error: "invalid uuid" }, 400);
    }
    const { status } = c.req.valid("json");
    // updatedAt is bumped by Drizzle's $onUpdate on codeRuns, so we don't set
    // it explicitly — same pattern the embedding-batches PATCH uses above.
    const [updated] = await db
      .update(codeRuns)
      .set({ status })
      .where(eq(codeRuns.id, id))
      .returning({ id: codeRuns.id });
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Generic notification publish — let activities (e.g. ImportWorkflow's
// finalize_import_job) emit drawer + SSE notifications without re-implementing
// the persist + fan-out plumbing. Each kind's payload contract is documented
// in apps/api/src/lib/notification-events.ts. We require a non-empty
// `payload.summary` since the drawer's NotificationItem treats it as the
// universal fallback when a renderer doesn't have a structured summary
// template (every kind ships at least the fallback string from the producer).
// ---------------------------------------------------------------------------

const internalNotificationPayloadSchema = z
  .record(z.unknown())
  .refine(
    (p) => {
      const summary = (p as Record<string, unknown>).summary;
      return typeof summary === "string" && summary.length > 0
        && summary.length <= 2000;
    },
    { message: "payload.summary must be a 1..2000 char string" },
  );

const internalNotificationSchema = z.object({
  userId: z.string().uuid(),
  kind: z.enum([
    "mention",
    "comment_reply",
    "research_complete",
    "share_invite",
    "system",
  ]),
  payload: internalNotificationPayloadSchema,
});

internal.post(
  "/notifications",
  zValidator("json", internalNotificationSchema, (result, c) => {
    // Surface zod's first issue as a flat error string so the worker (which
    // only inspects `error`) can log a useful diagnostic.
    if (!result.success) {
      const first = result.error.issues[0];
      const path = first.path.join(".") || "(root)";
      return c.json({ error: `${path}: ${first.message}` }, 400);
    }
  }),
  async (c) => {
    const body = c.req.valid("json");
    const event = await persistAndPublish({
      userId: body.userId,
      kind: body.kind,
      payload: body.payload as Record<string, unknown>,
    });
    return c.json({ id: event.id }, 201);
  },
);

// ---------------------------------------------------------------------------
// Plan 8 — Curator / Connector suggestions
// ---------------------------------------------------------------------------
// Agents (Curator, Connector) call this endpoint to persist quality
// suggestions that the user can review and act on in the UI.
// ---------------------------------------------------------------------------

const internalSuggestionCreateSchema = z.object({
  userId: z.string().min(1),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.enum([
    "connector_link",
    "curator_orphan",
    "curator_duplicate",
    "curator_contradiction",
    "curator_external_source",
    "synthesis_insight",
  ]),
  payload: z.record(z.unknown()),
});

internal.post(
  "/suggestions",
  zValidator("json", internalSuggestionCreateSchema),
  async (c) => {
    const { userId, workspaceId, projectId, type, payload } =
      c.req.valid("json");
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!proj) return c.json({ error: "not-found" }, 404);
    if (proj.workspaceId !== workspaceId)
      return c.json({ error: "workspace_mismatch" }, 403);
    const [row] = await db
      .insert(suggestions)
      .values({ userId, projectId, type, payload, status: "pending" })
      .returning({ id: suggestions.id });
    return c.json({ id: row.id }, 201);
  },
);

// ---------------------------------------------------------------------------
// Plan 8 — Staleness Agent support
// ---------------------------------------------------------------------------

// GET /internal/projects/:id/stale-notes?days=90&limit=20
// Returns wiki notes not updated in the last N days for the Staleness agent.
internal.get("/projects/:id/stale-notes", async (c) => {
  const projectId = c.req.param("id");
  if (!z.string().uuid().safeParse(projectId).success) {
    return c.json({ error: "Invalid project id" }, 400);
  }
  const daysRaw = c.req.query("days");
  const limitRaw = c.req.query("limit");
  const days = Math.max(1, Math.min(365, parseInt(daysRaw ?? "90", 10) || 90));
  const limit = Math.max(1, Math.min(100, parseInt(limitRaw ?? "20", 10) || 20));

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      contentText: notes.contentText,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.projectId, projectId),
        eq(notes.type, "wiki"),
        isNull(notes.deletedAt),
        sql`${notes.updatedAt} < now() - make_interval(days => ${days})`,
      ),
    )
    .limit(limit);

  return c.json({ notes: rows });
});

// POST /internal/stale-alerts — persist a staleness alert row.
const staleAlertCreateSchema = z.object({
  noteId: z.string().uuid(),
  stalenessScore: z.number().min(0).max(1),
  reason: z.string().max(500),
});

internal.post(
  "/stale-alerts",
  zValidator("json", staleAlertCreateSchema),
  async (c) => {
    const { noteId, stalenessScore, reason } = c.req.valid("json");
    const [row] = await db
      .insert(staleAlerts)
      .values({ noteId, stalenessScore, reason })
      .returning({ id: staleAlerts.id });
    return c.json({ id: row.id }, 201);
  },
);

// POST /internal/audio-files — persist an audio_files record produced by the
// Narrator agent after uploading audio to MinIO/R2.
const audioFileCreateSchema = z.object({
  noteId: z.string().uuid().nullable().optional(),
  r2Key: z.string().min(1).max(500),
  durationSec: z.number().int().positive().optional(),
  voices: z
    .array(z.object({ name: z.string(), style: z.string().optional() }))
    .optional(),
});

internal.post(
  "/audio-files",
  zValidator("json", audioFileCreateSchema),
  async (c) => {
    const { noteId, r2Key, durationSec, voices } = c.req.valid("json");
    const [row] = await db
      .insert(audioFiles)
      .values({
        noteId: noteId ?? null,
        r2Key,
        durationSec: durationSec ?? null,
        voices: voices ?? null,
      })
      .returning({ id: audioFiles.id });
    return c.json({ id: row.id }, 201);
  },
);

// ---------------------------------------------------------------------------
// Spec B — Content-Aware Enrichment artifact
// ---------------------------------------------------------------------------

const enrichmentStoreSchema = z.object({
  workspaceId: z.string().uuid(),
  contentType: z.string().min(1),
  status: z.enum(["pending", "processing", "done", "failed"]).default("done"),
  artifact: z.record(z.unknown()).optional(),
  provider: z.string().optional(),
  skipReasons: z.array(z.string()).optional(),
  error: z.string().optional(),
});

internal.post(
  "/notes/:noteId/enrichment",
  zValidator("json", enrichmentStoreSchema),
  async (c) => {
    const noteId = c.req.param("noteId");
    if (!isUuid(noteId)) return c.json({ error: "invalid_note_id" }, 400);

    const body = c.req.valid("json");

    // Defence-in-depth: confirm the note actually lives in the claimed
    // workspace before storing. Workers run with the shared internal
    // secret, so a misrouted message could otherwise plant artifacts in
    // the wrong workspace.
    const [noteRow] = await db
      .select({ workspaceId: notes.workspaceId })
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1);
    if (!noteRow) return c.json({ error: "note_not_found" }, 404);
    if (noteRow.workspaceId !== body.workspaceId) {
      return c.json({ error: "workspace_mismatch" }, 400);
    }

    await db
      .insert(noteEnrichments)
      .values({
        noteId,
        workspaceId: body.workspaceId,
        contentType: body.contentType,
        status: body.status,
        artifact: body.artifact ?? null,
        provider: body.provider ?? null,
        skipReasons: body.skipReasons ?? [],
        error: body.error ?? null,
      })
      .onConflictDoUpdate({
        target: noteEnrichments.noteId,
        set: {
          contentType: body.contentType,
          status: body.status,
          artifact: body.artifact ?? null,
          provider: body.provider ?? null,
          skipReasons: body.skipReasons ?? [],
          error: body.error ?? null,
          updatedAt: new Date(),
        },
      });

    return c.json({ ok: true }, 201);
  },
);

internal.get("/notes/:noteId/enrichment", async (c) => {
  const noteId = c.req.param("noteId");
  if (!isUuid(noteId)) return c.json({ error: "invalid_note_id" }, 400);

  // Defence-in-depth — caller must declare the workspace it expects, so
  // a buggy worker passing a stale note_id can't accidentally read out
  // an artifact belonging to another workspace.
  const expectedWs = c.req.query("workspaceId");
  if (!expectedWs || !isUuid(expectedWs)) {
    return c.json({ error: "workspaceId query required" }, 400);
  }

  const [row] = await db
    .select()
    .from(noteEnrichments)
    .where(eq(noteEnrichments.noteId, noteId))
    .limit(1);

  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.workspaceId !== expectedWs) {
    return c.json({ error: "workspace_mismatch" }, 400);
  }
  return c.json(row);
});

export const internalRoutes = internal;
