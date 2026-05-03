import type {
  RetrievalCandidate,
  RetrievalChannel,
} from "./retrieval-candidates";

const CHANNEL_WEIGHTS = {
  vector: 1,
  bm25: 1,
  graph: 0.85,
  active_context: 0.7,
} satisfies Record<RetrievalChannel, number>;

export function rerankCandidates(input: {
  query: string;
  candidates: RetrievalCandidate[];
}): RetrievalCandidate[] {
  const terms = termsOf(input.query);

  return input.candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidate(candidate, terms),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.candidate);
}

function scoreCandidate(candidate: RetrievalCandidate, terms: string[]): number {
  const base = (
    Object.entries(candidate.channelScores) as Array<
      [RetrievalChannel, number | undefined]
    >
  ).reduce(
    (sum, [channel, value]) => sum + (value ?? 0) * CHANNEL_WEIGHTS[channel],
    0,
  );
  const haystack =
    `${candidate.title} ${candidate.headingPath} ${candidate.snippet}`.toLowerCase();
  const overlap = terms.filter((term) => haystack.includes(term)).length;
  const multiChannelBoost =
    Object.keys(candidate.channelScores).filter(
      (channel) =>
        candidate.channelScores[
          channel as keyof typeof candidate.channelScores
        ] != null,
    ).length > 1
      ? 0.25
      : 0;
  const provenanceBoost =
    candidate.provenance === "extracted"
      ? 0.25
      : candidate.provenance === "inferred"
        ? 0.1
        : -0.15;
  const supportBoost =
    candidate.support === "supports"
      ? 0.1
      : candidate.support === "contradicts"
        ? -0.1
        : 0;

  return (
    base +
    overlap * 0.2 +
    multiChannelBoost +
    provenanceBoost +
    candidate.confidence * 0.3 +
    supportBoost
  );
}

function termsOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}
