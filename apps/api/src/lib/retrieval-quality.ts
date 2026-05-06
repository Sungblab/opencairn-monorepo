import type { AdaptiveRagPolicy } from "./adaptive-rag-router";
import type { RetrievalCandidate } from "./retrieval-candidates";

export type RetrievalQualityDecision =
  | "disabled"
  | "empty"
  | "sparse"
  | "weak"
  | "sufficient";

export type RetrievalQualityReport = {
  decision: RetrievalQualityDecision;
  shouldRetry: boolean;
  retryApplied: boolean;
  candidateCount: number;
  supportingCount: number;
  averageConfidence: number;
  maxConfidence: number;
  reasons: string[];
};

export function disabledRetrievalQuality(): RetrievalQualityReport {
  return {
    decision: "disabled",
    shouldRetry: false,
    retryApplied: false,
    candidateCount: 0,
    supportingCount: 0,
    averageConfidence: 0,
    maxConfidence: 0,
    reasons: ["rag_off"],
  };
}

export function evaluateRetrievalQuality(input: {
  candidates: RetrievalCandidate[];
  minCandidates?: number;
  minAverageConfidence?: number;
  minMaxConfidence?: number;
}): RetrievalQualityReport {
  const minCandidates = input.minCandidates ?? 2;
  const minAverageConfidence = input.minAverageConfidence ?? 0.35;
  const minMaxConfidence = input.minMaxConfidence ?? 0.45;
  const supporting = input.candidates.filter(
    (candidate) => candidate.support === "supports",
  );
  const confidenceValues = supporting.map((candidate) => candidate.confidence);
  const averageConfidence =
    confidenceValues.length === 0
      ? 0
      : confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length;
  const maxConfidence =
    confidenceValues.length === 0 ? 0 : Math.max(...confidenceValues);

  if (input.candidates.length === 0) {
    return report("empty", true, input.candidates, supporting, {
      averageConfidence,
      maxConfidence,
      reasons: ["no_candidates"],
    });
  }

  if (supporting.length < minCandidates) {
    return report("sparse", true, input.candidates, supporting, {
      averageConfidence,
      maxConfidence,
      reasons: ["too_few_supporting_candidates"],
    });
  }

  if (
    averageConfidence < minAverageConfidence ||
    maxConfidence < minMaxConfidence
  ) {
    return report("weak", true, input.candidates, supporting, {
      averageConfidence,
      maxConfidence,
      reasons: ["low_confidence"],
    });
  }

  return report("sufficient", false, input.candidates, supporting, {
    averageConfidence,
    maxConfidence,
    reasons: ["enough_supporting_evidence"],
  });
}

export function correctivePolicyForQuality(
  policy: AdaptiveRagPolicy,
  quality: RetrievalQualityReport,
): AdaptiveRagPolicy {
  if (!quality.shouldRetry || policy.ragMode !== "expand") return policy;
  if (policy.reasons.includes("corrective_retry")) return policy;
  if (policy.graphDepth !== 0) return policy;
  if (quality.decision === "sparse" && quality.maxConfidence >= 0.85) {
    return policy;
  }

  return {
    ...policy,
    seedTopK: Math.max(policy.seedTopK, policy.resultTopK * 2),
    graphDepth: policy.graphDepth === 0 ? 1 : policy.graphDepth,
    graphLimit: Math.max(policy.graphLimit, policy.resultTopK * 2),
    contextMaxTokens: Math.max(policy.contextMaxTokens, 6000),
    maxChunksPerNote: Math.max(policy.maxChunksPerNote, 3),
    verifierRequired: true,
    reasons: [...policy.reasons, "corrective_retry"],
  };
}

function report(
  decision: Exclude<RetrievalQualityDecision, "disabled">,
  shouldRetry: boolean,
  candidates: RetrievalCandidate[],
  supporting: RetrievalCandidate[],
  stats: {
    averageConfidence: number;
    maxConfidence: number;
    reasons: string[];
  },
): RetrievalQualityReport {
  return {
    decision,
    shouldRetry,
    retryApplied: false,
    candidateCount: candidates.length,
    supportingCount: supporting.length,
    averageConfidence: stats.averageConfidence,
    maxConfidence: stats.maxConfidence,
    reasons: stats.reasons,
  };
}
