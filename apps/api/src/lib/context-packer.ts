import type {
  EvidenceBundle,
  EvidenceItem,
  RetrievalCandidate,
  SourceSpan,
} from "./retrieval-candidates";

const ESTIMATED_CHARS_PER_TOKEN = 2;
const ESTIMATED_METADATA_TOKENS_PER_ITEM = 32;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN));
}

export function packEvidence(input: {
  candidates: RetrievalCandidate[];
  maxTokens: number;
  maxChunksPerNote?: number;
}): EvidenceBundle {
  const maxChunksPerNote = input.maxChunksPerNote ?? 2;
  const perNote = new Map<string, number>();
  const items: EvidenceItem[] = [];
  let totalEstimatedTokens = 0;

  for (const candidate of input.candidates) {
    const noteCount = perNote.get(candidate.noteId) ?? 0;
    if (noteCount >= maxChunksPerNote) continue;

    const cost =
      estimateTokens(
        `${candidate.title}\n${candidate.headingPath}\n${candidate.snippet}`,
      ) + ESTIMATED_METADATA_TOKENS_PER_ITEM;
    if (totalEstimatedTokens + cost > input.maxTokens) continue;

    items.push({
      citationIndex: items.length + 1,
      noteId: candidate.noteId,
      chunkId: candidate.chunkId,
      title: candidate.title,
      headingPath: candidate.headingPath,
      snippet: candidate.snippet,
      sourceType: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
      provenance: candidate.provenance,
      producer: candidate.producer,
      confidence: candidate.confidence,
      sourceSpan: candidate.sourceSpan,
      evidenceId: candidate.evidenceId,
      support: candidate.support,
    });
    totalEstimatedTokens += cost;
    perNote.set(candidate.noteId, noteCount + 1);
  }

  return {
    items,
    totalEstimatedTokens,
    totalCandidates: input.candidates.length,
    omittedCandidates: input.candidates.length - items.length,
  };
}

export function evidenceBundleToPrompt(bundle: EvidenceBundle): string {
  if (bundle.items.length === 0) return "";
  return [
    "<context>",
    ...bundle.items.map((item) => {
      const heading = item.headingPath ? ` · ${item.headingPath}` : "";
      return [
        `[${item.citationIndex}] ${item.title}${heading}`,
        metadataLine(item),
        item.snippet,
      ].join("\n");
    }),
    "</context>",
  ].join("\n\n");
}

function metadataLine(item: EvidenceItem): string {
  return [
    `evidenceId=${item.evidenceId}`,
    `provenance=${item.provenance}`,
    `confidence=${formatConfidence(item.confidence)}`,
    `producer=${formatProducer(item.producer)}`,
    `support=${item.support}`,
    item.sourceSpan ? `span=${formatSpan(item.sourceSpan)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatConfidence(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatProducer(producer: EvidenceItem["producer"]): string {
  return [
    producer.kind,
    producer.runId ? `run:${producer.runId}` : null,
    producer.model ? `model:${producer.model}` : null,
    producer.tool ? `tool:${producer.tool}` : null,
  ]
    .filter(Boolean)
    .join("/");
}

function formatSpan(span: SourceSpan): string {
  const prefix = span.locator ? `${span.locator}:` : "";
  return `${prefix}${span.start}-${span.end}`;
}
