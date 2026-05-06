import { db, sql } from "@opencairn/db";
import { clamp01 } from "./retrieval-candidates";

const SNIPPET_MAX = 500;

export type GraphExpansionHit = {
  noteId: string;
  chunkId: string | null;
  title: string;
  headingPath: string;
  snippet: string;
  graphScore: number;
  sourceType: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
  graphPath: string | null;
};

export type GraphExpansionOpts = {
  workspaceId: string;
  projectId: string;
  seedNoteIds: string[];
  maxDepth?: 1 | 2;
  limit?: number;
};

type GraphExpansionRow = Record<string, unknown>;

function rowsOf(raw: unknown): GraphExpansionRow[] {
  return (
    (raw as { rows?: GraphExpansionRow[] }).rows ??
    (raw as GraphExpansionRow[] | undefined) ??
    []
  );
}

function clipSnippet(text: unknown): string {
  const buffer = String(text ?? "").slice(0, SNIPPET_MAX * 2);
  const compact = buffer.replace(/\s+/g, " ").trim();
  return compact.length > SNIPPET_MAX
    ? compact.slice(0, SNIPPET_MAX) + "..."
    : compact;
}

function dateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function expandGraphCandidates(
  opts: GraphExpansionOpts,
): Promise<GraphExpansionHit[]> {
  if (opts.seedNoteIds.length === 0) return [];

  const maxDepth = opts.maxDepth ?? 2;
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));

  const rowsRaw = await db.execute(sql`
    WITH RECURSIVE seed_concepts AS (
      SELECT DISTINCT cn.concept_id
      FROM concept_notes cn
      JOIN concepts seed_c
        ON seed_c.id = cn.concept_id
       AND seed_c.project_id = ${opts.projectId}
      JOIN notes n
        ON n.id = cn.note_id
       AND n.workspace_id = ${opts.workspaceId}
       AND n.project_id = ${opts.projectId}
       AND n.deleted_at IS NULL
      WHERE cn.note_id = ANY(${opts.seedNoteIds})
    ),
    expanded(concept_id, depth, path_text) AS (
      SELECT seed_c.id, 0, seed_c.name
      FROM seed_concepts sc
      JOIN concepts seed_c
        ON seed_c.id = sc.concept_id
       AND seed_c.project_id = ${opts.projectId}
      UNION ALL
      SELECT
        neighbor.id AS concept_id,
        expanded.depth + 1 AS depth,
        expanded.path_text || ' --[' || ce.relation_type || ']--> ' || neighbor.name AS path_text
      FROM expanded
      JOIN concept_edges ce
        ON ce.source_id = expanded.concept_id
        OR ce.target_id = expanded.concept_id
      JOIN concepts neighbor
        ON neighbor.id = CASE
          WHEN ce.source_id = expanded.concept_id THEN ce.target_id
          ELSE ce.source_id
        END
       AND neighbor.project_id = ${opts.projectId}
      WHERE expanded.depth < ${maxDepth}
    )
    SELECT
      n.id AS note_id,
      c.id AS chunk_id,
      n.title,
      COALESCE(c.heading_path, '') AS heading_path,
      COALESCE(c.content_text, n.content_text, '') AS content_text,
      n.source_type,
      n.source_url,
      n.updated_at,
      MAX(1.0 / (1 + expanded.depth)) AS graph_score,
      MIN(expanded.path_text) FILTER (WHERE expanded.depth > 0) AS graph_path
    FROM expanded
    JOIN concept_notes cn
      ON cn.concept_id = expanded.concept_id
    JOIN notes n
      ON n.id = cn.note_id
     AND n.workspace_id = ${opts.workspaceId}
     AND n.project_id = ${opts.projectId}
     AND n.deleted_at IS NULL
    LEFT JOIN note_chunks c
      ON c.note_id = n.id
     AND c.workspace_id = ${opts.workspaceId}
     AND c.project_id = ${opts.projectId}
     AND c.deleted_at IS NULL
    WHERE NOT (n.id = ANY(${opts.seedNoteIds}))
    GROUP BY
      n.id,
      c.id
    ORDER BY graph_score DESC, n.updated_at DESC
    LIMIT ${limit}
  `);

  return rowsOf(rowsRaw).map((row) => ({
    noteId: String(row.note_id),
    chunkId: row.chunk_id == null ? null : String(row.chunk_id),
    title: String(row.title ?? "Untitled"),
    headingPath: String(row.heading_path ?? ""),
    snippet: clipSnippet(row.content_text),
    graphScore: clamp01(Number(row.graph_score ?? 0)),
    sourceType: row.source_type == null ? null : String(row.source_type),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    updatedAt: dateString(row.updated_at),
    graphPath: row.graph_path == null ? null : String(row.graph_path),
  }));
}
