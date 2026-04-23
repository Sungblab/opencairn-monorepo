import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import {
  db,
  user,
  workspaces,
  workspaceMembers,
  workspaceInvites,
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
  eq,
  and,
  sql,
  lt,
  count,
} from "@opencairn/db";
import { getTemporalClient } from "../lib/temporal-client";
import { signSessionForUser } from "../lib/test-session";
import { createMultiRoleSeed } from "../lib/test-seed-multi";
import { plateValueToText } from "../lib/plate-text";
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

type HybridHit = {
  noteId: string;
  title: string;
  snippet: string;
  sourceType: string | null;
  sourceUrl: string | null;
  vectorScore: number | null;
  bm25Score: number | null;
  rrfScore: number;
};

const RRF_K = 60;
const SNIPPET_MAX = 400;

function clipSnippet(text: string | null): string {
  if (!text) return "";
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > SNIPPET_MAX
    ? compact.slice(0, SNIPPET_MAX) + "…"
    : compact;
}

internal.post(
  "/notes/hybrid-search",
  zValidator("json", hybridSearchSchema),
  async (c) => {
    const body = c.req.valid("json");
    const vec = vectorLiteral(body.queryEmbedding);
    const fetchLimit = body.k * 2;

    // Vector channel — cosine distance (<=>). We cap to notes with an
    // embedding to avoid returning rows that haven't been embedded yet
    // (e.g. a note created before Plan 13 or pending backfill).
    const vectorRowsRaw = await db.execute(sql`
      SELECT
        id,
        title,
        content_text,
        source_type,
        source_url,
        1 - (embedding <=> ${vec}::vector) AS score
      FROM notes
      WHERE project_id = ${body.projectId}
        AND deleted_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vec}::vector ASC
      LIMIT ${fetchLimit}
    `);
    const vectorRows =
      (vectorRowsRaw as unknown as { rows: Array<Record<string, unknown>> })
        .rows ?? (vectorRowsRaw as unknown as Array<Record<string, unknown>>);

    // BM25 channel — tsvector ranking with plainto_tsquery (safe against
    // punctuation, avoids injection). We use the `simple` config to stay
    // multilingual (matches migration 0006). Rows without a usable tsv
    // match are filtered by `@@`.
    const bm25RowsRaw = await db.execute(sql`
      SELECT
        id,
        title,
        content_text,
        source_type,
        source_url,
        ts_rank(content_tsv, plainto_tsquery('simple', ${body.queryText})) AS score
      FROM notes
      WHERE project_id = ${body.projectId}
        AND deleted_at IS NULL
        AND content_tsv @@ plainto_tsquery('simple', ${body.queryText})
      ORDER BY score DESC
      LIMIT ${fetchLimit}
    `);
    const bm25Rows =
      (bm25RowsRaw as unknown as { rows: Array<Record<string, unknown>> })
        .rows ?? (bm25RowsRaw as unknown as Array<Record<string, unknown>>);

    const hits = new Map<string, HybridHit>();
    const rrf = new Map<string, number>();

    const addRow = (
      row: Record<string, unknown>,
      rank: number,
      channel: "vector" | "bm25",
    ) => {
      const noteId = String(row.id);
      const existing = hits.get(noteId);
      const rawScore = Number(row.score ?? 0);
      if (!existing) {
        hits.set(noteId, {
          noteId,
          title: String(row.title ?? "Untitled"),
          snippet: clipSnippet(row.content_text as string | null),
          sourceType: (row.source_type as string | null) ?? null,
          sourceUrl: (row.source_url as string | null) ?? null,
          vectorScore: channel === "vector" ? rawScore : null,
          bm25Score: channel === "bm25" ? rawScore : null,
          rrfScore: 0,
        });
      } else if (channel === "vector") {
        existing.vectorScore = rawScore;
      } else {
        existing.bm25Score = rawScore;
      }
      rrf.set(noteId, (rrf.get(noteId) ?? 0) + 1 / (RRF_K + rank));
    };

    vectorRows.forEach((r, i) => addRow(r, i + 1, "vector"));
    bm25Rows.forEach((r, i) => addRow(r, i + 1, "bm25"));

    for (const [noteId, score] of rrf.entries()) {
      const hit = hits.get(noteId);
      if (hit) hit.rrfScore = score;
    }

    const merged = Array.from(hits.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, body.k);

    return c.json({ results: merged });
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

    // Perform the reparent + delete atomically: a concurrent Compiler
    // run on the same project could otherwise link a dying concept and
    // leak a dangling row. node-postgres doesn't expose a top-level
    // transaction helper in the drizzle binding we use — a single raw
    // SQL BEGIN/COMMIT block is simpler than plumbing a separate client.
    const dupArray = sql.raw(
      `ARRAY[${body.duplicateIds.map((d) => `'${d}'::uuid`).join(",")}]`,
    );
    await db.execute(sql`
      BEGIN;
      UPDATE concept_edges SET source_id = ${body.primaryId}
        WHERE source_id = ANY(${dupArray});
      UPDATE concept_edges SET target_id = ${body.primaryId}
        WHERE target_id = ANY(${dupArray});
      -- An edge from primary to itself is meaningless; delete the self-loops
      -- that the reparent above may have just created.
      DELETE FROM concept_edges WHERE source_id = target_id;
      INSERT INTO concept_notes (concept_id, note_id)
        SELECT ${body.primaryId}, note_id FROM concept_notes
        WHERE concept_id = ANY(${dupArray})
        ON CONFLICT DO NOTHING;
      DELETE FROM concept_notes WHERE concept_id = ANY(${dupArray});
      DELETE FROM concepts WHERE id = ANY(${dupArray});
      COMMIT;
    `);

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
  await db.execute(sql`
    UPDATE notes
    SET content_tsv = to_tsvector('simple',
      coalesce(title, '') || ' ' || coalesce(content_text, ''))
    WHERE id = ${id}
  `);
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + body.ttlSeconds * 1000);

    // 1. Sweep expired slots first so capacity reflects reality.
    await db
      .delete(projectSemaphoreSlots)
      .where(
        and(
          eq(projectSemaphoreSlots.projectId, body.projectId),
          lt(projectSemaphoreSlots.expiresAt, now),
        ),
      );

    // 2. Idempotent renewal — if this holder already owns a slot, extend
    // the deadline and report success. Covers the common case of an
    // activity retry after a transient crash between acquire and the
    // workflow body starting.
    const [existing] = await db
      .select({ id: projectSemaphoreSlots.id })
      .from(projectSemaphoreSlots)
      .where(
        and(
          eq(projectSemaphoreSlots.projectId, body.projectId),
          eq(projectSemaphoreSlots.holderId, body.holderId),
        ),
      );
    if (existing) {
      await db
        .update(projectSemaphoreSlots)
        .set({ expiresAt })
        .where(eq(projectSemaphoreSlots.id, existing.id));
      return c.json({ acquired: true, renewed: true });
    }

    // 3. Count active slots and conditionally insert. We do this in two
    // statements — a single `INSERT ... SELECT WHERE count < N` would be
    // atomic but harder to read; since the common case is no contention
    // and we re-check on the next poll, a rare over-commit is acceptable.
    const [runningRow] = await db
      .select({ n: count() })
      .from(projectSemaphoreSlots)
      .where(eq(projectSemaphoreSlots.projectId, body.projectId));
    const running = Number(runningRow?.n ?? 0);
    if (running >= body.maxConcurrent) {
      return c.json({ acquired: false, running });
    }

    try {
      await db.insert(projectSemaphoreSlots).values({
        projectId: body.projectId,
        holderId: body.holderId,
        purpose: body.purpose,
        expiresAt,
      });
    } catch {
      // Unique index race — another request beat us with the same
      // (projectId, holderId). Treat as "we already have it".
      return c.json({ acquired: true, renewed: true });
    }

    return c.json({ acquired: true, renewed: false });
  },
);

// POST /internal/semaphores/release — drop a holder's slot. Safe to call
// twice (no-op if already released).
const semaphoreReleaseSchema = z.object({
  projectId: z.string().uuid(),
  holderId: z.string().min(1).max(200),
});

internal.post(
  "/semaphores/release",
  zValidator("json", semaphoreReleaseSchema),
  async (c) => {
    const body = c.req.valid("json");
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
      .enum(["pdf", "audio", "video", "image", "youtube", "web", "unknown", "notion"])
      .nullable()
      .optional(),
    content: z.unknown().nullable().optional(),
    contentText: z.string().nullable().optional(),
    importJobId: z.string().uuid().optional(),
    importPath: z.string().max(1024).optional(),
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
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (body.idempotencyKey && UUID_RE.test(body.idempotencyKey)) {
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
    });

    // Back-fill researchRuns.noteId so a retry of this call hits the
    // idempotency branch above. UUID guard mirrors the read path above —
    // the column is uuid type, so non-UUID keys must be skipped.
    if (body.idempotencyKey && UUID_RE.test(body.idempotencyKey)) {
      await db
        .update(researchRuns)
        .set({ noteId: id, updatedAt: new Date() })
        .where(eq(researchRuns.id, body.idempotencyKey));
    }

    return c.json({ id, noteId: id }, 201);
  },
);

// PATCH /internal/notes/:id — worker backfills content after the Markdown
// converter (Task 8) finishes. Narrow allowlist so the same endpoint can't
// be (ab)used to rewrite arbitrary columns like workspace_id.
const internalNotePatchSchema = z.object({
  content: z.unknown().optional(),
  contentText: z.string().optional(),
  title: z.string().min(1).max(512).optional(),
  sourceType: z
    .enum(["pdf", "audio", "video", "image", "youtube", "web", "unknown", "notion"])
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
    const [updated] = await db
      .update(notes)
      .set(patch)
      .where(eq(notes.id, id))
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
    mode?: "default" | "onboarding-empty" | "onboarding-invite";
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

export const internalRoutes = internal;
