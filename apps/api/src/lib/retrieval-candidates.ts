export type RetrievalChannel =
  | "vector"
  | "bm25"
  | "graph"
  | "active_context";

export type EvidenceProvenance = "extracted" | "inferred" | "ambiguous";

export type EvidenceSupport = "supports" | "contradicts" | "mentions";

export type EvidenceProducer = {
  kind: "ingest" | "chat" | "worker" | "api" | "manual";
  runId?: string;
  model?: string;
  tool?: string;
};

export type SourceSpan = {
  start: number;
  end: number;
  locator?: string;
};

export type RetrievalCandidate = {
  id: string;
  noteId: string;
  projectId?: string;
  chunkId: string | null;
  title: string;
  headingPath: string;
  snippet: string;
  channelScores: Partial<Record<RetrievalChannel, number>>;
  sourceType: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
  provenance: EvidenceProvenance;
  producer: EvidenceProducer;
  confidence: number;
  sourceSpan: SourceSpan | null;
  evidenceId: string;
  support: EvidenceSupport;
};

export type EvidenceItem = {
  citationIndex: number;
  noteId: string;
  projectId?: string;
  chunkId: string | null;
  title: string;
  headingPath: string;
  snippet: string;
  sourceType: string | null;
  sourceUrl: string | null;
  provenance: EvidenceProvenance;
  producer: EvidenceProducer;
  confidence: number;
  sourceSpan: SourceSpan | null;
  evidenceId: string;
  support: EvidenceSupport;
};

export type EvidenceBundle = {
  items: EvidenceItem[];
  totalEstimatedTokens: number;
  totalCandidates: number;
  omittedCandidates: number;
};

export type RetrievalHitLike = {
  noteId: string;
  projectId?: string;
  title: string;
  snippet: string;
  score: number;
  chunkId?: string | null;
  headingPath?: string;
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

export function candidateFromRetrievalHit(
  hit: RetrievalHitLike,
  index: number,
): RetrievalCandidate {
  const chunkId = hit.chunkId ?? null;
  const id =
    hit.evidenceId ??
    (chunkId ? `chunk:${chunkId}` : `note:${hit.noteId}:${index}`);
  return {
    id,
    noteId: hit.noteId,
    projectId: hit.projectId,
    chunkId,
    title: hit.title,
    headingPath: hit.headingPath ?? "",
    snippet: hit.snippet,
    channelScores: hit.channelScores ?? { vector: hit.score },
    sourceType: hit.sourceType ?? null,
    sourceUrl: hit.sourceUrl ?? null,
    updatedAt: hit.updatedAt ?? null,
    provenance: hit.provenance ?? "extracted",
    producer: hit.producer ?? { kind: "api", tool: "chat-retrieval" },
    confidence: clamp01(hit.confidence ?? hit.score),
    sourceSpan: hit.sourceSpan ?? null,
    evidenceId: hit.evidenceId ?? id,
    support: hit.support ?? "supports",
  };
}

export function spreadByProject<T extends { id: string; projectId?: string }>(
  candidates: T[],
): T[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.projectId ?? `candidate:${candidate.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(candidate);
  }

  const result: T[] = [];
  for (let depth = 0; ; depth += 1) {
    let added = false;
    for (const key of order) {
      const candidate = buckets.get(key)![depth];
      if (!candidate) continue;
      result.push(candidate);
      added = true;
    }
    if (!added) return result;
  }
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
