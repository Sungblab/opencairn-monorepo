import { describe, expect, it } from "vitest";
import {
  runAdaptiveRagEvalFixture,
  type AdaptiveRagEvalFixture,
} from "../../src/lib/adaptive-rag-eval-harness.js";
import type {
  RetrievalCandidate,
  RetrievalHitLike,
} from "../../src/lib/retrieval-candidates.js";

const workspaceScope = {
  type: "workspace" as const,
  workspaceId: "ws-eval",
};

const projectScope = {
  type: "project" as const,
  workspaceId: "ws-eval",
  projectId: "p-eval",
};

const ADAPTIVE_RAG_EVAL_FIXTURES: AdaptiveRagEvalFixture[] = [
  {
    name: "simple",
    query: "alpha 정의",
    ragMode: "expand",
    scope: projectScope,
    chips: [],
    hits: [
      hit("simple-a", "note-simple", "Alpha definition", "alpha definition", {
        vector: 0.96,
      }),
      hit("simple-b", "note-simple", "Alpha summary", "alpha quick summary", {
        bm25: 0.9,
      }),
      hit("simple-c", "note-simple", "Alpha detail", "alpha detailed note", {
        vector: 0.8,
      }),
      hit("simple-d", "note-other", "Beta glossary", "beta glossary", {
        vector: 0.7,
      }),
    ],
    expectedReport: {
      policySummary: {
        route: "simple",
        reasons: ["explicit_scope", "simple_query"],
        retrievalShape: {
          ragMode: "expand",
          resultTopK: 12,
          seedTopK: 12,
          graphDepth: 0,
          graphLimit: 0,
          contextMaxTokens: 3000,
          maxChunksPerNote: 2,
          verifierRequired: false,
        },
      },
      candidateStats: {
        inputCount: 4,
        rerankedCandidateIds: ["simple-a", "simple-b", "simple-c", "simple-d"],
      },
      packedEvidenceStats: {
        contextMaxTokens: 3000,
        maxChunksPerNote: 2,
        itemCount: 3,
        totalCandidates: 4,
        omittedCandidates: 1,
        itemEvidenceIds: ["simple-a", "simple-b", "simple-d"],
        perNoteCounts: { "note-simple": 2, "note-other": 1 },
      },
    },
  },
  {
    name: "comparison",
    query: "alpha와 beta의 차이를 비교해줘",
    ragMode: "expand",
    scope: projectScope,
    chips: [],
    hits: [
      hit(
        "comparison-a",
        "note-comparison",
        "Alpha vs beta",
        "alpha beta compare",
        { vector: 0.9, bm25: 0.8 },
      ),
      hit(
        "comparison-b",
        "note-comparison",
        "Alpha tradeoffs",
        "alpha tradeoff",
        { vector: 0.82 },
      ),
      hit(
        "comparison-c",
        "note-comparison",
        "Beta tradeoffs",
        "beta tradeoff",
        { bm25: 0.78 },
      ),
      hit(
        "comparison-d",
        "note-comparison",
        "Decision table",
        "compare matrix",
        { graph: 0.74 },
      ),
    ],
    expectedReport: {
      policySummary: {
        route: "comparison",
        reasons: ["explicit_scope", "comparison"],
        retrievalShape: {
          ragMode: "expand",
          resultTopK: 12,
          seedTopK: 12,
          graphDepth: 1,
          graphLimit: 12,
          contextMaxTokens: 6000,
          maxChunksPerNote: 3,
          verifierRequired: true,
        },
      },
      candidateStats: {
        inputCount: 4,
        rerankedCandidateIds: [
          "comparison-a",
          "comparison-b",
          "comparison-c",
          "comparison-d",
        ],
      },
      packedEvidenceStats: {
        contextMaxTokens: 6000,
        maxChunksPerNote: 3,
        itemCount: 3,
        totalCandidates: 4,
        omittedCandidates: 1,
        itemEvidenceIds: ["comparison-a", "comparison-b", "comparison-c"],
        perNoteCounts: { "note-comparison": 3 },
      },
    },
  },
  {
    name: "research",
    query: "alpha 정책의 근거와 출처를 분석해줘",
    ragMode: "expand",
    scope: projectScope,
    chips: [],
    hits: [
      hit(
        "research-a",
        "note-research",
        "Alpha evidence",
        "alpha evidence source",
        { vector: 0.88, bm25: 0.86 },
      ),
      hit("research-b", "note-research", "Alpha source", "source analysis", {
        bm25: 0.78,
      }),
      hit("research-c", "note-research", "Alpha audit", "audit evidence", {
        vector: 0.72,
      }),
      hit("research-d", "note-background", "Background", "background context", {
        graph: 0.7,
      }),
    ],
    expectedReport: {
      policySummary: {
        route: "research",
        reasons: ["explicit_scope", "research_depth"],
        retrievalShape: {
          ragMode: "expand",
          resultTopK: 12,
          seedTopK: 12,
          graphDepth: 1,
          graphLimit: 12,
          contextMaxTokens: 6000,
          maxChunksPerNote: 3,
          verifierRequired: true,
        },
      },
      candidateStats: {
        inputCount: 4,
        rerankedCandidateIds: [
          "research-a",
          "research-b",
          "research-c",
          "research-d",
        ],
      },
      packedEvidenceStats: {
        contextMaxTokens: 6000,
        maxChunksPerNote: 3,
        itemCount: 4,
        totalCandidates: 4,
        omittedCandidates: 0,
        itemEvidenceIds: [
          "research-a",
          "research-b",
          "research-c",
          "research-d",
        ],
        perNoteCounts: { "note-research": 3, "note-background": 1 },
      },
    },
  },
  {
    name: "relationship",
    query: "alpha가 beta와 어떤 관계로 연결되는지 알려줘",
    ragMode: "expand",
    scope: projectScope,
    chips: [],
    hits: [
      hit(
        "relationship-a",
        "note-relation",
        "Alpha beta link",
        "alpha beta relationship",
        { vector: 0.91, graph: 0.8 },
      ),
      hit("relationship-b", "note-relation", "Dependency", "linked dependency", {
        graph: 0.86,
      }),
      hit("relationship-c", "note-relation", "Impact", "impact relation", {
        vector: 0.74,
      }),
      hit(
        "relationship-d",
        "note-relation",
        "Extra relation",
        "related reference",
        { bm25: 0.7 },
      ),
    ],
    expectedReport: {
      policySummary: {
        route: "relationship",
        reasons: ["explicit_scope", "relationship"],
        retrievalShape: {
          ragMode: "expand",
          resultTopK: 12,
          seedTopK: 16,
          graphDepth: 2,
          graphLimit: 18,
          contextMaxTokens: 8000,
          maxChunksPerNote: 3,
          verifierRequired: true,
        },
      },
      candidateStats: {
        inputCount: 4,
        rerankedCandidateIds: [
          "relationship-a",
          "relationship-b",
          "relationship-c",
          "relationship-d",
        ],
      },
      packedEvidenceStats: {
        contextMaxTokens: 8000,
        maxChunksPerNote: 3,
        itemCount: 3,
        totalCandidates: 4,
        omittedCandidates: 1,
        itemEvidenceIds: ["relationship-a", "relationship-b", "relationship-c"],
        perNoteCounts: { "note-relation": 3 },
      },
    },
  },
  {
    name: "multi-hop",
    query: "alpha 결정의 원인과 결과 흐름을 여러 문서에서 추적해줘",
    ragMode: "expand",
    scope: workspaceScope,
    chips: [],
    hits: [
      hit(
        "multi-hop-a",
        "note-chain",
        "Alpha chain",
        "alpha cause effect flow",
        { vector: 0.89, graph: 0.82 },
      ),
      hit("multi-hop-b", "note-chain", "Trace path", "trace path", {
        graph: 0.88,
      }),
      hit("multi-hop-c", "note-chain", "Result", "effect outcome", {
        vector: 0.77,
      }),
      hit("multi-hop-d", "note-chain", "Extra hop", "chain extra", {
        bm25: 0.73,
      }),
    ],
    expectedReport: {
      policySummary: {
        route: "multi_hop",
        reasons: ["multi_hop"],
        retrievalShape: {
          ragMode: "expand",
          resultTopK: 12,
          seedTopK: 16,
          graphDepth: 2,
          graphLimit: 18,
          contextMaxTokens: 8000,
          maxChunksPerNote: 3,
          verifierRequired: true,
        },
      },
      candidateStats: {
        inputCount: 4,
        rerankedCandidateIds: [
          "multi-hop-a",
          "multi-hop-b",
          "multi-hop-c",
          "multi-hop-d",
        ],
      },
      packedEvidenceStats: {
        contextMaxTokens: 8000,
        maxChunksPerNote: 3,
        itemCount: 3,
        totalCandidates: 4,
        omittedCandidates: 1,
        itemEvidenceIds: ["multi-hop-a", "multi-hop-b", "multi-hop-c"],
        perNoteCounts: { "note-chain": 3 },
      },
    },
  },
  {
    name: "workspace fanout",
    query: "workspace 전체에서 alpha 근거를 정리해줘",
    ragMode: "expand",
    scope: workspaceScope,
    chips: [],
    projectCount: 3,
    hits: [
      hit(
        "fanout-a",
        "note-project-a",
        "Project A evidence",
        "alpha evidence",
        { vector: 0.87, bm25: 0.83 },
      ),
      hit(
        "fanout-b",
        "note-project-b",
        "Project B evidence",
        "alpha workspace evidence",
        { vector: 0.84 },
      ),
      hit("fanout-c", "note-project-c", "Project C source", "source summary", {
        bm25: 0.8,
      }),
      hit("fanout-d", "note-project-a", "Project A extra", "extra evidence", {
        graph: 0.72,
      }),
    ],
    expectedReport: {
      policySummary: {
        route: "workspace_fanout",
        reasons: ["research_depth", "workspace_fanout"],
        retrievalShape: {
          ragMode: "expand",
          resultTopK: 12,
          seedTopK: 12,
          graphDepth: 1,
          graphLimit: 12,
          contextMaxTokens: 6000,
          maxChunksPerNote: 1,
          verifierRequired: true,
        },
      },
      candidateStats: {
        inputCount: 4,
        rerankedCandidateIds: ["fanout-a", "fanout-b", "fanout-c", "fanout-d"],
      },
      packedEvidenceStats: {
        contextMaxTokens: 6000,
        maxChunksPerNote: 1,
        itemCount: 3,
        totalCandidates: 4,
        omittedCandidates: 1,
        itemEvidenceIds: ["fanout-a", "fanout-b", "fanout-c"],
        perNoteCounts: {
          "note-project-a": 1,
          "note-project-b": 1,
          "note-project-c": 1,
        },
      },
    },
  },
  {
    name: "workspace fanout project diversity",
    query: "workspace 전체에서 alpha 근거를 정리해줘",
    ragMode: "expand",
    scope: workspaceScope,
    chips: [],
    projectCount: 3,
    hits: [
      hit(
        "fanout-hot-a",
        "note-hot-a",
        "Hot project strongest",
        "alpha evidence strongest",
        { vector: 0.99, bm25: 0.95 },
        "p-hot",
      ),
      hit(
        "fanout-hot-b",
        "note-hot-b",
        "Hot project second",
        "alpha evidence second",
        { vector: 0.98 },
        "p-hot",
      ),
      hit(
        "fanout-hot-c",
        "note-hot-c",
        "Hot project third",
        "alpha evidence third",
        { vector: 0.97 },
        "p-hot",
      ),
      hit(
        "fanout-cold-a",
        "note-cold-a",
        "Cold project evidence",
        "alpha workspace evidence",
        { vector: 0.72 },
        "p-cold-a",
      ),
      hit(
        "fanout-cold-b",
        "note-cold-b",
        "Another project evidence",
        "alpha source summary",
        { bm25: 0.7 },
        "p-cold-b",
      ),
    ],
    expectedReport: {
      policySummary: {
        route: "workspace_fanout",
        reasons: ["research_depth", "workspace_fanout"],
        retrievalShape: {
          ragMode: "expand",
          resultTopK: 12,
          seedTopK: 12,
          graphDepth: 1,
          graphLimit: 12,
          contextMaxTokens: 6000,
          maxChunksPerNote: 1,
          verifierRequired: true,
        },
      },
      packedEvidenceStats: {
        contextMaxTokens: 6000,
        maxChunksPerNote: 1,
        itemCount: 3,
        totalCandidates: 5,
        omittedCandidates: 2,
        itemEvidenceIds: [
          "fanout-hot-a",
          "fanout-cold-a",
          "fanout-cold-b",
        ],
        perNoteCounts: {
          "note-hot-a": 1,
          "note-cold-a": 1,
          "note-cold-b": 1,
        },
      },
    },
  },
];

describe("adaptive RAG eval harness", () => {
  it.each(ADAPTIVE_RAG_EVAL_FIXTURES)(
    "matches the $name golden policy, rerank, and packing shape",
    (fixture) => {
      const report = runAdaptiveRagEvalFixture(fixture);

      expect(report).toMatchObject(fixture.expectedReport);
    },
  );
});

function hit(
  id: string,
  noteId: string,
  title: string,
  snippet: string,
  channelScores: RetrievalCandidate["channelScores"],
  projectId?: string,
): RetrievalHitLike {
  const maxScore = Math.max(
    ...Object.values(channelScores).map((value) => value ?? 0),
  );
  return {
    noteId,
    chunkId: id,
    title,
    headingPath: "Eval",
    snippet,
    score: maxScore,
    channelScores,
    sourceType: "eval-fixture",
    sourceUrl: null,
    updatedAt: "2026-05-04T00:00:00.000Z",
    provenance: channelScores.graph != null ? "inferred" : "extracted",
    producer: { kind: "api", tool: "adaptive-rag-eval-harness" },
    confidence: maxScore,
    sourceSpan: null,
    evidenceId: id,
    support: channelScores.graph != null ? "mentions" : "supports",
    ...(projectId ? { projectId } : {}),
  } as RetrievalHitLike;
}
