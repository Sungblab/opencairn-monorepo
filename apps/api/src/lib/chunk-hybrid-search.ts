import { db, sql } from "@opencairn/db";

const RRF_K = 60;
const SNIPPET_MAX = 500;

export type ChunkHybridHit = {
  chunkId: string;
  noteId: string;
  title: string;
  headingPath: string;
  snippet: string;
  vectorScore: number | null;
  bm25Score: number | null;
  rrfScore: number;
};

export type ChunkHybridSearchOpts = {
  projectId: string;
  queryText: string;
  queryEmbedding: number[];
  k: number;
};

type SearchRow = Record<string, unknown>;

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function rowsOf(raw: unknown): SearchRow[] {
  return (
    (raw as { rows?: SearchRow[] }).rows ?? (raw as SearchRow[] | undefined) ?? []
  );
}

function clipSnippet(text: string | null): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  return compact.length > SNIPPET_MAX
    ? compact.slice(0, SNIPPET_MAX) + "..."
    : compact;
}

export async function projectChunkHybridSearch(
  opts: ChunkHybridSearchOpts,
): Promise<ChunkHybridHit[]> {
  const vec = vectorLiteral(opts.queryEmbedding);
  const fetchLimit = opts.k * 3;

  const [vectorRowsRaw, bm25RowsRaw] = await Promise.all([
    db.execute(sql`
      SELECT
        c.id,
        c.note_id,
        n.title,
        c.heading_path,
        c.content_text,
        1 - (c.embedding <=> ${vec}::vector) AS score
      FROM note_chunks c
      JOIN notes n ON n.id = c.note_id
      WHERE c.project_id = ${opts.projectId}
        AND c.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vec}::vector ASC
      LIMIT ${fetchLimit}
    `),
    db.execute(sql`
      SELECT
        c.id,
        c.note_id,
        n.title,
        c.heading_path,
        c.content_text,
        ts_rank(c.content_tsv, plainto_tsquery('simple', ${opts.queryText})) AS score
      FROM note_chunks c
      JOIN notes n ON n.id = c.note_id
      WHERE c.project_id = ${opts.projectId}
        AND c.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND c.content_tsv @@ plainto_tsquery('simple', ${opts.queryText})
      ORDER BY score DESC
      LIMIT ${fetchLimit}
    `),
  ]);

  const hits = new Map<string, ChunkHybridHit>();
  const rrf = new Map<string, number>();

  function add(row: SearchRow, rank: number, channel: "vector" | "bm25") {
    const chunkId = String(row.id);
    const rawScore = Number(row.score ?? 0);
    const existing = hits.get(chunkId);
    if (!existing) {
      hits.set(chunkId, {
        chunkId,
        noteId: String(row.note_id),
        title: String(row.title ?? "Untitled"),
        headingPath: String(row.heading_path ?? ""),
        snippet: clipSnippet(row.content_text as string | null),
        vectorScore: channel === "vector" ? rawScore : null,
        bm25Score: channel === "bm25" ? rawScore : null,
        rrfScore: 0,
      });
    } else if (channel === "vector") {
      existing.vectorScore = rawScore;
    } else {
      existing.bm25Score = rawScore;
    }
    rrf.set(chunkId, (rrf.get(chunkId) ?? 0) + 1 / (RRF_K + rank));
  }

  rowsOf(vectorRowsRaw).forEach((row, index) =>
    add(row, index + 1, "vector"),
  );
  rowsOf(bm25RowsRaw).forEach((row, index) => add(row, index + 1, "bm25"));

  for (const [chunkId, score] of rrf) {
    const hit = hits.get(chunkId);
    if (hit) hit.rrfScore = score;
  }

  return Array.from(hits.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, opts.k);
}
