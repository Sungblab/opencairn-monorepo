import {
  and,
  conceptEdgeEvidence,
  concepts,
  count,
  db,
  desc,
  eq,
  evidenceBundleChunks,
  inArray,
  knowledgeClaims,
  or,
  sql,
} from "@opencairn/db";
import type {
  EvidenceBundle,
  GraphEdge,
  GraphLayout,
  GraphNode,
  GraphResponse,
  GraphViewType,
  ViewEdge,
} from "@opencairn/shared";
import { canRead } from "./permissions";
import {
  getEvidenceBundleForUser,
  EvidenceAccessDeniedError,
} from "./evidence-bundles";
import {
  projectOwnsConcept,
  selectCardsGraph,
  selectConceptsByCreatedAsc,
  selectGraphView,
  selectMaxDegreeConcept,
  selectMindmapBfs,
  selectOneHopNeighborhood,
} from "./graph-views";

const GRAPH_LIMIT = 500;
const MINDMAP_DEPTH = 3;
const MINDMAP_PER_PARENT_CAP = 8;
const MINDMAP_TOTAL_CAP = 50;
const CARDS_LIMIT = 80;
const TIMELINE_LIMIT = 80;
const BOARD_CAP = 200;
const CO_MENTION_EDGE_LIMIT = 900;
const EVIDENCE_BUNDLE_FETCH_CONCURRENCY = 8;

export type KnowledgeSurfaceView = GraphViewType;

export type KnowledgeSurfaceSupportStatus =
  | "supported"
  | "weak"
  | "stale"
  | "disputed"
  | "missing";

export type KnowledgeSurfaceEdge = ViewEdge & {
  id: string;
  support: {
    claimId: string | null;
    evidenceBundleId: string | null;
    supportScore: number;
    citationCount: number;
    status: KnowledgeSurfaceSupportStatus;
  };
};

export type KnowledgeSurfaceCard = {
  id: string;
  conceptId: string;
  title: string;
  summary: string;
  evidenceBundleId: string | null;
  citationCount: number;
};

export type KnowledgeSurfaceResponse = Omit<GraphResponse, "edges" | "viewType"> & {
  viewType: KnowledgeSurfaceView;
  edges: KnowledgeSurfaceEdge[];
  cards?: KnowledgeSurfaceCard[];
  evidenceBundles?: EvidenceBundle[];
};

export type KnowledgeSurfaceOpts = {
  view: KnowledgeSurfaceView;
  query?: string;
  root?: string;
  includeEvidence: boolean;
};

function matchesQuery(node: GraphNode, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return (
    node.name.toLocaleLowerCase().includes(needle) ||
    node.description.toLocaleLowerCase().includes(needle)
  );
}

function filterByQuery(
  nodes: GraphNode[],
  edges: GraphEdge[],
  query?: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!query?.trim()) return { nodes, edges };
  const filteredNodes = nodes.filter((node) => matchesQuery(node, query));
  const ids = new Set(filteredNodes.map((node) => node.id));
  return {
    nodes: filteredNodes,
    edges: edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)),
  };
}

function edgeKey(sourceId: string, targetId: string, relationType: string): string {
  return `${sourceId}->${targetId}:${relationType}`;
}

function normalizeEdgeWeight(value: number, max: number): number {
  if (max <= 0) return 0.35;
  return Math.max(0.18, Math.min(1, value / max));
}

async function selectCoMentionEdges(
  conceptIds: string[],
): Promise<KnowledgeSurfaceEdge[]> {
  if (conceptIds.length < 2) return [];
  const idArr = sql.join(
    conceptIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  type CoMentionRow = {
    source_id: string;
    target_id: string;
    mention_count: number;
    source_note_ids: string[] | null;
  };
  const raw = await db.execute(sql`
    WITH selected_notes AS (
      SELECT concept_id, note_id
      FROM concept_notes
      WHERE concept_id = ANY(ARRAY[${idArr}])
    ),
    pairs AS (
      SELECT
        LEAST(a.concept_id, b.concept_id) AS source_id,
        GREATEST(a.concept_id, b.concept_id) AS target_id,
        a.note_id
      FROM selected_notes a
      JOIN selected_notes b
        ON a.note_id = b.note_id
       AND a.concept_id < b.concept_id
    )
    SELECT
      source_id,
      target_id,
      count(*)::int AS mention_count,
      array_agg(DISTINCT note_id) AS source_note_ids
    FROM pairs
    GROUP BY source_id, target_id
    ORDER BY mention_count DESC, source_id ASC, target_id ASC
    LIMIT ${CO_MENTION_EDGE_LIMIT}
  `);
  const rows = ((raw as { rows?: CoMentionRow[] }).rows ?? raw) as CoMentionRow[];
  const maxMentions = Math.max(1, ...rows.map((row) => Number(row.mention_count)));
  return rows.map((row) => ({
    id: edgeKey(row.source_id, row.target_id, "co-mention"),
    sourceId: row.source_id,
    targetId: row.target_id,
    relationType: "co-mention",
    weight: normalizeEdgeWeight(Number(row.mention_count), maxMentions),
    surfaceType: "co_mention",
    displayOnly: true,
    sourceNoteIds: row.source_note_ids ?? [],
    support: missingSupport(),
  }));
}

function mergeSurfaceEdges(
  semanticEdges: KnowledgeSurfaceEdge[],
  displayEdges: KnowledgeSurfaceEdge[],
): KnowledgeSurfaceEdge[] {
  const semanticPairs = new Set(
    semanticEdges.map((edge) => edgeKey(edge.sourceId, edge.targetId, edge.relationType)),
  );
  const merged = [...semanticEdges];
  for (const edge of displayEdges) {
    if (semanticPairs.has(edgeKey(edge.sourceId, edge.targetId, edge.relationType))) {
      continue;
    }
    merged.push(edge);
  }
  return merged;
}

function claimStatusToSupportStatus(status: string): KnowledgeSurfaceSupportStatus {
  if (status === "stale" || status === "retracted") return "stale";
  if (status === "disputed") return "disputed";
  return "supported";
}

async function selectEdgeSupport(
  edgeIds: string[],
): Promise<Map<string, KnowledgeSurfaceEdge["support"]>> {
  if (edgeIds.length === 0) return new Map();

  const rows = await db
    .select({
      edgeId: conceptEdgeEvidence.conceptEdgeId,
      claimId: knowledgeClaims.id,
      status: knowledgeClaims.status,
      evidenceBundleId: conceptEdgeEvidence.evidenceBundleId,
      supportScore: conceptEdgeEvidence.supportScore,
      stance: conceptEdgeEvidence.stance,
      noteChunkId: conceptEdgeEvidence.noteChunkId,
    })
    .from(conceptEdgeEvidence)
    .leftJoin(knowledgeClaims, eq(knowledgeClaims.id, conceptEdgeEvidence.claimId))
    .where(inArray(conceptEdgeEvidence.conceptEdgeId, edgeIds));

  const support = new Map<
    string,
    KnowledgeSurfaceEdge["support"] & { chunkIds: Set<string> }
  >();
  for (const row of rows) {
    const existing =
      support.get(row.edgeId) ??
      {
        claimId: null,
        evidenceBundleId: null,
        supportScore: 0,
        citationCount: 0,
        status: "missing" as KnowledgeSurfaceSupportStatus,
        chunkIds: new Set<string>(),
      };

    existing.chunkIds.add(row.noteChunkId);
    existing.citationCount = existing.chunkIds.size;
    if (Number(row.supportScore) >= existing.supportScore) {
      existing.claimId = row.claimId ?? null;
      existing.evidenceBundleId = row.evidenceBundleId;
      existing.supportScore = Number(row.supportScore);
      existing.status =
        row.stance === "contradicts"
          ? "disputed"
          : claimStatusToSupportStatus(row.status ?? "active");
    }
    support.set(row.edgeId, existing);
  }

  return new Map(
    [...support.entries()].map(([edgeId, value]) => {
      const { chunkIds: _chunkIds, ...publicValue } = value;
      if (publicValue.status === "supported" && publicValue.supportScore < 0.7) {
        publicValue.status = "weak";
      }
      return [edgeId, publicValue];
    }),
  );
}

function missingSupport(): KnowledgeSurfaceEdge["support"] {
  return {
    claimId: null,
    evidenceBundleId: null,
    supportScore: 0,
    citationCount: 0,
    status: "missing",
  };
}

async function selectCards(nodes: GraphNode[]): Promise<KnowledgeSurfaceCard[]> {
  if (nodes.length === 0) return [];
  const conceptIds = nodes.map((node) => node.id);
  const claimRows = await db
    .select({
      id: knowledgeClaims.id,
      subjectConceptId: knowledgeClaims.subjectConceptId,
      objectConceptId: knowledgeClaims.objectConceptId,
      claimText: knowledgeClaims.claimText,
      evidenceBundleId: knowledgeClaims.evidenceBundleId,
    })
    .from(knowledgeClaims)
    .where(
      and(
        eq(knowledgeClaims.status, "active"),
        or(
          inArray(knowledgeClaims.subjectConceptId, conceptIds),
          inArray(knowledgeClaims.objectConceptId, conceptIds),
        ),
      ),
    )
    .orderBy(desc(knowledgeClaims.updatedAt));

  const bundleIds = [...new Set(claimRows.map((row) => row.evidenceBundleId))];
  const citationCounts = new Map<string, number>();
  if (bundleIds.length > 0) {
    const counts = await db
      .select({
        bundleId: evidenceBundleChunks.bundleId,
        total: count(),
      })
      .from(evidenceBundleChunks)
      .where(inArray(evidenceBundleChunks.bundleId, bundleIds))
      .groupBy(evidenceBundleChunks.bundleId);
    for (const row of counts) {
      citationCounts.set(row.bundleId, Number(row.total));
    }
  }

  const claimByConcept = new Map<string, (typeof claimRows)[number]>();
  for (const row of claimRows) {
    for (const conceptId of [row.subjectConceptId, row.objectConceptId]) {
      if (conceptId && !claimByConcept.has(conceptId)) {
        claimByConcept.set(conceptId, row);
      }
    }
  }

  return nodes.map((node) => {
    const claim = claimByConcept.get(node.id);
    return {
      id: claim?.id ?? node.id,
      conceptId: node.id,
      title: node.name,
      summary: claim?.claimText ?? node.description,
      evidenceBundleId: claim?.evidenceBundleId ?? null,
      citationCount: claim ? citationCounts.get(claim.evidenceBundleId) ?? 0 : 0,
    };
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), items.length) },
      () => worker(),
    ),
  );
  return results;
}

async function selectSurfaceBase(
  projectId: string,
  opts: KnowledgeSurfaceOpts,
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  totalConcepts: number;
  layout: GraphLayout;
  rootId: string | null;
}> {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(concepts)
    .where(eq(concepts.projectId, projectId));

  if (opts.view === "graph") {
    const selected = await selectGraphView({
      projectId,
      limit: GRAPH_LIMIT,
      order: "degree",
    });
    const filtered = filterByQuery(selected.nodes, selected.edges, opts.query);
    return {
      ...filtered,
      truncated: total > GRAPH_LIMIT,
      totalConcepts: total,
      layout: "fcose",
      rootId: null,
    };
  }

  if (opts.view === "mindmap") {
    let rootId: string | null = null;
    if (opts.root) {
      rootId = (await projectOwnsConcept(projectId, opts.root)) ? opts.root : null;
      if (!rootId) {
        return {
          nodes: [],
          edges: [],
          truncated: false,
          totalConcepts: total,
          layout: "dagre",
          rootId: null,
        };
      }
    } else {
      rootId = await selectMaxDegreeConcept(projectId);
    }
    if (!rootId) {
      return {
        nodes: [],
        edges: [],
        truncated: false,
        totalConcepts: total,
        layout: "dagre",
        rootId: null,
      };
    }
    const selected = await selectMindmapBfs({
      projectId,
      rootId,
      depth: MINDMAP_DEPTH,
      perParentCap: MINDMAP_PER_PARENT_CAP,
      totalCap: MINDMAP_TOTAL_CAP,
    });
    const filtered = filterByQuery(selected.nodes, selected.edges, opts.query);
    return {
      ...filtered,
      truncated: total > selected.nodes.length,
      totalConcepts: total,
      layout: "dagre",
      rootId,
    };
  }

  if (opts.view === "timeline") {
    const nodes = await selectConceptsByCreatedAsc({
      projectId,
      limit: TIMELINE_LIMIT,
    });
    const filtered = filterByQuery(nodes, [], opts.query);
    return {
      nodes: filtered.nodes,
      edges: filtered.edges,
      truncated: total > TIMELINE_LIMIT,
      totalConcepts: total,
      layout: "preset",
      rootId: null,
    };
  }

  if (opts.view === "board") {
    let selected;
    let rootId: string | null = null;
    if (opts.root && (await projectOwnsConcept(projectId, opts.root))) {
      rootId = opts.root;
      selected = await selectOneHopNeighborhood({
        projectId,
        rootId,
        cap: BOARD_CAP,
      });
    } else {
      selected = await selectGraphView({
        projectId,
        limit: BOARD_CAP,
        order: "degree",
      });
    }
    const filtered = filterByQuery(selected.nodes, selected.edges, opts.query);
    return {
      ...filtered,
      truncated: total > selected.nodes.length,
      totalConcepts: total,
      layout: "preset",
      rootId,
    };
  }

  const selected = await selectCardsGraph({
    projectId,
    limit: CARDS_LIMIT,
  });
  const filtered = filterByQuery(selected.nodes, selected.edges, opts.query);
  return {
    nodes: filtered.nodes,
    edges: filtered.edges,
    truncated: total > CARDS_LIMIT,
    totalConcepts: total,
    layout: "preset",
    rootId: null,
  };
}

export async function getKnowledgeSurfaceForUser(
  userId: string,
  projectId: string,
  opts: KnowledgeSurfaceOpts,
): Promise<KnowledgeSurfaceResponse> {
  if (!(await canRead(userId, { type: "project", id: projectId }))) {
    throw new EvidenceAccessDeniedError();
  }

  const base = await selectSurfaceBase(projectId, opts);
  const support = await selectEdgeSupport(base.edges.map((edge) => edge.id));
  const semanticEdges: KnowledgeSurfaceEdge[] = base.edges.map((edge) => ({
    ...edge,
    id: edge.id,
    surfaceType: "semantic_relation",
    displayOnly: false,
    sourceNoteIds: [],
    support: support.get(edge.id) ?? missingSupport(),
  }));
  const displayEdges =
    opts.view === "timeline"
      ? []
      : await selectCoMentionEdges(base.nodes.map((node) => node.id));
  const edges = mergeSurfaceEdges(semanticEdges, displayEdges);
  const cards = opts.view === "cards" ? await selectCards(base.nodes) : undefined;

  const response: KnowledgeSurfaceResponse = {
    viewType: opts.view,
    rootId: base.rootId,
    nodes: base.nodes,
    edges,
    truncated: base.truncated,
    totalConcepts: base.totalConcepts,
    layout: base.layout,
    ...(cards ? { cards } : {}),
  };

  if (opts.includeEvidence) {
    const bundleIds = new Set<string>();
    for (const edge of edges) {
      if (edge.support.evidenceBundleId) bundleIds.add(edge.support.evidenceBundleId);
    }
    for (const card of cards ?? []) {
      if (card.evidenceBundleId) bundleIds.add(card.evidenceBundleId);
    }
    const bundles = await mapWithConcurrency(
      [...bundleIds],
      EVIDENCE_BUNDLE_FETCH_CONCURRENCY,
      (bundleId) => getEvidenceBundleForUser(userId, bundleId),
    );
    response.evidenceBundles = bundles.filter(
      (bundle): bundle is EvidenceBundle => bundle !== null,
    );
  }

  return response;
}
