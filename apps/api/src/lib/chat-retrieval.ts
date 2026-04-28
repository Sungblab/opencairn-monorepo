import { db, sql } from "@opencairn/db";
import { getGeminiProvider } from "./llm/gemini";
import { projectHybridSearch, type HybridHit } from "./internal-hybrid-search";
import { envInt } from "./env";

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

// ── Top-k routing ────────────────────────────────────────────────────────

function topK(mode: RagMode): number {
  if (mode === "off") return 0;
  if (mode === "strict") return envInt("CHAT_RAG_TOP_K_STRICT", 5);
  return envInt("CHAT_RAG_TOP_K_EXPAND", 12);
}

function maxProjects(): number {
  return envInt("CHAT_RAG_MAX_PROJECTS", 64);
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
  if (projectIds.length === 0) return [];

  const provider = getGeminiProvider();
  const queryEmbedding = await provider.embed(opts.query);

  const fanout = projectIds.slice(0, maxProjects());
  const perProjectK = Math.max(k, 5);

  const projectHits = await Promise.all(
    fanout.map((projectId) =>
      projectHybridSearch({
        projectId,
        queryText: opts.query,
        queryEmbedding,
        k: perProjectK,
      }).catch(() => [] as HybridHit[]),
    ),
  );

  // Re-merge: keep first occurrence per noteId, then sort by RRF score and
  // slice. Note↔project is 1:1 so duplicates across projects shouldn't
  // happen; the dedup is defensive.
  const merged = new Map<string, HybridHit>();
  for (const hits of projectHits) {
    for (const h of hits) {
      if (!merged.has(h.noteId)) merged.set(h.noteId, h);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, k)
    .map((h) => ({
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
  const rowsRaw = await db.execute(sql`
    SELECT id FROM projects
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `);
  const rows =
    ((rowsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (rowsRaw as unknown as Array<Record<string, unknown>>)) as Array<{
      id: string;
    }>;
  return rows.map((r) => r.id);
}
