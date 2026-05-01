import { describe, expect, it } from "vitest";
import {
  createEvidenceBundleSchema,
  evidenceBundleSchema,
  graphEdgeEvidenceResponseSchema,
} from "../src/evidence";

const chunkId = "11111111-1111-4111-8111-111111111111";
const noteId = "22222222-2222-4222-8222-222222222222";
const bundleId = "33333333-3333-4333-8333-333333333333";

describe("evidence contracts", () => {
  it("accepts a bundle with chunk citation metadata", () => {
    const parsed = evidenceBundleSchema.parse({
      id: bundleId,
      workspaceId: "44444444-4444-4444-8444-444444444444",
      projectId: "55555555-5555-4555-8555-555555555555",
      purpose: "rag_answer",
      producer: { kind: "chat", runId: "run-1", model: "gemini-2.5-flash" },
      query: "what supports this edge?",
      createdBy: null,
      createdAt: new Date().toISOString(),
      entries: [
        {
          noteChunkId: chunkId,
          noteId,
          noteType: "source",
          sourceType: "pdf",
          headingPath: "Intro > Evidence",
          sourceOffsets: { start: 10, end: 120 },
          score: 0.91,
          rank: 1,
          retrievalChannel: "vector",
          quote: "A short supporting quote.",
          citation: { label: "S1", title: "Paper" },
          metadata: {},
        },
      ],
    });

    expect(parsed.entries[0]?.noteChunkId).toBe(chunkId);
  });

  it("requires at least one entry when creating a bundle", () => {
    expect(() =>
      createEvidenceBundleSchema.parse({
        workspaceId: "44444444-4444-4444-8444-444444444444",
        projectId: "55555555-5555-4555-8555-555555555555",
        purpose: "kg_edge",
        producer: { kind: "worker" },
        createdBy: null,
        entries: [],
      }),
    ).toThrow();
  });

  it("accepts edge evidence with support status", () => {
    const parsed = graphEdgeEvidenceResponseSchema.parse({
      edgeId: "66666666-6666-4666-8666-666666666666",
      claims: [
        {
          claimId: "77777777-7777-4777-8777-777777777777",
          claimText: "A supports B.",
          status: "active",
          confidence: 0.8,
          evidenceBundleId: bundleId,
          evidence: [],
        },
      ],
    });

    expect(parsed.claims[0]?.status).toBe("active");
  });
});
