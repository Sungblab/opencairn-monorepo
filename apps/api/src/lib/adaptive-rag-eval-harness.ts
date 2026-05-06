import {
  planAdaptiveRagPolicy,
  summarizeAdaptiveRagPolicy,
  type AdaptiveRagPolicySummary,
} from "./adaptive-rag-router";
import {
  candidateFromRetrievalHit,
  type RetrievalHitLike,
} from "./retrieval-candidates";
import { rerankCandidates } from "./retrieval-rerank";
import { packEvidence } from "./context-packer";
import {
  evaluateRetrievalQuality,
  type RetrievalQualityReport,
} from "./retrieval-quality";
import type { RagMode, RetrievalChip, RetrievalScope } from "./chat-retrieval";

export type AdaptiveRagEvalReport = {
  policySummary: AdaptiveRagPolicySummary;
  candidateStats: {
    inputCount: number;
    rerankedCandidateIds: string[];
  };
  qualityStats: RetrievalQualityReport;
  packedEvidenceStats: {
    contextMaxTokens: number;
    maxChunksPerNote: number;
    maxChunksPerProject: number | null;
    itemCount: number;
    totalCandidates: number;
    omittedCandidates: number;
    itemEvidenceIds: string[];
    graphPathEvidenceIds: string[];
    perNoteCounts: Record<string, number>;
    perProjectCounts: Record<string, number>;
  };
};

export type AdaptiveRagEvalFixture = {
  name: string;
  query: string;
  ragMode: RagMode;
  scope: RetrievalScope;
  chips: RetrievalChip[];
  projectCount?: number;
  hits: RetrievalHitLike[];
  expectedReport: Partial<AdaptiveRagEvalReport>;
};

export function runAdaptiveRagEvalFixture(
  fixture: Pick<
    AdaptiveRagEvalFixture,
    "query" | "ragMode" | "scope" | "chips" | "projectCount" | "hits"
  >,
): AdaptiveRagEvalReport {
  const policy = planAdaptiveRagPolicy({
    query: fixture.query,
    ragMode: fixture.ragMode,
    scope: fixture.scope,
    chips: fixture.chips,
    projectCount: fixture.projectCount,
  });
  const rerankedCandidates = rerankCandidates({
    query: fixture.query,
    candidates: fixture.hits.map((item, index) =>
      candidateFromRetrievalHit(item, index),
    ),
  });
  const evidenceBundle = packEvidence({
    candidates: rerankedCandidates,
    maxTokens: policy.contextMaxTokens,
    maxChunksPerNote: policy.maxChunksPerNote,
    maxChunksPerProject: policy.maxChunksPerProject,
  });
  const qualityStats = evaluateRetrievalQuality({
    candidates: rerankedCandidates,
  });

  return {
    policySummary: summarizeAdaptiveRagPolicy(policy),
    candidateStats: {
      inputCount: fixture.hits.length,
      rerankedCandidateIds: rerankedCandidates.map((item) => item.id),
    },
    qualityStats,
    packedEvidenceStats: {
      contextMaxTokens: policy.contextMaxTokens,
      maxChunksPerNote: policy.maxChunksPerNote,
      maxChunksPerProject: policy.maxChunksPerProject ?? null,
      itemCount: evidenceBundle.items.length,
      totalCandidates: evidenceBundle.totalCandidates,
      omittedCandidates: evidenceBundle.omittedCandidates,
      itemEvidenceIds: evidenceBundle.items.map((item) => item.evidenceId),
      graphPathEvidenceIds: evidenceBundle.items
        .filter((item) => item.graphPath)
        .map((item) => item.evidenceId),
      perNoteCounts: countItemsByNote(evidenceBundle.items),
      perProjectCounts: countItemsByProject(evidenceBundle.items),
    },
  };
}

function countItemsByNote(
  items: Array<{ noteId: string }>,
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.noteId] = (acc[item.noteId] ?? 0) + 1;
    return acc;
  }, {});
}

function countItemsByProject(
  items: Array<{ projectId?: string }>,
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    if (!item.projectId) return acc;
    acc[item.projectId] = (acc[item.projectId] ?? 0) + 1;
    return acc;
  }, {});
}
