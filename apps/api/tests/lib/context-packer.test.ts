import { describe, expect, it } from "vitest";
import {
  evidenceBundleToPrompt,
  packEvidence,
} from "../../src/lib/context-packer.js";
import type { RetrievalCandidate } from "../../src/lib/retrieval-candidates.js";

function candidate(
  id: string,
  noteId = id,
  snippet = "alpha beta",
  overrides: Partial<RetrievalCandidate> = {},
): RetrievalCandidate {
  return {
    id,
    noteId,
    chunkId: id,
    title: `Title ${id}`,
    headingPath: "",
    snippet,
    channelScores: { vector: 1 },
    sourceType: "pdf",
    sourceUrl: null,
    updatedAt: null,
    provenance: "extracted",
    producer: { kind: "api", tool: "chat-retrieval" },
    confidence: 0.9,
    sourceSpan: { start: 10, end: 20, locator: "p.1" },
    evidenceId: `ev-${id}`,
    support: "supports",
    ...overrides,
  };
}

describe("packEvidence", () => {
  it("assigns citation indexes and respects token budget", () => {
    const bundle = packEvidence({
      candidates: [candidate("c1"), candidate("c2", "n2", "x".repeat(2000))],
      maxTokens: 100,
    });

    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]!.citationIndex).toBe(1);
  });

  it("uses a conservative budget for Korean text and prompt metadata overhead", () => {
    const bundle = packEvidence({
      candidates: [candidate("ko", "n-ko", "가".repeat(120))],
      maxTokens: 80,
    });

    expect(bundle.items).toHaveLength(0);
    expect(bundle.omittedCandidates).toBe(1);
  });

  it("limits repeated chunks from one note", () => {
    const bundle = packEvidence({
      candidates: [
        candidate("c1", "same"),
        candidate("c2", "same"),
        candidate("c3", "other"),
      ],
      maxTokens: 1000,
      maxChunksPerNote: 1,
    });

    expect(bundle.items.map((i) => i.noteId)).toEqual(["same", "other"]);
  });

  it("round-robins and caps workspace fanout chunks by project", () => {
    const bundle = packEvidence({
      candidates: [
        candidate("hot-1", "hot-note-1", "alpha", { projectId: "p-hot" }),
        candidate("hot-2", "hot-note-2", "alpha", { projectId: "p-hot" }),
        candidate("hot-3", "hot-note-3", "alpha", { projectId: "p-hot" }),
        candidate("cold-1", "cold-note-1", "alpha", { projectId: "p-cold-1" }),
        candidate("cold-2", "cold-note-2", "alpha", { projectId: "p-cold-2" }),
      ],
      maxTokens: 1000,
      maxChunksPerNote: 1,
      maxChunksPerProject: 1,
    });

    expect(bundle.items.map((i) => i.evidenceId)).toEqual([
      "ev-hot-1",
      "ev-cold-1",
      "ev-cold-2",
    ]);
    expect(bundle.items.map((i) => i.projectId)).toEqual([
      "p-hot",
      "p-cold-1",
      "p-cold-2",
    ]);
  });

  it("preserves graphify-style provenance in evidence items and prompt metadata", () => {
    const bundle = packEvidence({
      candidates: [
        candidate("c1", "n1", "claim with source span", {
          provenance: "inferred",
          confidence: 0.64,
          producer: { kind: "worker", runId: "run-1", model: "gemini-3" },
          sourceSpan: { start: 4, end: 28, locator: "section 2" },
          evidenceId: "bundle-1:chunk-1",
        }),
      ],
      maxTokens: 1000,
    });

    expect(bundle.items[0]).toMatchObject({
      provenance: "inferred",
      confidence: 0.64,
      evidenceId: "bundle-1:chunk-1",
      sourceSpan: { start: 4, end: 28, locator: "section 2" },
    });
    const prompt = evidenceBundleToPrompt(bundle);
    expect(prompt).toContain("provenance=inferred");
    expect(prompt).toContain("confidence=0.64");
    expect(prompt).toContain("evidenceId=bundle-1:chunk-1");
    expect(prompt).toContain("span=section 2:4-28");
  });
});
