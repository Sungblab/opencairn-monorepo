import type { LLMProvider } from "./llm/provider";
import type { RetrievalCandidate } from "./retrieval-candidates";

const MAX_PROVIDER_RERANK_CANDIDATES = 30;

export function providerRerankerEnabled(): boolean {
  return (
    (process.env.CHAT_RAG_RERANKER ?? "").trim().toLowerCase() === "provider"
  );
}

export async function rerankCandidatesWithProvider(input: {
  query: string;
  candidates: RetrievalCandidate[];
  provider: LLMProvider;
  signal?: AbortSignal;
}): Promise<RetrievalCandidate[]> {
  if (input.candidates.length <= 1) return input.candidates;
  const candidates = input.candidates.slice(0, MAX_PROVIDER_RERANK_CANDIDATES);
  try {
    let text = "";
    for await (const chunk of input.provider.streamGenerate({
      messages: [
        {
          role: "system",
          content:
            "Rank the evidence ids by usefulness for answering the query. Return only JSON: {\"rankedIds\":[\"id\"]}.",
        },
        {
          role: "user",
          content: providerRerankPrompt(input.query, candidates),
        },
      ],
      temperature: 0,
      maxOutputTokens: 512,
      signal: input.signal,
    })) {
      if ("delta" in chunk) text += chunk.delta;
    }
    const rankedIds = parseProviderRerankIds(text);
    return rankedIds.length === 0
      ? input.candidates
      : [
          ...applyProviderRerankIds({ candidates, rankedIds }),
          ...input.candidates.slice(MAX_PROVIDER_RERANK_CANDIDATES),
        ];
  } catch {
    return input.candidates;
  }
}

export function parseProviderRerankIds(text: string): string[] {
  const json = extractJson(text);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    if (parsed && typeof parsed === "object") {
      const rankedIds = (parsed as { rankedIds?: unknown }).rankedIds;
      if (Array.isArray(rankedIds)) {
        return rankedIds.filter(
          (item): item is string => typeof item === "string",
        );
      }
    }
  } catch {
    return [];
  }
  return [];
}

export function applyProviderRerankIds(input: {
  candidates: RetrievalCandidate[];
  rankedIds: string[];
}): RetrievalCandidate[] {
  const byId = new Map(
    input.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const seen = new Set<string>();
  const ranked: RetrievalCandidate[] = [];
  for (const id of input.rankedIds) {
    const candidate = byId.get(id);
    if (!candidate || seen.has(id)) continue;
    ranked.push(candidate);
    seen.add(id);
  }
  return [
    ...ranked,
    ...input.candidates.filter((candidate) => !seen.has(candidate.id)),
  ];
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return trimmed;
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }
  return null;
}

function providerRerankPrompt(
  query: string,
  candidates: RetrievalCandidate[],
): string {
  return [
    `Query: ${query}`,
    "Evidence:",
    ...candidates.map((candidate) =>
      [
        `id=${candidate.id}`,
        `title=${candidate.title}`,
        candidate.headingPath ? `heading=${candidate.headingPath}` : null,
        `confidence=${candidate.confidence.toFixed(2)}`,
        `support=${candidate.support}`,
        `snippet=${candidate.snippet.slice(0, 600)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}
