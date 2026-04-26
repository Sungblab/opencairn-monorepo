import { db, sql } from "@opencairn/db";
import type { GraphNode, GraphEdge } from "@opencairn/shared";

// Shared N-hop subgraph fetch used by both:
//   * Phase 1 user-session GET /api/projects/:projectId/graph/expand/:conceptId
//   * Plan 5 Phase 2 internal POST /api/internal/projects/:id/graph/expand
//
// Caller is responsible for resource scope checks (project exists,
// canRead, seed concept belongs to projectId). This helper assumes
// projectId/conceptId are already validated and only runs the
// recursive-CTE BFS + node/edge fetch with the Phase 1 enrichments
// (degree / noteCount / firstNoteId).
//
// 200-node cap matches Phase 1 — keeps the worker- and UI-side payload
// bounded regardless of hops. The hops bound (1..3) is enforced at the
// Zod layer in each route, not here.

export interface ExpandFromConceptResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function expandFromConcept(
  projectId: string,
  conceptId: string,
  hops: number,
): Promise<ExpandFromConceptResult> {
  // Recursive CTE: collect concept ids reachable within `hops` undirected
  // steps. Cap result to 200 nodes to bound payload size.
  type TraversalRow = { concept_id: string };
  const traversalRaw = await db.execute(sql`
    WITH RECURSIVE traversal AS (
      SELECT ${conceptId}::uuid AS concept_id, 0 AS depth
      UNION
      SELECT
        CASE WHEN e.source_id = t.concept_id THEN e.target_id
             ELSE e.source_id END AS concept_id,
        t.depth + 1 AS depth
      FROM traversal t
      JOIN concept_edges e
        ON e.source_id = t.concept_id OR e.target_id = t.concept_id
      WHERE t.depth < ${hops}
    )
    SELECT DISTINCT concept_id FROM traversal LIMIT 200
  `);
  const conceptIds = (
    (traversalRaw as unknown as { rows: TraversalRow[] }).rows ??
    (traversalRaw as unknown as TraversalRow[])
  ).map((r) => r.concept_id);
  if (conceptIds.length === 0) return { nodes: [], edges: [] };

  const idArr = sql.join(
    conceptIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  type NodeRow = {
    id: string;
    name: string;
    description: string | null;
    degree: number;
    note_count: number;
    first_note_id: string | null;
  };
  const nodeRaw = await db.execute(sql`
    SELECT
      c.id, c.name, c.description,
      (SELECT count(*)::int FROM concept_edges e
        WHERE e.source_id = c.id OR e.target_id = c.id) AS degree,
      (SELECT count(*)::int FROM concept_notes cn
        WHERE cn.concept_id = c.id) AS note_count,
      (SELECT cn.note_id FROM concept_notes cn
        JOIN notes n ON n.id = cn.note_id
        WHERE cn.concept_id = c.id AND n.deleted_at IS NULL
        ORDER BY n.created_at ASC LIMIT 1) AS first_note_id
    FROM concepts c
    WHERE c.id = ANY(ARRAY[${idArr}])
      AND c.project_id = ${projectId}
  `);
  const nodeRows = (
    (nodeRaw as unknown as { rows: NodeRow[] }).rows ??
    (nodeRaw as unknown as NodeRow[])
  );

  type EdgeRow = {
    id: string;
    source_id: string;
    target_id: string;
    relation_type: string;
    weight: number;
  };
  const edgeRaw = await db.execute(sql`
    SELECT e.id, e.source_id, e.target_id, e.relation_type, e.weight
    FROM concept_edges e
    WHERE e.source_id = ANY(ARRAY[${idArr}])
      AND e.target_id = ANY(ARRAY[${idArr}])
  `);
  const edgeRows = (
    (edgeRaw as unknown as { rows: EdgeRow[] }).rows ??
    (edgeRaw as unknown as EdgeRow[])
  );

  return {
    nodes: nodeRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      degree: r.degree,
      noteCount: r.note_count,
      firstNoteId: r.first_note_id,
    })),
    edges: edgeRows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      targetId: r.target_id,
      relationType: r.relation_type,
      weight: Number(r.weight),
    })),
  };
}
