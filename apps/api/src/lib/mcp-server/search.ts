import {
  and,
  db as defaultDb,
  desc,
  eq,
  isNull,
  notes,
  projects,
  sql,
  type DB,
} from "@opencairn/db";
import type {
  McpGetNoteResult,
  McpListProjectsResult,
  McpSearchNoteHit,
  McpSearchNotesResult,
} from "@opencairn/shared";

import { getChatProvider } from "../llm";
import { LLMNotConfiguredError } from "../llm/provider";

const RRF_K = 60;
const SNIPPET_MAX = 400;
const NOTE_CONTENT_MAX = 20000;

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function rows<T>(raw: unknown): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as T[];
  return ((raw as { rows?: T[] }).rows ?? []) as T[];
}

function clip(text: string | null | undefined, max: number, compact = true): string {
  if (!text) return "";
  const processed = compact ? text.replace(/\s+/g, " ").trim() : text;
  return processed.length > max ? `${processed.slice(0, max)}...` : processed;
}

async function embedQuery(query: string): Promise<number[] | null> {
  try {
    return await getChatProvider().embed(query);
  } catch (error) {
    if (error instanceof LLMNotConfiguredError) return null;
    return null;
  }
}

async function projectBelongsToWorkspace(
  conn: DB,
  workspaceId: string,
  projectId: string,
): Promise<boolean> {
  const [row] = await conn
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(row);
}

export async function searchMcpNotes(opts: {
  workspaceId: string;
  query: string;
  limit?: number;
  projectId?: string;
  db?: DB;
}): Promise<McpSearchNotesResult> {
  const conn = opts.db ?? defaultDb;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  if (opts.projectId && !(await projectBelongsToWorkspace(conn, opts.workspaceId, opts.projectId))) {
    return { hits: [] };
  }

  const fetchLimit = limit * 2;
  const queryEmbedding = await embedQuery(opts.query);
  const workspaceFilter = opts.projectId
    ? sql`n.workspace_id = ${opts.workspaceId} AND n.project_id = ${opts.projectId}`
    : sql`n.workspace_id = ${opts.workspaceId}`;

  const vectorRowsPromise = queryEmbedding
    ? conn.execute(sql`
        SELECT
          n.id,
          n.title,
          n.project_id,
          p.name AS project_name,
          n.content_text,
          n.source_type,
          n.source_url,
          n.updated_at,
          1 - (n.embedding <=> ${vectorLiteral(queryEmbedding)}::vector) AS score
        FROM notes n
        JOIN projects p ON p.id = n.project_id
        WHERE ${workspaceFilter}
          AND n.deleted_at IS NULL
          AND n.embedding IS NOT NULL
        ORDER BY n.embedding <=> ${vectorLiteral(queryEmbedding)}::vector ASC
        LIMIT ${fetchLimit}
      `)
    : Promise.resolve([]);

  const bm25RowsPromise = conn.execute(sql`
    SELECT
      n.id,
      n.title,
      n.project_id,
      p.name AS project_name,
      n.content_text,
      n.source_type,
      n.source_url,
      n.updated_at,
      ts_rank(n.content_tsv, plainto_tsquery('simple', ${opts.query})) AS score
    FROM notes n
    JOIN projects p ON p.id = n.project_id
    WHERE ${workspaceFilter}
      AND n.deleted_at IS NULL
      AND n.content_tsv @@ plainto_tsquery('simple', ${opts.query})
    ORDER BY score DESC
    LIMIT ${fetchLimit}
  `);

  const [vectorRowsRaw, bm25RowsRaw] = await Promise.all([
    vectorRowsPromise,
    bm25RowsPromise,
  ]);
  const hits = new Map<string, McpSearchNoteHit>();
  const rrf = new Map<string, number>();

  function add(row: Record<string, unknown>, rank: number, channel: "vector" | "bm25") {
    const noteId = String(row.id);
    const score = Number(row.score ?? 0);
    const existing = hits.get(noteId);
    if (!existing) {
      hits.set(noteId, {
        noteId,
        title: String(row.title ?? "Untitled"),
        projectId: String(row.project_id),
        projectName: String(row.project_name ?? "Untitled"),
        snippet: clip(row.content_text as string | null, SNIPPET_MAX),
        sourceType: (row.source_type as string | null) ?? null,
        sourceUrl: (row.source_url as string | null) ?? null,
        updatedAt: (row.updated_at as Date).toISOString(),
        vectorScore: channel === "vector" ? score : null,
        bm25Score: channel === "bm25" ? score : null,
        rrfScore: 0,
      });
    } else if (channel === "vector") {
      existing.vectorScore = score;
    } else {
      existing.bm25Score = score;
    }
    rrf.set(noteId, (rrf.get(noteId) ?? 0) + 1 / (RRF_K + rank));
  }

  rows<Record<string, unknown>>(vectorRowsRaw).forEach((row, index) => {
    add(row, index + 1, "vector");
  });
  rows<Record<string, unknown>>(bm25RowsRaw).forEach((row, index) => {
    add(row, index + 1, "bm25");
  });
  for (const [noteId, score] of rrf) {
    const hit = hits.get(noteId);
    if (hit) hit.rrfScore = score;
  }

  return {
    hits: Array.from(hits.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit),
  };
}

export async function getMcpNote(opts: {
  workspaceId: string;
  noteId: string;
  db?: DB;
}): Promise<McpGetNoteResult | null> {
  const conn = opts.db ?? defaultDb;
  const [row] = await conn
    .select({
      noteId: notes.id,
      title: notes.title,
      projectId: notes.projectId,
      projectName: projects.name,
      sourceType: notes.sourceType,
      sourceUrl: notes.sourceUrl,
      contentText: notes.contentText,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .innerJoin(projects, eq(projects.id, notes.projectId))
    .where(
      and(
        eq(notes.id, opts.noteId),
        eq(notes.workspaceId, opts.workspaceId),
        isNull(notes.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    contentText: clip(row.contentText, NOTE_CONTENT_MAX, false),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMcpProjects(opts: {
  workspaceId: string;
  limit?: number;
  db?: DB;
}): Promise<McpListProjectsResult> {
  const conn = opts.db ?? defaultDb;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await conn
    .select({
      projectId: projects.id,
      name: projects.name,
      description: projects.description,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.workspaceId, opts.workspaceId))
    .orderBy(desc(projects.updatedAt))
    .limit(limit);
  return {
    projects: rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
