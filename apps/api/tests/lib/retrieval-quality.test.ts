import { describe, expect, it } from "vitest";
import { evaluateRetrievalQuality } from "../../src/lib/retrieval-quality.js";
import type { RetrievalCandidate } from "../../src/lib/retrieval-candidates.js";

function candidate(
  id: string,
  confidence: number,
  overrides: Partial<RetrievalCandidate> = {},
): RetrievalCandidate {
  return {
    id,
    noteId: id,
    chunkId: id,
    title: id,
    headingPath: "",
    snippet: "alpha evidence",
    channelScores: { vector: confidence },
    sourceType: null,
    sourceUrl: null,
    updatedAt: null,
    provenance: "extracted",
    producer: { kind: "api", tool: "chat-retrieval" },
    confidence,
    sourceSpan: null,
    evidenceId: `ev-${id}`,
    support: "supports",
    ...overrides,
  };
}

describe("evaluateRetrievalQuality", () => {
  it("marks empty retrieval as retryable", () => {
    const report = evaluateRetrievalQuality({ candidates: [] });

    expect(report.decision).toBe("empty");
    expect(report.shouldRetry).toBe(true);
  });

  it("marks sparse retrieval as retryable even when confidence is high", () => {
    const report = evaluateRetrievalQuality({
      candidates: [candidate("one", 0.95)],
      minCandidates: 2,
    });

    expect(report.decision).toBe("sparse");
    expect(report.shouldRetry).toBe(true);
  });

  it("marks low-confidence retrieval as retryable", () => {
    const report = evaluateRetrievalQuality({
      candidates: [candidate("a", 0.1), candidate("b", 0.2)],
      minCandidates: 2,
      minAverageConfidence: 0.5,
    });

    expect(report.decision).toBe("weak");
    expect(report.shouldRetry).toBe(true);
  });

  it("accepts enough confident supporting evidence", () => {
    const report = evaluateRetrievalQuality({
      candidates: [candidate("a", 0.8), candidate("b", 0.7)],
      minCandidates: 2,
      minAverageConfidence: 0.5,
    });

    expect(report.decision).toBe("sufficient");
    expect(report.shouldRetry).toBe(false);
  });
});
