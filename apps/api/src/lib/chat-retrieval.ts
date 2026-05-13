import { db, sql } from "@opencairn/db";
import { getChatProvider } from "./llm";
import { projectHybridSearch, type HybridHit } from "./internal-hybrid-search";
import { envInt } from "./env";
import {
  projectChunkHybridSearch,
  type ChunkHybridHit,
} from "./chunk-hybrid-search";
import {
  expandGraphCandidates,
  type GraphExpansionHit,
} from "./retrieval-graph-expansion";
import {
  planAdaptiveRagPolicy,
  summarizeAdaptiveRagPolicy,
  type AdaptiveRagPolicy,
  type AdaptiveRagPolicySummary,
} from "./adaptive-rag-router";
import {
  candidateFromRetrievalHit,
  spreadByProject,
  type RetrievalCandidate,
} from "./retrieval-candidates";
import { rerankCandidates } from "./retrieval-rerank";
import {
  correctivePolicyForQuality,
  disabledRetrievalQuality,
  evaluateRetrievalQuality,
  type RetrievalQualityReport,
} from "./retrieval-quality";
import {
  providerRerankerEnabled,
  rerankCandidatesWithProvider,
} from "./retrieval-provider-rerank";
import { canRead } from "./permissions";
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
  projectId?: string;
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
  graphPath?: string | null;
};

const GRAPH_CONFIDENCE_SEMANTIC_PATH = 0.88;
const GRAPH_CONFIDENCE_GENERIC_PATH = 0.68;
const GRAPH_CONFIDENCE_DISPLAY_PATH = 0.48;
const GRAPH_SCORE_SEMANTIC_PATH = 0.72;
const GRAPH_SCORE_GENERIC_PATH = 0.5;
const GRAPH_SCORE_DISPLAY_PATH = 0.32;

type ProjectRetrievalHit = RetrievalHit & {
  sourceKey: string;
};

type CollectedProjectHits = {
  orderedCandidates: RetrievalCandidate[];
  rerankedCandidates: RetrievalCandidate[];
  hitByCandidateId: Map<string, ProjectRetrievalHit>;
};

export type RetrievalWithPolicyResult = {
  hits: RetrievalHit[];
  policy: AdaptiveRagPolicy;
  policySummary: AdaptiveRagPolicySummary;
  qualityReport: RetrievalQualityReport;
};

// ── Retrieval routing ────────────────────────────────────────────────────

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
  userId?: string;
  queryEmbedding?: number[];
  signal?: AbortSignal;
}): Promise<RetrievalHit[]> {
  const result = await retrieveWithPolicy(opts);
  return result.hits;
}

export async function retrieveWithPolicy(opts: {
  workspaceId: string;
  query: string;
  ragMode: RagMode;
  scope: RetrievalScope;
  chips: RetrievalChip[];
  userId?: string;
  queryEmbedding?: number[];
  signal?: AbortSignal;
}): Promise<RetrievalWithPolicyResult> {
  const initialPolicy = planAdaptiveRagPolicy(opts);
  if (initialPolicy.resultTopK === 0) {
    return retrievalResult([], initialPolicy, disabledRetrievalQuality());
  }
  const projectIds = await resolveProjectIds(opts);
  checkAbort(opts.signal);
  let policy = planAdaptiveRagPolicy({
    ...opts,
    projectCount: projectIds.length,
  });
  if (projectIds.length === 0) {
    return retrievalResult(
      [],
      policy,
      evaluateRetrievalQuality({ candidates: [] }),
    );
  }

  let provider = null as ReturnType<typeof getChatProvider> | null;
  let queryEmbedding = opts.queryEmbedding;
  if (!queryEmbedding) {
    provider = getChatProvider();
    queryEmbedding = await provider.embed(opts.query);
  }
  checkAbort(opts.signal);

  let collected = await collectProjectHits({
    opts,
    projectIds,
    queryEmbedding,
    policy,
  });
  const initialQualityReport = evaluateRetrievalQuality({
    candidates: collected.rerankedCandidates,
  });
  let qualityReport = initialQualityReport;

  const correctivePolicy = correctivePolicyForQuality(
    policy,
    initialQualityReport,
  );
  if (correctivePolicy !== policy) {
    collected = await collectProjectHits({
      opts,
      projectIds,
      queryEmbedding,
      policy: correctivePolicy,
    });
    const finalQualityReport = evaluateRetrievalQuality({
      candidates: collected.rerankedCandidates,
    });
    qualityReport = {
      ...finalQualityReport,
      retryApplied: true,
      reasons: Array.from(
        new Set([
          ...initialQualityReport.reasons,
          "corrective_retry_applied",
          ...finalQualityReport.reasons,
        ]),
      ),
    };
    policy = correctivePolicy;
  }

  if (providerRerankerEnabled()) {
    const rerankProvider = provider ?? getChatProvider();
    const providerRerankedCandidates = await rerankCandidatesWithProvider({
      query: opts.query,
      candidates: collected.rerankedCandidates,
      provider: rerankProvider,
      signal: opts.signal,
    });
    collected = {
      ...collected,
      rerankedCandidates: providerRerankedCandidates,
      orderedCandidates: orderCandidatesForPolicy(
        policy,
        providerRerankedCandidates,
      ),
    };
  }

  const hits = collected.orderedCandidates
    .slice(0, policy.resultTopK)
    .map((candidate) => collected.hitByCandidateId.get(candidate.id))
    .filter((h): h is ProjectRetrievalHit => h != null)
    .map((h) => ({
      noteId: h.noteId,
      projectId: h.projectId,
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
      graphPath: h.graphPath,
    }));
  return retrievalResult(hits, policy, qualityReport);
}

function retrievalResult(
  hits: RetrievalHit[],
  policy: AdaptiveRagPolicy,
  qualityReport: RetrievalQualityReport,
): RetrievalWithPolicyResult {
  return {
    hits,
    policy,
    policySummary: summarizeAdaptiveRagPolicy(policy),
    qualityReport,
  };
}

async function collectProjectHits(input: {
  opts: {
    workspaceId: string;
    query: string;
    ragMode: RagMode;
    userId?: string;
    signal?: AbortSignal;
  };
  projectIds: string[];
  queryEmbedding: number[];
  policy: AdaptiveRagPolicy;
}): Promise<CollectedProjectHits> {
  const fanout = input.projectIds.slice(0, maxProjects());
  const perProjectK = Math.max(input.policy.seedTopK, 5);

  const projectHits = await mapWithConcurrency(
    fanout,
    fanoutConcurrency(),
    (projectId) =>
      retrieveProjectHits({
        workspaceId: input.opts.workspaceId,
        projectId,
        queryText: input.opts.query,
        queryEmbedding: input.queryEmbedding,
        k: perProjectK,
        ragMode: input.opts.ragMode,
        userId: input.opts.userId,
        policy: input.policy,
      }),
    input.opts.signal,
  );

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
    query: input.opts.query,
    candidates: hitCandidates.map((item) => item.candidate),
  });
  return {
    orderedCandidates: orderCandidatesForPolicy(
      input.policy,
      rerankedCandidates,
    ),
    rerankedCandidates,
    hitByCandidateId: new Map(
      hitCandidates.map((item) => [item.candidate.id, item.hit]),
    ),
  };
}

function orderCandidatesForPolicy(
  policy: AdaptiveRagPolicy,
  candidates: RetrievalCandidate[],
): RetrievalCandidate[] {
  return policy.reasons.includes("workspace_fanout")
    ? spreadByProject(candidates)
    : candidates;
}

async function retrieveProjectHits(opts: {
  workspaceId: string;
  projectId: string;
  queryText: string;
  queryEmbedding: number[];
  k: number;
  ragMode: RagMode;
  userId?: string;
  policy: AdaptiveRagPolicy;
}): Promise<ProjectRetrievalHit[]> {
  const chunkHits = await projectChunkHybridSearch(opts).catch(
    () => [] as ChunkHybridHit[],
  );
  if (chunkHits.length > 0) {
    const seedHits = await filterReadableHits(
      opts.userId,
      chunkHits.map((h) => ({
        sourceKey: `chunk:${h.chunkId}`,
        noteId: h.noteId,
        projectId: opts.projectId,
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
      })),
    );
    if (seedHits.length > 0) {
      return [
        ...seedHits,
        ...(await graphExpansionHits({ ...opts, seedHits })),
      ];
    }
  }

  const noteHits = await projectHybridSearch(opts).catch(
    () => [] as HybridHit[],
  );
  const seedHits = await filterReadableHits(
    opts.userId,
    noteHits.map((h) => ({
      sourceKey: `note:${h.noteId}`,
      noteId: h.noteId,
      projectId: opts.projectId,
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
    })),
  );
  return [...seedHits, ...(await graphExpansionHits({ ...opts, seedHits }))];
}

async function graphExpansionHits(opts: {
  workspaceId: string;
  projectId: string;
  userId?: string;
  policy: AdaptiveRagPolicy;
  seedHits: ProjectRetrievalHit[];
}): Promise<ProjectRetrievalHit[]> {
  if (opts.policy.graphDepth === 0 || opts.seedHits.length === 0) return [];

  const seedNoteIds = Array.from(
    new Set(opts.seedHits.map((hit) => hit.noteId)),
  );
  const graphHits = await expandGraphCandidates({
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    seedNoteIds,
    maxDepth: opts.policy.graphDepth,
    limit: opts.policy.graphLimit,
  }).catch(() => [] as GraphExpansionHit[]);

  return filterReadableHits(
    opts.userId,
    graphHits.map((hit): ProjectRetrievalHit => {
      const sourceKey = hit.chunkId
        ? `chunk:${hit.chunkId}`
        : `note:${hit.noteId}`;
      const evidenceId = hit.chunkId
        ? `graph:chunk:${hit.chunkId}`
        : `graph:note:${hit.noteId}`;
      const semanticBoost = hit.graphPath?.includes("depends_on") ||
        hit.graphPath?.includes("is_a") ||
        hit.graphPath?.includes("part_of") ||
        hit.graphPath?.includes("causes") ||
        hit.graphPath?.includes("derived_from");
      const weakDisplayPath = hit.graphPath?.includes("appears_with") ||
        hit.graphPath?.includes("near_in_source");
      const confidence = hit.graphScore *
        (semanticBoost
          ? GRAPH_CONFIDENCE_SEMANTIC_PATH
          : weakDisplayPath
            ? GRAPH_CONFIDENCE_DISPLAY_PATH
            : GRAPH_CONFIDENCE_GENERIC_PATH);
      return {
        sourceKey,
        noteId: hit.noteId,
        projectId: opts.projectId,
        chunkId: hit.chunkId,
        title: hit.title,
        headingPath: hit.headingPath,
        snippet: hit.snippet,
        score: hit.graphScore *
          (semanticBoost
            ? GRAPH_SCORE_SEMANTIC_PATH
            : weakDisplayPath
              ? GRAPH_SCORE_DISPLAY_PATH
              : GRAPH_SCORE_GENERIC_PATH),
        channelScores: { graph: hit.graphScore },
        sourceType: hit.sourceType,
        sourceUrl: hit.sourceUrl,
        updatedAt: hit.updatedAt,
        provenance: "inferred",
        producer: { kind: "api", tool: "retrieval-graph-expansion" },
        confidence,
        sourceSpan: null,
        evidenceId,
        support: semanticBoost ? "supports" : "mentions",
        graphPath: hit.graphPath,
      };
    }),
  );
}

async function filterReadableHits(
  userId: string | undefined,
  hits: ProjectRetrievalHit[],
): Promise<ProjectRetrievalHit[]> {
  if (!userId || hits.length === 0) return hits;
  const allowedNoteIds = new Map<string, boolean>();
  const uniqueNoteIds = Array.from(new Set(hits.map((hit) => hit.noteId)));
  await Promise.all(
    uniqueNoteIds.map(async (noteId) => {
      allowedNoteIds.set(noteId, await canReadNote(userId, noteId));
    }),
  );
  return hits.filter((hit) => allowedNoteIds.get(hit.noteId) === true);
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
  userId?: string;
}): Promise<string[]> {
  // Memory chips are silently ignored at retrieval (Plan 11B Phase B/C
  // owns the memory store). Filter them at call sites; here we accept
  // only page/project/workspace chips by type.
  if (opts.chips.length > 0) {
    const ids = new Set<string>();
    for (const chip of opts.chips) {
      if (chip.type === "project") {
        if (
          (await projectInWorkspace(chip.id, opts.workspaceId)) &&
          (await canReadProject(opts.userId, chip.id))
        ) {
          ids.add(chip.id);
        }
      } else if (chip.type === "page") {
        const projectId = await projectIdForReadableNote(
          chip.id,
          opts.workspaceId,
          opts.userId,
        );
        if (projectId) ids.add(projectId);
      } else if (chip.type === "workspace") {
        if (chip.id === opts.workspaceId) {
          for (const p of await readableProjectsInWorkspace(
            opts.workspaceId,
            opts.userId,
          )) {
            ids.add(p);
          }
        }
      }
    }
    return Array.from(ids);
  }

  if (opts.scope.type === "project") {
    return (await canReadProject(opts.userId, opts.scope.projectId))
      ? [opts.scope.projectId]
      : [];
  }
  if (opts.scope.type === "page") {
    const p = await projectIdForReadableNote(
      opts.scope.noteId,
      opts.workspaceId,
      opts.userId,
    );
    return p ? [p] : [];
  }
  return readableProjectsInWorkspace(opts.workspaceId, opts.userId);
}

async function canReadProject(
  userId: string | undefined,
  projectId: string,
): Promise<boolean> {
  if (!userId) return true;
  return canRead(userId, { type: "project", id: projectId });
}

async function canReadNote(
  userId: string | undefined,
  noteId: string,
): Promise<boolean> {
  if (!userId) return true;
  return canRead(userId, { type: "note", id: noteId });
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
  const rows = ((rowsRaw as unknown as { rows: Array<Record<string, unknown>> })
    .rows ?? (rowsRaw as unknown as Array<Record<string, unknown>>)) as Array<{
    pid: string;
  }>;
  return rows[0]?.pid ?? null;
}

async function projectIdForReadableNote(
  noteId: string,
  workspaceId: string,
  userId: string | undefined,
): Promise<string | null> {
  if (!(await canReadNote(userId, noteId))) return null;
  return projectIdForNote(noteId, workspaceId);
}

async function allProjectsInWorkspace(workspaceId: string): Promise<string[]> {
  const cap = maxProjects();
  const rowsRaw = await db.execute(sql`
    SELECT id FROM projects
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${cap}
  `);
  const rows = ((rowsRaw as unknown as { rows: Array<Record<string, unknown>> })
    .rows ?? (rowsRaw as unknown as Array<Record<string, unknown>>)) as Array<{
    id: string;
  }>;
  return rows.map((r) => r.id);
}

async function readableProjectsInWorkspace(
  workspaceId: string,
  userId: string | undefined,
): Promise<string[]> {
  const projectIds = await allProjectsInWorkspace(workspaceId);
  if (!userId) return projectIds;
  const checks = await Promise.all(
    projectIds.map(async (id) => ({
      id,
      ok: await canReadProject(userId, id),
    })),
  );
  return checks.filter((p) => p.ok).map((p) => p.id);
}
