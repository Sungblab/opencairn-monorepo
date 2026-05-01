import { db, sql } from "@opencairn/db";
import { getGeminiProvider } from "./llm/gemini";
import { projectHybridSearch, type HybridHit } from "./internal-hybrid-search";
import { envInt } from "./env";
import {
  projectChunkHybridSearch,
  type ChunkHybridHit,
} from "./chunk-hybrid-search";

// ── Types ────────────────────────────────────────────────────────────────

export type RagMode = "strict" | "expand" | "off";

export type RetrievalScope =
  | { type: "workspace"; workspaceId: string }
  | { type: "project"; workspaceId: string; projectId: string }
  | { type: "page"; workspaceId: string; noteId: string };

export type RetrievalChip =
  | { type: "page"; id: string }
  | { type: "project"; id: string }
  | { type: "workspace"; id: string };

export type RetrievalHit = {
  noteId: string;
  title: string;
  snippet: string;
  score: number;
};

type ProjectRetrievalHit = RetrievalHit & {
  sourceKey: string;
};

// ── Top-k routing ────────────────────────────────────────────────────────

function topK(mode: RagMode): number {
  if (mode === "off") return 0;
  if (mode === "strict") return envInt("CHAT_RAG_TOP_K_STRICT", 5);
  return envInt("CHAT_RAG_TOP_K_EXPAND", 12);
}

function maxProjects(): number {
  return envInt("CHAT_RAG_MAX_PROJECTS", 64);
}

function fanoutConcurrency(): number {
  return envInt("CHAT_RAG_FANOUT_CONCURRENCY", 8);
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
      worker(),
    ),
  );
  return results;
}

// ── Public surface ───────────────────────────────────────────────────────

export async function retrieve(opts: {
  workspaceId: string;
  query: string;
  ragMode: RagMode;
  scope: RetrievalScope;
  chips: RetrievalChip[];
  signal?: AbortSignal;
}): Promise<RetrievalHit[]> {
  const k = topK(opts.ragMode);
  if (k === 0) return [];

  const projectIds = await resolveProjectIds(opts);
  checkAbort(opts.signal);
  if (projectIds.length === 0) return [];

  const provider = getGeminiProvider();
  const queryEmbedding = await provider.embed(opts.query);
  checkAbort(opts.signal);

  const fanout = projectIds.slice(0, maxProjects());
  const perProjectK = Math.max(k, 5);

  const projectHits = await mapWithConcurrency(
    fanout,
    fanoutConcurrency(),
    (projectId) =>
      retrieveProjectHits({
        projectId,
        queryText: opts.query,
        queryEmbedding,
        k: perProjectK,
      }),
    opts.signal,
  );

  // Re-merge: chunk hits use chunk ids for citation-level identity; fallback
  // note hits use note ids.
  const merged = new Map<string, ProjectRetrievalHit>();
  for (const hits of projectHits) {
    for (const h of hits) {
      if (!merged.has(h.sourceKey)) merged.set(h.sourceKey, h);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((h) => ({
      noteId: h.noteId,
      title: h.title,
      snippet: h.snippet,
      score: h.score,
    }));
}

async function retrieveProjectHits(opts: {
  projectId: string;
  queryText: string;
  queryEmbedding: number[];
  k: number;
}): Promise<ProjectRetrievalHit[]> {
  const chunkHits = await projectChunkHybridSearch(opts).catch(
    () => [] as ChunkHybridHit[],
  );
  if (chunkHits.length > 0) {
    return chunkHits.map((h) => ({
      sourceKey: `chunk:${h.chunkId}`,
      noteId: h.noteId,
      title: h.headingPath ? `${h.title} · ${h.headingPath}` : h.title,
      snippet: h.snippet,
      score: h.rrfScore,
    }));
  }

  const noteHits = await projectHybridSearch(opts).catch(
    () => [] as HybridHit[],
  );
  return noteHits.map((h) => ({
    sourceKey: `note:${h.noteId}`,
    noteId: h.noteId,
    title: h.title,
    snippet: h.snippet,
    score: h.rrfScore,
  }));
}

// ── Scope/chip resolution ────────────────────────────────────────────────

async function resolveProjectIds(opts: {
  workspaceId: string;
  scope: RetrievalScope;
  chips: RetrievalChip[];
}): Promise<string[]> {
  // Memory chips are silently ignored at retrieval (Plan 11B Phase B/C
  // owns the memory store). Filter them at call sites; here we accept
  // only page/project/workspace chips by type.
  if (opts.chips.length > 0) {
    const ids = new Set<string>();
    for (const chip of opts.chips) {
      if (chip.type === "project") {
        if (await projectInWorkspace(chip.id, opts.workspaceId)) {
          ids.add(chip.id);
        }
      } else if (chip.type === "page") {
        const projectId = await projectIdForNote(chip.id, opts.workspaceId);
        if (projectId) ids.add(projectId);
      } else if (chip.type === "workspace") {
        if (chip.id === opts.workspaceId) {
          for (const p of await allProjectsInWorkspace(opts.workspaceId)) {
            ids.add(p);
          }
        }
      }
    }
    return Array.from(ids);
  }

  if (opts.scope.type === "project") return [opts.scope.projectId];
  if (opts.scope.type === "page") {
    const p = await projectIdForNote(opts.scope.noteId, opts.workspaceId);
    return p ? [p] : [];
  }
  return allProjectsInWorkspace(opts.workspaceId);
}

async function projectInWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const rowsRaw = await db.execute(sql`
    SELECT 1 FROM projects
    WHERE id = ${projectId} AND workspace_id = ${workspaceId}
    LIMIT 1
  `);
  const rows =
    (rowsRaw as unknown as { rows: unknown[] }).rows ??
    (rowsRaw as unknown as unknown[]);
  return rows.length > 0;
}

async function projectIdForNote(
  noteId: string,
  workspaceId: string,
): Promise<string | null> {
  const rowsRaw = await db.execute(sql`
    SELECT n.project_id AS pid
    FROM notes n
    JOIN projects p ON p.id = n.project_id
    WHERE n.id = ${noteId} AND p.workspace_id = ${workspaceId} AND n.deleted_at IS NULL
    LIMIT 1
  `);
  const rows =
    ((rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (rowsRaw as unknown as Array<Record<string, unknown>>)) as Array<{
      pid: string;
    }>;
  return rows[0]?.pid ?? null;
}

async function allProjectsInWorkspace(workspaceId: string): Promise<string[]> {
  const cap = maxProjects();
  const rowsRaw = await db.execute(sql`
    SELECT id FROM projects
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${cap}
  `);
  const rows =
    ((rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (rowsRaw as unknown as Array<Record<string, unknown>>)) as Array<{
      id: string;
    }>;
  return rows.map((r) => r.id);
}
