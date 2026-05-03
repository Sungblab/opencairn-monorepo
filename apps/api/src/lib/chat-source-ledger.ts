export type ChatSourceProducer = "retrieval" | "vector" | "bm25" | "graph" | "manual";

export type ChatSourceLedgerInput = {
  id?: string;
  noteId?: string;
  noteChunkId?: string;
  chunkId?: string;
  title?: string;
  headingPath?: string | null;
  snippet?: string;
  quote?: string;
  contentText?: string;
  score?: number;
  channel?: ChatSourceProducer;
  retrievalChannel?: ChatSourceProducer;
  producer?: ChatSourceProducer | string;
  provenance?: {
    noteId?: string;
    noteChunkId?: string;
    chunkId?: string;
    title?: string;
    headingPath?: string | null;
    quote?: string;
    snippet?: string;
  };
};

export type ChatSourceLedgerEntry = {
  label: string;
  sourceId: string;
  noteId: string | null;
  noteChunkId: string | null;
  title: string;
  headingPath: string | null;
  quote: string;
  score: number | null;
  producer: string;
};

export type ChatSourceLedger = {
  entries: ChatSourceLedgerEntry[];
  byLabel: Map<string, ChatSourceLedgerEntry>;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sourceKey(input: ChatSourceLedgerInput, index: number): string {
  const noteChunkId =
    input.noteChunkId ?? input.chunkId ?? input.provenance?.noteChunkId ?? input.provenance?.chunkId;
  if (noteChunkId) return `chunk:${noteChunkId}`;
  const noteId = input.noteId ?? input.provenance?.noteId;
  if (noteId) return `note:${noteId}`;
  const fallbackParts = [
    input.id,
    input.quote,
    input.snippet,
    input.contentText,
    input.provenance?.quote,
    input.provenance?.snippet,
    input.title,
    input.provenance?.title,
  ]
    .map(cleanText)
    .filter(Boolean);
  return `source:${fallbackParts.length > 0 ? fallbackParts.join(":") : index}`;
}

function entryFromInput(input: ChatSourceLedgerInput, index: number): ChatSourceLedgerEntry {
  const provenance = input.provenance;
  const noteId = input.noteId ?? provenance?.noteId ?? null;
  const noteChunkId =
    input.noteChunkId ?? input.chunkId ?? provenance?.noteChunkId ?? provenance?.chunkId ?? null;
  const title = cleanText(input.title ?? provenance?.title) || "Untitled source";
  const headingPath = input.headingPath ?? provenance?.headingPath ?? null;
  const quote =
    cleanText(input.quote ?? provenance?.quote ?? input.snippet ?? provenance?.snippet ?? input.contentText) ||
    title;

  return {
    label: `S${index + 1}`,
    sourceId: sourceKey(input, index),
    noteId,
    noteChunkId,
    title,
    headingPath,
    quote,
    score: typeof input.score === "number" ? input.score : null,
    producer: String(input.producer ?? input.retrievalChannel ?? input.channel ?? "retrieval"),
  };
}

export function buildChatSourceLedger(
  sources: ChatSourceLedgerInput[],
  opts: { maxSources?: number } = {},
): ChatSourceLedger {
  const maxSources = Math.max(0, opts.maxSources ?? sources.length);
  const deduped = new Map<string, ChatSourceLedgerInput>();
  for (const source of sources) {
    if (deduped.size >= maxSources) break;
    const key = sourceKey(source, deduped.size);
    if (!deduped.has(key)) deduped.set(key, source);
  }

  const entries = Array.from(deduped.values()).map(entryFromInput);
  return {
    entries,
    byLabel: new Map(entries.map((entry) => [entry.label, entry])),
  };
}

export function formatChatSourceLedgerForPrompt(ledger: ChatSourceLedger): string {
  return ledger.entries
    .map((entry) => {
      const heading = entry.headingPath ? ` · ${entry.headingPath}` : "";
      return `[${entry.label}] ${entry.title}${heading}: ${entry.quote}`;
    })
    .join("\n");
}
