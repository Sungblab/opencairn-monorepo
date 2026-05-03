import { db, sql } from "@opencairn/db";
import { getChatProvider } from "./llm";
import { projectHybridSearch, type HybridHit } from "./internal-hybrid-search";
import { envInt } from "./env";
import {
  projectChunkHybridSearch,
  type ChunkHybridHit,
} from "./chunk-hybrid-search";
import { candidateFromRetrievalHit } from "./retrieval-candidates";
import { rerankCandidates } from "./retrieval-rerank";
import type {
  EvidenceProducer,
  EvidenceProvenance,
  EvidenceSupport,
  RetrievalChannel,
  SourceSpan,
} from "./retrieval-candidates";

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
  chunkId?: string | null;
  title: string;
  headingPath?: string;
  snippet: string;
  score: number;
  channelScores?: Partial<Record<RetrievalChannel, number>>;
  sourceType?: string | null;
  sourceUrl?: string | null;
  updatedAt?: string | null;
  provenance?: EvidenceProvenance;
  producer?: EvidenceProducer;
  confidence?: number;
  sourceSpan?: SourceSpan | null;
  evidenceId?: string;
  support?: EvidenceSupport;
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

  const provider = getChatProvider();
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
  const hitCandidates = Array.from(merged.values()).map((hit, index) => ({
    hit,
    candidate: candidateFromRetrievalHit(hit, index),
  }));
  const rerankedCandidates = rerankCandidates({
    query: opts.query,
    candidates: hitCandidates.map((item) => item.candidate),
  });
  const hitByCandidateId = new Map(
    hitCandidates.map((item) => [item.candidate.id, item.hit]),
  );

  return rerankedCandidates
    .slice(0, k)
    .map((candidate) => hitByCandidateId.get(candidate.id))
    .filter((h): h is ProjectRetrievalHit => h != null)
    .map((h) => ({
      noteId: h.noteId,
      chunkId: h.chunkId,
      title: h.title,
      headingPath: h.headingPath,
      snippet: h.snippet,
      score: h.score,
      channelScores: h.channelScores,
      sourceType: h.sourceType,
      sourceUrl: h.sourceUrl,
      updatedAt: h.updatedAt,
      provenance: h.provenance,
      producer: h.producer,
      confidence: h.confidence,
      sourceSpan: h.sourceSpan,
      evidenceId: h.evidenceId,
      support: h.support,
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
      chunkId: h.chunkId,
      title: h.title,
      headingPath: h.headingPath,
      snippet: h.snippet,
      score: h.rrfScore,
      channelScores: channelScores(h),
      sourceType: null,
      sourceUrl: null,
      updatedAt: null,
      provenance: "extracted",
      producer: { kind: "api", tool: "chat-retrieval" },
      confidence: confidenceFromScores(h),
      sourceSpan: null,
      evidenceId: `chunk:${h.chunkId}`,
      support: "supports",
    }));
  }

  const noteHits = await projectHybridSearch(opts).catch(
    () => [] as HybridHit[],
  );
  return noteHits.map((h) => ({
    sourceKey: `note:${h.noteId}`,
    noteId: h.noteId,
    title: h.title,
    headingPath: "",
    snippet: h.snippet,
    score: h.rrfScore,
    channelScores: channelScores(h),
    sourceType: h.sourceType,
    sourceUrl: h.sourceUrl,
    updatedAt: null,
    provenance: "extracted",
    producer: { kind: "api", tool: "chat-retrieval" },
    confidence: confidenceFromScores(h),
    sourceSpan: null,
    evidenceId: `note:${h.noteId}`,
    support: "supports",
  }));
}

function channelScores(hit: {
  vectorScore: number | null;
  bm25Score: number | null;
}): Partial<Record<RetrievalChannel, number>> {
  return {
    ...(hit.vectorScore == null ? {} : { vector: hit.vectorScore }),
    ...(hit.bm25Score == null ? {} : { bm25: hit.bm25Score }),
  };
}

function confidenceFromScores(hit: {
  vectorScore: number | null;
  bm25Score: number | null;
  rrfScore: number;
}): number {
  return Math.max(hit.vectorScore ?? 0, hit.bm25Score ?? 0, hit.rrfScore);
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
