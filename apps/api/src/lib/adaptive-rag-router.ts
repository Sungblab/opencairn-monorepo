import { envInt } from "./env";
import type { RagMode, RetrievalChip, RetrievalScope } from "./chat-retrieval";

export type AdaptiveRagReason =
  | "rag_off"
  | "strict_mode"
  | "explicit_scope"
  | "simple_query"
  | "comparison"
  | "relationship"
  | "multi_hop"
  | "research_depth"
  | "workspace_fanout";

export type AdaptiveRagPolicy = {
  ragMode: RagMode;
  resultTopK: number;
  seedTopK: number;
  graphDepth: 0 | 1 | 2;
  graphLimit: number;
  contextMaxTokens: number;
  maxChunksPerNote: number;
  verifierRequired: boolean;
  reasons: AdaptiveRagReason[];
};

export type AdaptiveRagRoute =
  | "off"
  | "strict"
  | "simple"
  | "comparison"
  | "research"
  | "relationship"
  | "multi_hop"
  | "workspace_fanout";

export type AdaptiveRagPolicySummary = {
  route: AdaptiveRagRoute;
  reasons: AdaptiveRagReason[];
  retrievalShape: Pick<
    AdaptiveRagPolicy,
    | "ragMode"
    | "resultTopK"
    | "seedTopK"
    | "graphDepth"
    | "graphLimit"
    | "contextMaxTokens"
    | "maxChunksPerNote"
    | "verifierRequired"
  >;
};

const RELATIONSHIP_RE =
  /(관련|연결|관계|영향|의존|참조|링크|연관|이어지|연결된|related|relation|relationship|link|linked|dependency|depends|influence|impact)/i;

const MULTI_HOP_RE =
  /(왜|어떻게|흐름|경로|원인|결과|추적|따라가|연쇄|여러 문서|전체 문서|across|trace|path|flow|why|how|cause|effect|chain|multi-hop|multihop)/i;

const COMPARISON_RE =
  /(비교|차이|대비|장단점|선택|우선순위|compare|comparison|versus|vs\.?|difference|trade-?off|pros and cons|priority)/i;

const RESEARCH_RE =
  /(조사|분석|근거|출처|요약해줘|정리해줘|research|investigate|analysis|evidence|source|summari[sz]e)/i;

const SIMPLE_LOOKUP_RE =
  /^(뭐야|무엇|정의|뜻|요약|찾아줘|보여줘|what is|define|show|find|summarize)\b/i;

export function planAdaptiveRagPolicy(input: {
  query: string;
  ragMode: RagMode;
  scope: RetrievalScope;
  chips: RetrievalChip[];
  projectCount?: number;
}): AdaptiveRagPolicy {
  const resultTopK = topK(input.ragMode);
  if (input.ragMode === "off") {
    return {
      ragMode: "off",
      resultTopK: 0,
      seedTopK: 0,
      graphDepth: 0,
      graphLimit: 0,
      contextMaxTokens: 0,
      maxChunksPerNote: 0,
      verifierRequired: false,
      reasons: ["rag_off"],
    };
  }

  const query = input.query.trim();
  const explicitScope =
    input.chips.length > 0 ||
    input.scope.type === "page" ||
    input.scope.type === "project";
  const relationship = RELATIONSHIP_RE.test(query);
  const multiHop = MULTI_HOP_RE.test(query);
  const comparison = COMPARISON_RE.test(query);
  const researchDepth = RESEARCH_RE.test(query);
  const workspaceFanout =
    input.scope.type === "workspace" && (input.projectCount ?? 0) > 1;
  const simpleQuery =
    query.length < 80 &&
    !relationship &&
    !multiHop &&
    !comparison &&
    !researchDepth &&
    (SIMPLE_LOOKUP_RE.test(query) || query.split(/\s+/).length <= 8);

  const reasons = new Set<AdaptiveRagReason>();
  if (input.ragMode === "strict") reasons.add("strict_mode");
  if (explicitScope) reasons.add("explicit_scope");
  if (simpleQuery) reasons.add("simple_query");
  if (comparison) reasons.add("comparison");
  if (relationship) reasons.add("relationship");
  if (multiHop) reasons.add("multi_hop");
  if (researchDepth) reasons.add("research_depth");
  if (workspaceFanout) reasons.add("workspace_fanout");

  const graphDepth = chooseGraphDepth({
    ragMode: input.ragMode,
    relationship,
    multiHop,
    comparison,
    researchDepth,
    simpleQuery,
  });

  const seedTopK =
    graphDepth === 2
      ? Math.max(resultTopK, envInt("CHAT_RAG_ADAPTIVE_DEEP_SEED_K", 16))
      : resultTopK;
  const graphLimit =
    graphDepth === 0
      ? 0
      : graphDepth === 2
        ? Math.max(seedTopK, envInt("CHAT_RAG_ADAPTIVE_DEEP_GRAPH_LIMIT", 18))
        : Math.max(seedTopK, envInt("CHAT_RAG_ADAPTIVE_GRAPH_LIMIT", 10));

  return {
    ragMode: input.ragMode,
    resultTopK,
    seedTopK,
    graphDepth,
    graphLimit,
    contextMaxTokens: contextBudget({
      graphDepth,
      researchDepth,
      comparison,
      workspaceFanout,
    }),
    maxChunksPerNote: maxChunksPerNote({
      graphDepth,
      researchDepth,
      comparison,
      workspaceFanout,
    }),
    verifierRequired:
      graphDepth > 0 || comparison || researchDepth || workspaceFanout,
    reasons: Array.from(reasons),
  };
}

export function summarizeAdaptiveRagPolicy(
  policy: AdaptiveRagPolicy,
): AdaptiveRagPolicySummary {
  return {
    route: routeForPolicy(policy),
    reasons: policy.reasons,
    retrievalShape: {
      ragMode: policy.ragMode,
      resultTopK: policy.resultTopK,
      seedTopK: policy.seedTopK,
      graphDepth: policy.graphDepth,
      graphLimit: policy.graphLimit,
      contextMaxTokens: policy.contextMaxTokens,
      maxChunksPerNote: policy.maxChunksPerNote,
      verifierRequired: policy.verifierRequired,
    },
  };
}

function routeForPolicy(policy: AdaptiveRagPolicy): AdaptiveRagRoute {
  if (policy.ragMode === "off" || policy.reasons.includes("rag_off")) {
    return "off";
  }
  if (policy.ragMode === "strict" || policy.reasons.includes("strict_mode")) {
    return "strict";
  }
  if (policy.reasons.includes("workspace_fanout")) {
    return "workspace_fanout";
  }
  if (policy.reasons.includes("multi_hop")) {
    return "multi_hop";
  }
  if (policy.reasons.includes("relationship")) {
    return "relationship";
  }
  if (policy.reasons.includes("comparison")) {
    return "comparison";
  }
  if (policy.reasons.includes("research_depth")) {
    return "research";
  }
  return "simple";
}

function chooseGraphDepth(input: {
  ragMode: RagMode;
  relationship: boolean;
  multiHop: boolean;
  comparison: boolean;
  researchDepth: boolean;
  simpleQuery: boolean;
}): 0 | 1 | 2 {
  if (input.ragMode !== "expand") return 0;
  if (input.simpleQuery) return 0;
  if (input.relationship || input.multiHop) return 2;
  if (input.comparison || input.researchDepth) return 1;
  return 0;
}

function contextBudget(input: {
  graphDepth: 0 | 1 | 2;
  researchDepth: boolean;
  comparison: boolean;
  workspaceFanout: boolean;
}): number {
  if (input.graphDepth === 2) {
    return envInt("CHAT_RAG_ADAPTIVE_DEEP_CONTEXT_TOKENS", 8000);
  }
  if (
    input.graphDepth === 1 ||
    input.comparison ||
    input.researchDepth ||
    input.workspaceFanout
  ) {
    return envInt("CHAT_RAG_ADAPTIVE_CONTEXT_TOKENS", 6000);
  }
  return envInt("CHAT_RAG_ADAPTIVE_SIMPLE_CONTEXT_TOKENS", 3000);
}

function maxChunksPerNote(input: {
  graphDepth: 0 | 1 | 2;
  researchDepth: boolean;
  comparison: boolean;
  workspaceFanout: boolean;
}): number {
  if (input.workspaceFanout) return 1;
  if (input.graphDepth === 2) return 3;
  if (input.comparison || input.researchDepth) return 3;
  return 2;
}

function topK(mode: RagMode): number {
  if (mode === "off") return 0;
  if (mode === "strict") return envInt("CHAT_RAG_TOP_K_STRICT", 5);
  return envInt("CHAT_RAG_TOP_K_EXPAND", 12);
}
