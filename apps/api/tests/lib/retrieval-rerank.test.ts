import { describe, expect, it } from "vitest";
import { rerankCandidates } from "../../src/lib/retrieval-rerank.js";
import type { RetrievalCandidate } from "../../src/lib/retrieval-candidates.js";

function candidate(
  id: string,
  snippet: string,
  channelScores: RetrievalCandidate["channelScores"],
  overrides: Partial<RetrievalCandidate> = {},
): RetrievalCandidate {
  return {
    id,
    noteId: id,
    chunkId: id,
    title: id,
    headingPath: "",
    snippet,
    channelScores,
    sourceType: null,
    sourceUrl: null,
    updatedAt: null,
    provenance: "extracted",
    producer: { kind: "api", tool: "chat-retrieval" },
    confidence: 0.7,
    sourceSpan: null,
    evidenceId: `ev-${id}`,
    support: "supports",
    ...overrides,
  };
}

describe("rerankCandidates", () => {
  it("boosts exact query overlap and multi-channel evidence", () => {
    const out = rerankCandidates({
      query: "transformer attention",
      candidates: [
        candidate("weak", "unrelated", { vector: 0.9 }),
        candidate("strong", "transformer attention mechanism", {
          vector: 0.7,
          bm25: 0.6,
        }),
      ],
    });

    expect(out[0]!.id).toBe("strong");
  });

  it("prefers extracted confident evidence over ambiguous inferred evidence at similar score", () => {
    const out = rerankCandidates({
      query: "indexed provenance",
      candidates: [
        candidate("guess", "indexed provenance", { vector: 0.8 }, {
          provenance: "ambiguous",
          confidence: 0.2,
          support: "mentions",
        }),
        candidate("grounded", "indexed provenance", { vector: 0.75 }, {
          provenance: "extracted",
          confidence: 0.95,
          support: "supports",
        }),
      ],
    });

    expect(out[0]!.id).toBe("grounded");
  });
});
