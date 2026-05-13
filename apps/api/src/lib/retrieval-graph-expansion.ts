import { db, sql } from "@opencairn/db";
import { clamp01 } from "./retrieval-candidates";

const SNIPPET_MAX = 500;
const PREDICATE_STEP_WEIGHTS = {
  dependsOn: 1.0,
  isA: 0.95,
  partOf: 0.92,
  contains: 0.9,
  causes: 0.88,
  derivedFrom: 0.84,
  sameAsCandidate: 0.78,
  related: 0.58,
  nearInSource: 0.36,
  appearsWith: 0.28,
  fallback: 0.5,
} as const;
const EDGE_DIRECTION_WEIGHTS = {
  forward: 1.0,
  reverseSemantic: 0.62,
  reverseAssociative: 0.78,
} as const;

export type GraphExpansionHit = {
  noteId: string;
  chunkId: string | null;
  title: string;
  headingPath: string;
  snippet: string;
  graphScore: number;
  ontologyPathScore: number;
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
    expanded(concept_id, depth, path_ids, path_text, path_score) AS (
      SELECT
        seed_c.id,
        0,
        ARRAY[seed_c.id],
        seed_c.name,
        1.0::double precision
      FROM seed_concepts sc
      JOIN concepts seed_c
        ON seed_c.id = sc.concept_id
       AND seed_c.project_id = ${opts.projectId}
      UNION ALL
      SELECT
        neighbor.id AS concept_id,
        expanded.depth + 1 AS depth,
        expanded.path_ids || ARRAY[neighbor.id],
        expanded.path_text ||
          CASE
            WHEN ce.source_id = expanded.concept_id
              THEN ' --[' || relation.ontology_predicate || ',w=' ||
                ROUND(weight.step_weight::numeric, 2)::text || ']--> '
            ELSE ' <--[' || relation.ontology_predicate || ',w=' ||
                ROUND(weight.step_weight::numeric, 2)::text || ']-- '
          END ||
          neighbor.name AS path_text,
        expanded.path_score * weight.step_weight AS path_score
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
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN ce.relation_type IN ('is_a', 'is-a', 'type-of', 'kind-of')
            THEN 'is_a'
          WHEN ce.relation_type IN ('part_of', 'part-of', 'component-of')
            THEN 'part_of'
          WHEN ce.relation_type IN ('contains', 'includes', 'has-part')
            THEN 'contains'
          WHEN ce.relation_type IN ('depends_on', 'depends-on', 'requires', 'prerequisite')
            THEN 'depends_on'
          WHEN ce.relation_type IN ('causes', 'leads-to', 'produces')
            THEN 'causes'
          WHEN ce.relation_type IN ('derived_from', 'derived-from', 'materializes')
            THEN 'derived_from'
          WHEN ce.relation_type IN ('same_as_candidate', 'same-as-candidate', 'synonym', 'duplicate')
            THEN 'same_as_candidate'
          WHEN ce.relation_type IN ('co-mentioned', 'co-mention', 'co-occurs', 'co_occurs')
            THEN 'appears_with'
          WHEN ce.relation_type IN ('source-proximity', 'source_membership', 'near-in-source')
            THEN 'near_in_source'
          WHEN ce.relation_type IN ('related-to', 'related_to', 'related', 'is_related_to')
            THEN 'is_related_to'
          ELSE 'is_related_to'
        END AS ontology_predicate
      ) relation
      CROSS JOIN LATERAL (
        SELECT (
          CASE relation.ontology_predicate
            WHEN 'depends_on' THEN ${PREDICATE_STEP_WEIGHTS.dependsOn}
            WHEN 'is_a' THEN ${PREDICATE_STEP_WEIGHTS.isA}
            WHEN 'part_of' THEN ${PREDICATE_STEP_WEIGHTS.partOf}
            WHEN 'contains' THEN ${PREDICATE_STEP_WEIGHTS.contains}
            WHEN 'causes' THEN ${PREDICATE_STEP_WEIGHTS.causes}
            WHEN 'derived_from' THEN ${PREDICATE_STEP_WEIGHTS.derivedFrom}
            WHEN 'same_as_candidate' THEN ${PREDICATE_STEP_WEIGHTS.sameAsCandidate}
            WHEN 'is_related_to' THEN ${PREDICATE_STEP_WEIGHTS.related}
            WHEN 'near_in_source' THEN ${PREDICATE_STEP_WEIGHTS.nearInSource}
            WHEN 'appears_with' THEN ${PREDICATE_STEP_WEIGHTS.appearsWith}
            ELSE ${PREDICATE_STEP_WEIGHTS.fallback}
          END *
          CASE
            WHEN ce.source_id = expanded.concept_id THEN ${EDGE_DIRECTION_WEIGHTS.forward}
            WHEN relation.ontology_predicate IN ('depends_on', 'causes', 'derived_from')
              THEN ${EDGE_DIRECTION_WEIGHTS.reverseSemantic}
            ELSE ${EDGE_DIRECTION_WEIGHTS.reverseAssociative}
          END
        )::double precision AS step_weight
      ) weight
      WHERE expanded.depth < ${maxDepth}
        AND NOT neighbor.id = ANY(expanded.path_ids)
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
      MAX(expanded.path_score / (1 + expanded.depth * 0.25)) AS graph_score,
      MAX(expanded.path_score) AS ontology_path_score,
      (ARRAY_AGG(expanded.path_text ORDER BY expanded.path_score DESC, expanded.depth ASC)
        FILTER (WHERE expanded.depth > 0))[1] AS graph_path
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
    ontologyPathScore: clamp01(Number(row.ontology_path_score ?? 0)),
    sourceType: row.source_type == null ? null : String(row.source_type),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    updatedAt: dateString(row.updated_at),
    graphPath: row.graph_path == null ? null : String(row.graph_path),
  }));
}
