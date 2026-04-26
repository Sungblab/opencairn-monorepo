import { db, sql } from "@opencairn/db";
import type { GraphNode, GraphEdge } from "@opencairn/shared";

// ─── Plan 5 Phase 2 — view-specific SQL strategies ────────────────────────
//
// `GET /api/projects/:id/graph?view=...` dispatches to one of these helpers.
// Phase 1's behaviour (the original "top-N by degree/recent" SQL) lives in
// `selectGraphView` so that `view=graph` (default) is regression-zero against
// `tests/graph.test.ts`.
//
// All helpers assume the caller has already enforced `canRead(user, project)`
// + path-vs-root project ownership where relevant. They return only the
// node/edge payload — the route assembles the final response (truncated,
// viewType echo, layout, rootId).

export interface ViewNodeRowMapped {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type RawNodeRow = {
  id: string;
  name: string;
  description: string | null;
  degree: number;
  note_count: number;
  first_note_id: string | null;
};

type RawEdgeRow = {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight: number;
};

function mapNodeRows(rows: RawNodeRow[]): GraphNode[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    degree: r.degree,
    noteCount: r.note_count,
    firstNoteId: r.first_note_id,
  }));
}

function mapEdgeRows(rows: RawEdgeRow[]): GraphEdge[] {
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    targetId: r.target_id,
    relationType: r.relation_type,
    weight: Number(r.weight),
  }));
}

function unwrapRows<T>(raw: unknown): T[] {
  return (
    (raw as { rows?: T[] }).rows ?? (raw as T[])
  );
}

/**
 * Fetch concept node rows with the Phase 1 enrichments (degree / noteCount /
 * firstNoteId). Used by every view branch that needs full GraphNode payload.
 */
async function fetchNodesByIds(
  projectId: string,
  conceptIds: string[],
): Promise<GraphNode[]> {
  if (conceptIds.length === 0) return [];
  const idArr = sql.join(
    conceptIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const raw = await db.execute(sql`
    SELECT
      c.id,
      c.name,
      c.description,
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
  return mapNodeRows(unwrapRows<RawNodeRow>(raw));
}

/**
 * Fetch all concept_edges between the given concept ids (intra-set only).
 * Optionally filter by `relation_type`.
 */
async function fetchEdgesAmong(
  conceptIds: string[],
  relation?: string,
): Promise<GraphEdge[]> {
  if (conceptIds.length === 0) return [];
  const idArr = sql.join(
    conceptIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const relationFilter = relation ? sql`AND e.relation_type = ${relation}` : sql``;
  const raw = await db.execute(sql`
    SELECT e.id, e.source_id, e.target_id, e.relation_type, e.weight
    FROM concept_edges e
    WHERE e.source_id = ANY(ARRAY[${idArr}])
      AND e.target_id = ANY(ARRAY[${idArr}])
      ${relationFilter}
  `);
  return mapEdgeRows(unwrapRows<RawEdgeRow>(raw));
}

// ─── Phase 1 graph view ───────────────────────────────────────────────────

/**
 * Phase 1 behaviour: top-N concepts by degree (or recency), plus the edges
 * among them. This is the `view=graph` branch and MUST be regression-zero
 * against the existing `tests/graph.test.ts`.
 */
export async function selectGraphView(opts: {
  projectId: string;
  limit: number;
  order: "degree" | "recent";
  relation?: string;
}): Promise<ViewNodeRowMapped> {
  const { projectId, limit, order, relation } = opts;
  const orderClause =
    order === "recent"
      ? sql`c.created_at DESC`
      : sql`(SELECT count(*)::int
             FROM concept_edges e
             WHERE e.source_id = c.id OR e.target_id = c.id) DESC,
            c.name ASC`;

  const nodeRaw = await db.execute(sql`
    SELECT
      c.id,
      c.name,
      c.description,
      (SELECT count(*)::int FROM concept_edges e
        WHERE e.source_id = c.id OR e.target_id = c.id) AS degree,
      (SELECT count(*)::int FROM concept_notes cn
        WHERE cn.concept_id = c.id) AS note_count,
      (SELECT cn.note_id FROM concept_notes cn
        JOIN notes n ON n.id = cn.note_id
        WHERE cn.concept_id = c.id AND n.deleted_at IS NULL
        ORDER BY n.created_at ASC LIMIT 1) AS first_note_id
    FROM concepts c
    WHERE c.project_id = ${projectId}
    ORDER BY ${orderClause}
    LIMIT ${limit}
  `);
  const nodes = mapNodeRows(unwrapRows<RawNodeRow>(nodeRaw));
  const edges = await fetchEdgesAmong(
    nodes.map((n) => n.id),
    relation,
  );
  return { nodes, edges };
}

// ─── Helpers used by mindmap/board branches ──────────────────────────────

/**
 * Returns `true` iff `conceptId` belongs to `projectId`. Used by mindmap/board
 * branches to convert "concept exists in the wrong project" into a 404
 * (resource scope leak guard, mirrors Phase 1 expand).
 */
export async function projectOwnsConcept(
  projectId: string,
  conceptId: string,
): Promise<boolean> {
  const raw = await db.execute(sql`
    SELECT 1 AS ok
    FROM concepts c
    WHERE c.id = ${conceptId}::uuid
      AND c.project_id = ${projectId}
    LIMIT 1
  `);
  const rows = unwrapRows<{ ok: number }>(raw);
  return rows.length > 0;
}

/**
 * Highest-degree concept in the project (ties broken by name ASC). Returns
 * `null` if the project has zero concepts. Used by `view=mindmap` when no
 * `?root=` is supplied.
 */
export async function selectMaxDegreeConcept(
  projectId: string,
): Promise<string | null> {
  const raw = await db.execute(sql`
    SELECT c.id
    FROM concepts c
    LEFT JOIN concept_edges e
      ON (e.source_id = c.id OR e.target_id = c.id)
    WHERE c.project_id = ${projectId}
    GROUP BY c.id, c.name
    ORDER BY COUNT(e.id) DESC, c.name ASC
    LIMIT 1
  `);
  const rows = unwrapRows<{ id: string }>(raw);
  return rows[0]?.id ?? null;
}

// ─── Mindmap view (BFS tree from root) ────────────────────────────────────

/**
 * BFS tree from `rootId` capped at `depth` levels with at most `perParentCap`
 * children per parent and `totalCap` total nodes. Children ordered by edge
 * weight DESC so the strongest relations win when the cap bites.
 *
 * Implementation: recursive CTE collects all reachable concept ids within
 * `depth` undirected steps (cap `totalCap * 4` to bound runtime), then
 * application-layer post-processing builds the tree with the per-parent cap.
 */
export async function selectMindmapBfs(opts: {
  projectId: string;
  rootId: string;
  depth: number;
  perParentCap: number;
  totalCap: number;
}): Promise<ViewNodeRowMapped> {
  const { projectId, rootId, depth, perParentCap, totalCap } = opts;
  // Pull every (parent_id -> child_id, edge_id, weight, depth) tuple within
  // `depth` levels. We use the source/target asymmetric direction (parent
  // pointed to children) for the tree expansion. Concept_edges are
  // semantically directed (Compiler emits "source IS-A target" etc.), so the
  // mindmap follows source→target only — matches the spec's plain
  // `JOIN concept_edges e ON e.source_id = b.id`.
  type StepRow = {
    parent_id: string;
    child_id: string;
    edge_id: string;
    weight: number;
    depth: number;
  };
  const stepRaw = await db.execute(sql`
    WITH RECURSIVE bfs AS (
      SELECT
        ${rootId}::uuid AS parent_id,
        ${rootId}::uuid AS child_id,
        NULL::uuid     AS edge_id,
        0::real        AS weight,
        0              AS depth,
        ARRAY[${rootId}::uuid] AS path
      FROM concepts
      WHERE id = ${rootId}::uuid AND project_id = ${projectId}
      UNION ALL
      SELECT
        b.child_id      AS parent_id,
        e.target_id     AS child_id,
        e.id            AS edge_id,
        e.weight        AS weight,
        b.depth + 1     AS depth,
        b.path || e.target_id
      FROM bfs b
      JOIN concept_edges e ON e.source_id = b.child_id
      JOIN concepts c
        ON c.id = e.target_id AND c.project_id = ${projectId}
      WHERE b.depth < ${depth}
        AND NOT (e.target_id = ANY(b.path))
    )
    SELECT parent_id, child_id, edge_id, weight, depth
    FROM bfs
    WHERE depth > 0
    ORDER BY depth ASC, weight DESC
    LIMIT ${totalCap * 4}
  `);
  const steps = unwrapRows<StepRow>(stepRaw);

  // Application-layer per-parent cap + total cap. Walk the steps in (depth
  // ASC, weight DESC) order; include the edge if its parent has free slots
  // and we're under the total cap. Always include the root itself.
  const includedConcepts = new Set<string>([rootId]);
  const includedEdgeIds = new Set<string>();
  const childrenPerParent = new Map<string, number>();
  for (const step of steps) {
    if (includedConcepts.size >= totalCap) break;
    const used = childrenPerParent.get(step.parent_id) ?? 0;
    if (used >= perParentCap) continue;
    if (!step.edge_id) continue; // root self-row
    includedConcepts.add(step.child_id);
    includedEdgeIds.add(step.edge_id);
    childrenPerParent.set(step.parent_id, used + 1);
  }

  const nodes = await fetchNodesByIds(projectId, [...includedConcepts]);
  // Fetch all edges among the included concepts, then keep only the ones we
  // chose during the BFS walk. This preserves the tree shape (one parent
  // per child) while reusing the same edge mapping logic.
  const edgesAmong = await fetchEdgesAmong([...includedConcepts]);
  const edges = edgesAmong.filter((e) => includedEdgeIds.has(e.id));
  return { nodes, edges };
}

// ─── Cards / Timeline (simple ORDER BY views) ─────────────────────────────

async function selectConceptsOrderedByCreatedAt(
  projectId: string,
  limit: number,
  direction: "asc" | "desc",
): Promise<GraphNode[]> {
  const orderClause = direction === "asc"
    ? sql`c.created_at ASC`
    : sql`c.created_at DESC`;
  const raw = await db.execute(sql`
    SELECT
      c.id,
      c.name,
      c.description,
      (SELECT count(*)::int FROM concept_edges e
        WHERE e.source_id = c.id OR e.target_id = c.id) AS degree,
      (SELECT count(*)::int FROM concept_notes cn
        WHERE cn.concept_id = c.id) AS note_count,
      (SELECT cn.note_id FROM concept_notes cn
        JOIN notes n ON n.id = cn.note_id
        WHERE cn.concept_id = c.id AND n.deleted_at IS NULL
        ORDER BY n.created_at ASC LIMIT 1) AS first_note_id
    FROM concepts c
    WHERE c.project_id = ${projectId}
    ORDER BY ${orderClause}
    LIMIT ${limit}
  `);
  return mapNodeRows(unwrapRows<RawNodeRow>(raw));
}

/**
 * `view=cards`: most recent concepts first. No edges (cards is a flat grid).
 */
export async function selectConceptsByRecency(opts: {
  projectId: string;
  limit: number;
}): Promise<GraphNode[]> {
  return selectConceptsOrderedByCreatedAt(opts.projectId, opts.limit, "desc");
}

/**
 * `view=timeline`: oldest concepts first. No edges (timeline is a left→right
 * time axis with no relations).
 */
export async function selectConceptsByCreatedAsc(opts: {
  projectId: string;
  limit: number;
}): Promise<GraphNode[]> {
  return selectConceptsOrderedByCreatedAt(opts.projectId, opts.limit, "asc");
}

// ─── Board (1-hop neighborhood when root is supplied) ─────────────────────

/**
 * `view=board&root=<id>`: 1-hop neighborhood around `rootId` (root + every
 * directly connected concept), capped at `cap` total nodes. Returns the
 * union of all edges incident to `rootId` (across both directions).
 */
export async function selectOneHopNeighborhood(opts: {
  projectId: string;
  rootId: string;
  cap: number;
}): Promise<ViewNodeRowMapped> {
  const { projectId, rootId, cap } = opts;
  type IdRow = { concept_id: string };
  const idRaw = await db.execute(sql`
    SELECT DISTINCT concept_id FROM (
      SELECT ${rootId}::uuid AS concept_id
      UNION
      SELECT
        CASE WHEN e.source_id = ${rootId}::uuid THEN e.target_id
             ELSE e.source_id END AS concept_id
      FROM concept_edges e
      WHERE e.source_id = ${rootId}::uuid OR e.target_id = ${rootId}::uuid
    ) ids
    LIMIT ${cap}
  `);
  const ids = unwrapRows<IdRow>(idRaw).map((r) => r.concept_id);
  if (ids.length === 0) return { nodes: [], edges: [] };
  const nodes = await fetchNodesByIds(projectId, ids);
  // Filter to concepts that actually belong to the project (defence in
  // depth: project_id is already enforced in fetchNodesByIds).
  const projectIds = new Set(nodes.map((n) => n.id));
  const edges = await fetchEdgesAmong([...projectIds]);
  return { nodes, edges };
}
