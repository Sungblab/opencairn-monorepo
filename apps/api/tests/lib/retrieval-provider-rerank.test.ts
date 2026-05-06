import { describe, expect, it, vi } from "vitest";
import {
  applyProviderRerankIds,
  parseProviderRerankIds,
  rerankCandidatesWithProvider,
} from "../../src/lib/retrieval-provider-rerank.js";
import type { LLMProvider } from "../../src/lib/llm/provider.js";
import type { RetrievalCandidate } from "../../src/lib/retrieval-candidates.js";

function candidate(id: string): RetrievalCandidate {
  return {
    id,
    noteId: id,
    chunkId: id,
    title: id,
    headingPath: "",
    snippet: `${id} snippet`,
    channelScores: { vector: 0.8 },
    sourceType: null,
    sourceUrl: null,
    updatedAt: null,
    provenance: "extracted",
    producer: { kind: "api", tool: "chat-retrieval" },
    confidence: 0.8,
    sourceSpan: null,
    evidenceId: id,
    support: "supports",
  };
}

describe("provider reranker helpers", () => {
  it("parses both array and object JSON rerank output", () => {
    expect(parseProviderRerankIds('["b","a"]')).toEqual(["b", "a"]);
    expect(parseProviderRerankIds('{"rankedIds":["c","a"]}')).toEqual([
      "c",
      "a",
    ]);
  });

  it("applies provider ids while preserving omitted candidates", () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];

    expect(
      applyProviderRerankIds({
        candidates,
        rankedIds: ["c", "a"],
      }).map((item) => item.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("falls back to existing order when provider output is invalid", async () => {
    async function* stream() {
      yield { delta: "not-json" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "fake" } };
    }
    const provider = {
      embed: vi.fn(),
      streamGenerate: vi.fn(stream),
    } as unknown as LLMProvider;
    const candidates = [candidate("a"), candidate("b")];

    const reranked = await rerankCandidatesWithProvider({
      query: "alpha",
      candidates,
      provider,
    });

    expect(reranked.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
