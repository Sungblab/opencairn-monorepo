import { db, sql } from "@opencairn/db";

const RRF_K = 60;
const SNIPPET_MAX = 400;

export type HybridHit = {
  noteId: string;
  title: string;
  snippet: string;
  sourceType: string | null;
  sourceUrl: string | null;
  vectorScore: number | null;
  bm25Score: number | null;
  rrfScore: number;
};

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function clipSnippet(text: string | null): string {
  if (!text) return "";
  // Slice to a 2× buffer first to avoid regexing the entire content_text;
  // worst-case-relevant content is in the head of the field.
  const buffer = text.slice(0, SNIPPET_MAX * 2);
  const compact = buffer.replace(/\s+/g, " ").trim();
  return compact.length > SNIPPET_MAX
    ? compact.slice(0, SNIPPET_MAX) + "…"
    : compact;
}

export type HybridSearchOpts = {
  projectId: string;
  queryText: string;
  queryEmbedding: number[];
  k: number;
};

export async function projectHybridSearch(opts: HybridSearchOpts): Promise<HybridHit[]> {
  const { projectId, queryText, queryEmbedding, k } = opts;
  const vec = vectorLiteral(queryEmbedding);
  const fetchLimit = k * 2;

  const [vectorRowsRaw, bm25RowsRaw] = await Promise.all([
    db.execute(sql`
      SELECT
        id,
        title,
        content_text,
        source_type,
        source_url,
        1 - (embedding <=> ${vec}::vector) AS score
      FROM notes
      WHERE project_id = ${projectId}
        AND deleted_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vec}::vector ASC
      LIMIT ${fetchLimit}
    `),
    db.execute(sql`
      SELECT
        id,
        title,
        content_text,
        source_type,
        source_url,
        ts_rank(content_tsv, plainto_tsquery('simple', ${queryText})) AS score
      FROM notes
      WHERE project_id = ${projectId}
        AND deleted_at IS NULL
        AND content_tsv @@ plainto_tsquery('simple', ${queryText})
      ORDER BY score DESC
      LIMIT ${fetchLimit}
    `),
  ]);
  const vectorRows =
    (vectorRowsRaw as unknown as { rows: Array<Record<string, unknown>> })
      .rows ?? (vectorRowsRaw as unknown as Array<Record<string, unknown>>);
  const bm25Rows =
    (bm25RowsRaw as unknown as { rows: Array<Record<string, unknown>> })
      .rows ?? (bm25RowsRaw as unknown as Array<Record<string, unknown>>);

  const hits = new Map<string, HybridHit>();
  const rrf = new Map<string, number>();

  const addRow = (
    row: Record<string, unknown>,
    rank: number,
    channel: "vector" | "bm25",
  ) => {
    const noteId = String(row.id);
    const existing = hits.get(noteId);
    const rawScore = Number(row.score ?? 0);
    if (!existing) {
      hits.set(noteId, {
        noteId,
        title: String(row.title ?? "Untitled"),
        snippet: clipSnippet(row.content_text as string | null),
        sourceType: (row.source_type as string | null) ?? null,
        sourceUrl: (row.source_url as string | null) ?? null,
        vectorScore: channel === "vector" ? rawScore : null,
        bm25Score: channel === "bm25" ? rawScore : null,
        rrfScore: 0,
      });
    } else if (channel === "vector") {
      existing.vectorScore = rawScore;
    } else {
      existing.bm25Score = rawScore;
    }
    rrf.set(noteId, (rrf.get(noteId) ?? 0) + 1 / (RRF_K + rank));
  };

  vectorRows.forEach((r, i) => addRow(r, i + 1, "vector"));
  bm25Rows.forEach((r, i) => addRow(r, i + 1, "bm25"));

  for (const [noteId, score] of rrf.entries()) {
    const hit = hits.get(noteId);
    if (hit) hit.rrfScore = score;
  }

  return Array.from(hits.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, k);
}
