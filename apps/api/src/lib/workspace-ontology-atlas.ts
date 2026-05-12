import { db, projects, eq, sql } from "@opencairn/db";
import type {
  WorkspaceAtlasEdge,
  WorkspaceAtlasNode,
  WorkspaceAtlasResponse,
} from "@opencairn/shared";
import { canRead } from "./permissions";

type WorkspaceAtlasOpts = {
  limit: number;
  projectId?: string;
  q?: string;
};

type ProjectRow = {
  id: string;
  name: string;
};

type ConceptRow = {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  description: string | null;
  created_at: string | Date | null;
  degree: number;
  note_count: number;
  source_note_ids: string[] | null;
  stale: boolean | null;
};

type EdgeRow = {
  id: string;
  source_id: string;
  target_id: string;
  source_project_id: string;
  target_project_id: string;
  relation_type: string;
  weight: number;
};

type NoteRow = {
  id: string;
  project_id: string;
  project_name: string;
  title: string | null;
  updated_at: string | Date | null;
};

type WikiLinkRow = {
  id: string;
  source_note_id: string;
  target_note_id: string;
  source_project_id: string;
  target_project_id: string;
};

type SourceMembershipRow = {
  source_id: string;
  target_id: string;
  chunk_count: number;
  source_note_ids: string[] | null;
  project_ids: string[] | null;
};

type TreeNodeRow = {
  id: string;
  parent_id: string | null;
  project_id: string;
  project_name: string;
  kind: "source_bundle" | "artifact_group" | "artifact" | "agent_file";
  label: string;
};

const BRIDGE_NODE_SCORE = 10_000;
const DUPLICATE_CANDIDATE_SCORE = 5_000;
const PROJECT_CONTEXT_SCORE = 1_000;
const DEGREE_SCORE = 10;
const EXPLICIT_LAYER_SCORE = 25;
const SOURCE_MEMBERSHIP_EDGE_LIMIT = 900;
const SOURCE_MEMBERSHIP_MAX_CONCEPTS_PER_CHUNK = 40;

function unwrapRows<T>(raw: unknown): T[] {
  return (raw as { rows?: T[] }).rows ?? (raw as T[]);
}

function toIso(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeConceptName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function atlasNodeId(normalizedName: string): string {
  return `concept:${encodeURIComponent(normalizedName)}`;
}

function noteNodeId(noteId: string): string {
  return `note:${noteId}`;
}

function treeNodeId(nodeId: string): string {
  return `tree:${nodeId}`;
}

function idArray(ids: string[]) {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

function atlasNodeScore(node: WorkspaceAtlasNode): number {
  return (
    (node.bridge ? BRIDGE_NODE_SCORE : 0) +
    (node.duplicateCandidate ? DUPLICATE_CANDIDATE_SCORE : 0) +
    node.projectCount * PROJECT_CONTEXT_SCORE +
    node.degree * DEGREE_SCORE +
    node.mentionCount +
    (node.layer === "explicit" ? EXPLICIT_LAYER_SCORE : 0)
  );
}

function sortAtlasNodes(nodes: WorkspaceAtlasNode[]): WorkspaceAtlasNode[] {
  return [...nodes].sort(
    (a, b) =>
      atlasNodeScore(b) - atlasNodeScore(a) || a.label.localeCompare(b.label),
  );
}

async function readableProjectsForWorkspace(
  userId: string,
  workspaceId: string,
  projectFilter?: string,
): Promise<ProjectRow[]> {
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));

  const filtered = projectFilter
    ? rows.filter((project) => project.id === projectFilter)
    : rows;
  const permissions = await Promise.all(
    filtered.map((project) =>
      canRead(userId, { type: "project", id: project.id }),
    ),
  );
  return filtered.filter((_, index) => permissions[index]);
}

async function fetchConceptRows(
  projectIds: string[],
  query: string | undefined,
): Promise<ConceptRow[]> {
  if (projectIds.length === 0) return [];
  const projectIdArr = idArray(projectIds);
  const queryFilter = query
    ? sql`AND (c.name ILIKE ${`%${query}%`} OR c.description ILIKE ${`%${query}%`})`
    : sql``;
  const raw = await db.execute(sql`
    WITH selected_concepts AS (
      SELECT
        c.id,
        c.project_id,
        p.name AS project_name,
        c.name,
        c.description,
        c.created_at
      FROM concepts c
      JOIN projects p ON p.id = c.project_id
      WHERE c.project_id = ANY(ARRAY[${projectIdArr}])
        ${queryFilter}
    ),
    edge_counts AS (
      SELECT concept_id, count(*)::int AS degree
      FROM (
        SELECT source_id AS concept_id
        FROM concept_edges
        WHERE source_id IN (SELECT id FROM selected_concepts)
        UNION ALL
        SELECT target_id AS concept_id
        FROM concept_edges
        WHERE target_id IN (SELECT id FROM selected_concepts)
      ) all_edges
      GROUP BY concept_id
    ),
    latest_extractions AS (
      SELECT
        concept_id,
        source_note_id,
        max(created_at) AS latest_extracted_at
      FROM concept_extractions
      WHERE concept_id IN (SELECT id FROM selected_concepts)
      GROUP BY concept_id, source_note_id
    ),
    note_stats AS (
      SELECT
        cn.concept_id,
        count(*)::int AS note_count,
        array_agg(DISTINCT cn.note_id) AS source_note_ids,
        bool_or(
          n.updated_at > COALESCE(le.latest_extracted_at, sc.created_at)
        ) AS stale
      FROM concept_notes cn
      JOIN selected_concepts sc ON sc.id = cn.concept_id
      LEFT JOIN notes n ON n.id = cn.note_id AND n.deleted_at IS NULL
      LEFT JOIN latest_extractions le
        ON le.concept_id = cn.concept_id
        AND le.source_note_id = cn.note_id
      GROUP BY cn.concept_id
    )
    SELECT
      sc.id,
      sc.project_id,
      sc.project_name,
      sc.name,
      sc.description,
      sc.created_at,
      COALESCE(ec.degree, 0)::int AS degree,
      COALESCE(ns.note_count, 0)::int AS note_count,
      COALESCE(ns.source_note_ids, ARRAY[]::uuid[]) AS source_note_ids,
      COALESCE(ns.stale, false) AS stale
    FROM selected_concepts sc
    LEFT JOIN edge_counts ec ON ec.concept_id = sc.id
    LEFT JOIN note_stats ns ON ns.concept_id = sc.id
  `);
  return unwrapRows<ConceptRow>(raw);
}

async function fetchNoteRows(
  userId: string,
  projectIds: string[],
  query: string | undefined,
  limit: number,
): Promise<NoteRow[]> {
  if (projectIds.length === 0) return [];
  const projectIdArr = idArray(projectIds);
  const queryFilter = query
    ? sql`AND (n.title ILIKE ${`%${query}%`} OR n.content_text ILIKE ${`%${query}%`})`
    : sql``;
  const raw = await db.execute(sql`
    SELECT
      n.id,
      n.project_id,
      p.name AS project_name,
      n.title,
      n.updated_at
    FROM notes n
    JOIN projects p ON p.id = n.project_id
    WHERE n.project_id = ANY(ARRAY[${projectIdArr}])
      AND n.deleted_at IS NULL
      ${queryFilter}
    ORDER BY n.updated_at DESC
    LIMIT ${limit}
  `);
  const rows = unwrapRows<NoteRow>(raw);
  const permissions = await Promise.all(
    rows.map((row) => canRead(userId, { type: "note", id: row.id })),
  );
  return rows.filter((_, index) => permissions[index]);
}

async function fetchWikiLinkRows(
  workspaceId: string,
  noteIds: string[],
): Promise<WikiLinkRow[]> {
  if (noteIds.length === 0) return [];
  const noteIdArr = idArray(noteIds);
  const raw = await db.execute(sql`
    SELECT
      wl.id,
      wl.source_note_id,
      wl.target_note_id,
      src.project_id AS source_project_id,
      tgt.project_id AS target_project_id
    FROM wiki_links wl
    JOIN notes src ON src.id = wl.source_note_id
    JOIN notes tgt ON tgt.id = wl.target_note_id
    WHERE wl.workspace_id = ${workspaceId}
      AND wl.source_note_id = ANY(ARRAY[${noteIdArr}])
      AND wl.target_note_id = ANY(ARRAY[${noteIdArr}])
      AND src.deleted_at IS NULL
      AND tgt.deleted_at IS NULL
  `);
  return unwrapRows<WikiLinkRow>(raw);
}

async function fetchTreeNodeRows(
  projectIds: string[],
  query: string | undefined,
): Promise<TreeNodeRow[]> {
  if (projectIds.length === 0) return [];
  const projectIdArr = idArray(projectIds);
  const queryFilter = query
    ? sql`AND n.label ILIKE ${`%${query}%`}`
    : sql``;
  const raw = await db.execute(sql`
    SELECT
      n.id,
      n.parent_id,
      n.project_id,
      p.name AS project_name,
      n.kind,
      n.label
    FROM project_tree_nodes n
    JOIN projects p ON p.id = n.project_id
    WHERE n.project_id = ANY(ARRAY[${projectIdArr}])
      AND n.deleted_at IS NULL
      AND n.kind IN ('source_bundle', 'artifact_group', 'artifact', 'agent_file')
      ${queryFilter}
  `);
  return unwrapRows<TreeNodeRow>(raw);
}

async function fetchEdgesForConcepts(conceptIds: string[]): Promise<EdgeRow[]> {
  if (conceptIds.length === 0) return [];
  const conceptIdArr = idArray(conceptIds);
  const raw = await db.execute(sql`
    SELECT
      e.id,
      e.source_id,
      e.target_id,
      src.project_id AS source_project_id,
      tgt.project_id AS target_project_id,
      e.relation_type,
      e.weight
    FROM concept_edges e
    JOIN concepts src ON src.id = e.source_id
    JOIN concepts tgt ON tgt.id = e.target_id
    WHERE e.source_id = ANY(ARRAY[${conceptIdArr}])
      AND e.target_id = ANY(ARRAY[${conceptIdArr}])
  `);
  return unwrapRows<EdgeRow>(raw);
}

async function fetchSourceMembershipRows(
  projectIds: string[],
  conceptIds: string[],
): Promise<SourceMembershipRow[]> {
  if (projectIds.length === 0 || conceptIds.length < 2) return [];
  const projectIdArr = idArray(projectIds);
  const conceptIdArr = idArray(conceptIds);
  const raw = await db.execute(sql`
    WITH selected_chunks AS (
      SELECT
        ce.concept_id,
        cec.note_chunk_id,
        nc.note_id,
        nc.project_id
      FROM concept_extractions ce
      JOIN concept_extraction_chunks cec
        ON cec.extraction_id = ce.id
      JOIN note_chunks nc
        ON nc.id = cec.note_chunk_id
       AND nc.deleted_at IS NULL
      JOIN notes n
        ON n.id = nc.note_id
       AND n.deleted_at IS NULL
      WHERE ce.project_id = ANY(ARRAY[${projectIdArr}])
        AND nc.project_id = ANY(ARRAY[${projectIdArr}])
        AND n.project_id = ANY(ARRAY[${projectIdArr}])
        AND ce.concept_id = ANY(ARRAY[${conceptIdArr}])
        AND ce.concept_id IS NOT NULL
    ),
    bounded_chunks AS (
      SELECT note_chunk_id
      FROM selected_chunks
      GROUP BY note_chunk_id
      HAVING count(DISTINCT concept_id) BETWEEN 2 AND ${SOURCE_MEMBERSHIP_MAX_CONCEPTS_PER_CHUNK}
    ),
    pairs AS (
      SELECT
        LEAST(a.concept_id, b.concept_id) AS source_id,
        GREATEST(a.concept_id, b.concept_id) AS target_id,
        a.note_chunk_id,
        a.note_id,
        a.project_id
      FROM selected_chunks a
      JOIN selected_chunks b
        ON a.note_chunk_id = b.note_chunk_id
       AND a.concept_id < b.concept_id
      JOIN bounded_chunks bc
        ON bc.note_chunk_id = a.note_chunk_id
    )
    SELECT
      source_id,
      target_id,
      count(DISTINCT note_chunk_id)::int AS chunk_count,
      array_agg(DISTINCT note_id) AS source_note_ids,
      array_agg(DISTINCT project_id) AS project_ids
    FROM pairs
    GROUP BY source_id, target_id
    ORDER BY chunk_count DESC, source_id ASC, target_id ASC
    LIMIT ${SOURCE_MEMBERSHIP_EDGE_LIMIT}
  `);
  return unwrapRows<SourceMembershipRow>(raw);
}

function buildAtlasNodes(rows: ConceptRow[], limit: number): WorkspaceAtlasNode[] {
  const groups = new Map<string, ConceptRow[]>();
  for (const row of rows) {
    const normalized = normalizeConceptName(row.name);
    if (!normalized) continue;
    const group = groups.get(normalized) ?? [];
    group.push(row);
    groups.set(normalized, group);
  }

  const nodes = Array.from(groups.entries()).map(([normalizedName, group]) => {
    const projectMap = new Map<
      string,
      { projectName: string; conceptIds: string[]; mentionCount: number }
    >();
    let mentionCount = 0;
    let degree = 0;
    let firstCreated: string | undefined;
    let stale = false;
    const sourceNoteIds = new Set<string>();
    for (const row of group) {
      mentionCount += Number(row.note_count);
      degree += Number(row.degree);
      firstCreated ??= toIso(row.created_at);
      stale = stale || Boolean(row.stale);
      for (const noteId of row.source_note_ids ?? []) {
        sourceNoteIds.add(noteId);
      }
      const existing = projectMap.get(row.project_id) ?? {
        projectName: row.project_name,
        conceptIds: [],
        mentionCount: 0,
      };
      existing.conceptIds.push(row.id);
      existing.mentionCount += Number(row.note_count);
      projectMap.set(row.project_id, existing);
    }
    const projectContexts = Array.from(projectMap.entries()).map(
      ([projectId, context]) => ({
        projectId,
        projectName: context.projectName,
        conceptIds: context.conceptIds,
        mentionCount: context.mentionCount,
      }),
    );
    const bridge = projectContexts.length > 1;
    const duplicateCandidate = group.length > 1;
    const primary = [...group].sort(
      (a, b) => Number(b.degree) - Number(a.degree) || Number(b.note_count) - Number(a.note_count),
    )[0];
    return {
      id: atlasNodeId(normalizedName),
      label: primary?.name ?? normalizedName,
      objectType: "concept" as const,
      layer: "ai" as const,
      normalizedName,
      description: primary?.description ?? undefined,
      conceptIds: group.map((row) => row.id),
      sourceNoteIds: [...sourceNoteIds],
      projectContexts,
      projectCount: projectContexts.length,
      mentionCount,
      degree,
      bridge,
      duplicateCandidate,
      unclassified: degree === 0,
      stale,
      freshnessReason: stale ? "source_note_changed" as const : undefined,
      createdAt: firstCreated,
    };
  });

  return sortAtlasNodes(nodes).slice(0, limit);
}

function buildAtlasEdges(
  rows: EdgeRow[],
  nodes: WorkspaceAtlasNode[],
  conceptToNode: Map<string, string>,
): WorkspaceAtlasEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedNodeIds = new Set(nodeById.keys());
  const grouped = new Map<
    string,
    {
      sourceId: string;
      targetId: string;
      relationType: string;
      conceptEdgeIds: string[];
      projectIds: Set<string>;
      weights: number[];
      crossProject: boolean;
    }
  >();

  for (const row of rows) {
    const sourceId = conceptToNode.get(row.source_id);
    const targetId = conceptToNode.get(row.target_id);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    if (!selectedNodeIds.has(sourceId) || !selectedNodeIds.has(targetId)) continue;
    const key = `${sourceId}->${targetId}:${row.relation_type}`;
    const current = grouped.get(key) ?? {
      sourceId,
      targetId,
      relationType: row.relation_type,
      conceptEdgeIds: [],
      projectIds: new Set<string>(),
      weights: [],
      crossProject: false,
    };
    current.conceptEdgeIds.push(row.id);
    current.projectIds.add(row.source_project_id);
    current.projectIds.add(row.target_project_id);
    current.weights.push(Number(row.weight));
    if (row.source_project_id !== row.target_project_id) {
      current.crossProject = true;
    }
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .map((group) => {
      const source = nodeById.get(group.sourceId);
      const target = nodeById.get(group.targetId);
      const projectIds = Array.from(group.projectIds);
      const crossProject =
        group.crossProject ||
        (source?.projectCount ?? 0) > 1 ||
        (target?.projectCount ?? 0) > 1 ||
        projectIds.length > 1;
      return {
        id: `${group.sourceId}->${group.targetId}:${encodeURIComponent(group.relationType)}`,
        sourceId: group.sourceId,
        targetId: group.targetId,
        edgeType: "ai_relation" as const,
        layer: "ai" as const,
        relationType: group.relationType,
        weight: Math.max(...group.weights),
        conceptEdgeIds: group.conceptEdgeIds,
        sourceNoteIds: [
          ...new Set([
            ...(source?.sourceNoteIds ?? []),
            ...(target?.sourceNoteIds ?? []),
          ]),
        ],
        projectIds,
        crossProject,
        stale: Boolean(source?.stale || target?.stale),
        freshnessReason:
          source?.stale || target?.stale ? "source_note_changed" as const : undefined,
      };
    })
    .sort((a, b) => Number(b.crossProject) - Number(a.crossProject) || b.weight - a.weight);
}

function buildCoMentionAtlasEdges(nodes: WorkspaceAtlasNode[]): WorkspaceAtlasEdge[] {
  const conceptNodes = nodes.filter(
    (node) => node.objectType === "concept" && node.sourceNoteIds.length > 0,
  );
  const edges: WorkspaceAtlasEdge[] = [];
  for (let i = 0; i < conceptNodes.length; i += 1) {
    const source = conceptNodes[i];
    const sourceNotes = new Set(source.sourceNoteIds);
    for (let j = i + 1; j < conceptNodes.length; j += 1) {
      const target = conceptNodes[j];
      const sharedNotes = target.sourceNoteIds.filter((noteId) => sourceNotes.has(noteId));
      if (sharedNotes.length === 0) continue;
      const projectIds = [
        ...new Set([
          ...source.projectContexts.map((context) => context.projectId),
          ...target.projectContexts.map((context) => context.projectId),
        ]),
      ];
      edges.push({
        id: `co:${source.id}->${target.id}`,
        sourceId: source.id,
        targetId: target.id,
        edgeType: "co_mention",
        layer: "ai",
        relationType: "co-mention",
        weight: Math.min(1, sharedNotes.length / 4),
        conceptEdgeIds: [],
        sourceNoteIds: sharedNotes,
        projectIds,
        crossProject: source.projectCount > 1 || target.projectCount > 1 || projectIds.length > 1,
        stale: Boolean(source.stale || target.stale),
        freshnessReason:
          source.stale || target.stale ? "source_note_changed" as const : undefined,
      });
    }
  }
  return edges
    .sort((a, b) => b.sourceNoteIds.length - a.sourceNoteIds.length || b.weight - a.weight)
    .slice(0, 900);
}

function buildSourceMembershipAtlasEdges(
  rows: SourceMembershipRow[],
  nodes: WorkspaceAtlasNode[],
  conceptToNode: Map<string, string>,
): WorkspaceAtlasEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedNodeIds = new Set(nodeById.keys());
  const maxChunks = Math.max(1, ...rows.map((row) => Number(row.chunk_count)));
  return rows.flatMap((row) => {
    const sourceId = conceptToNode.get(row.source_id);
    const targetId = conceptToNode.get(row.target_id);
    if (!sourceId || !targetId || sourceId === targetId) return [];
    if (!selectedNodeIds.has(sourceId) || !selectedNodeIds.has(targetId)) {
      return [];
    }
    const source = nodeById.get(sourceId);
    const target = nodeById.get(targetId);
    if (!source || !target) return [];
    const projectIds = row.project_ids?.length
      ? [...new Set(row.project_ids)]
      : [
          ...new Set([
            ...source.projectContexts.map((context) => context.projectId),
            ...target.projectContexts.map((context) => context.projectId),
          ]),
        ];
    return [
      {
        id: `source:${sourceId}->${targetId}`,
        sourceId,
        targetId,
        edgeType: "source_membership" as const,
        layer: "ai" as const,
        relationType: "source-proximity",
        weight: Math.max(0.18, Math.min(1, Number(row.chunk_count) / maxChunks)),
        conceptEdgeIds: [],
        sourceNoteIds: row.source_note_ids ?? [],
        projectIds,
        crossProject:
          source.projectCount > 1 ||
          target.projectCount > 1 ||
          projectIds.length > 1,
        stale: Boolean(source.stale || target.stale),
        freshnessReason:
          source.stale || target.stale ? "source_note_changed" as const : undefined,
      },
    ];
  });
}

function buildExplicitNoteNodes(rows: NoteRow[]): WorkspaceAtlasNode[] {
  return rows.map((row) => ({
    id: noteNodeId(row.id),
    label: row.title?.trim() || "Untitled",
    objectType: "note",
    layer: "explicit",
    normalizedName: normalizeConceptName(row.title?.trim() || row.id),
    conceptIds: [],
    sourceNoteIds: [row.id],
    projectContexts: [
      {
        projectId: row.project_id,
        projectName: row.project_name,
        conceptIds: [],
        mentionCount: 0,
      },
    ],
    projectCount: 1,
    mentionCount: 0,
    degree: 0,
    bridge: false,
    duplicateCandidate: false,
    unclassified: false,
    stale: false,
    createdAt: toIso(row.updated_at),
  }));
}

function buildWikiLinkEdges(
  rows: WikiLinkRow[],
  selectedNodeIds: Set<string>,
): WorkspaceAtlasEdge[] {
  return rows.flatMap((row) => {
    const sourceId = noteNodeId(row.source_note_id);
    const targetId = noteNodeId(row.target_note_id);
    if (!selectedNodeIds.has(sourceId) || !selectedNodeIds.has(targetId)) {
      return [];
    }
    return [{
      id: `wiki:${row.id}`,
      sourceId,
      targetId,
      edgeType: "wiki_link",
      layer: "explicit",
      relationType: "links-to",
      weight: 1,
      conceptEdgeIds: [],
      sourceNoteIds: [row.source_note_id],
      projectIds: [...new Set([row.source_project_id, row.target_project_id])],
      crossProject: row.source_project_id !== row.target_project_id,
      stale: false,
    }];
  });
}

function treeObjectType(kind: TreeNodeRow["kind"]): WorkspaceAtlasNode["objectType"] {
  return kind === "source_bundle" ? "source_bundle" : "artifact";
}

function buildTreeNodesAndEdges(rows: TreeNodeRow[]): {
  nodes: WorkspaceAtlasNode[];
  edges: WorkspaceAtlasEdge[];
} {
  const nodeIds = new Set(rows.map((row) => treeNodeId(row.id)));
  const nodes = rows.map((row) => ({
    id: treeNodeId(row.id),
    label: row.label,
    objectType: treeObjectType(row.kind),
    layer: "explicit" as const,
    normalizedName: normalizeConceptName(row.label),
    conceptIds: [],
    sourceNoteIds: [],
    projectContexts: [
      {
        projectId: row.project_id,
        projectName: row.project_name,
        conceptIds: [],
        mentionCount: 0,
      },
    ],
    projectCount: 1,
    mentionCount: 0,
    degree: 0,
    bridge: false,
    duplicateCandidate: false,
    unclassified: false,
    stale: false,
  }));
  const edges = rows.flatMap((row) => {
    if (!row.parent_id) return [];
    const parentId = treeNodeId(row.parent_id);
    const childId = treeNodeId(row.id);
    if (!nodeIds.has(parentId)) return [];
    return [{
      id: `tree:${row.parent_id}->${row.id}`,
      sourceId: parentId,
      targetId: childId,
      edgeType: "project_tree" as const,
      layer: "explicit" as const,
      relationType: "contains",
      weight: 1,
      conceptEdgeIds: [],
      sourceNoteIds: [],
      projectIds: [row.project_id],
      crossProject: false,
      stale: false,
    }];
  });
  return { nodes, edges };
}

export async function getWorkspaceOntologyAtlasForUser(
  userId: string,
  workspaceId: string,
  opts: WorkspaceAtlasOpts,
): Promise<WorkspaceAtlasResponse | null> {
  if (!(await canRead(userId, { type: "workspace", id: workspaceId }))) {
    return null;
  }

  const readableProjects = await readableProjectsForWorkspace(
    userId,
    workspaceId,
    opts.projectId,
  );
  const projectIds = readableProjects.map((project) => project.id);
  const [conceptRows, noteRows, treeRows] = await Promise.all([
    fetchConceptRows(projectIds, opts.q),
    fetchNoteRows(userId, projectIds, opts.q, opts.limit),
    fetchTreeNodeRows(projectIds, opts.q),
  ]);
  const totalConcepts = conceptRows.length;
  const conceptNodes = buildAtlasNodes(conceptRows, opts.limit);
  const noteNodes = buildExplicitNoteNodes(noteRows);
  const tree = buildTreeNodesAndEdges(treeRows);
  const totalAvailableNodes =
    noteNodes.length +
    tree.nodes.length +
    new Set(conceptRows.map((row) => normalizeConceptName(row.name))).size;
  const nodes = sortAtlasNodes([...conceptNodes, ...noteNodes, ...tree.nodes]).slice(
    0,
    opts.limit,
  );
  const conceptToNode = new Map<string, string>();
  for (const node of conceptNodes) {
    for (const conceptId of node.conceptIds) {
      conceptToNode.set(conceptId, node.id);
    }
  }
  const selectedNodeIds = new Set(nodes.map((node) => node.id));
  const [edgeRows, wikiRows, sourceMembershipRows] = await Promise.all([
    fetchEdgesForConcepts([...conceptToNode.keys()]),
    fetchWikiLinkRows(workspaceId, noteRows.map((row) => row.id)),
    fetchSourceMembershipRows(projectIds, [...conceptToNode.keys()]),
  ]);
  const edges = [
    ...buildWikiLinkEdges(wikiRows, selectedNodeIds),
    ...tree.edges.filter(
      (edge) => selectedNodeIds.has(edge.sourceId) && selectedNodeIds.has(edge.targetId),
    ),
    ...buildSourceMembershipAtlasEdges(sourceMembershipRows, nodes, conceptToNode),
    ...buildCoMentionAtlasEdges(nodes),
    ...buildAtlasEdges(edgeRows, nodes, conceptToNode),
  ];

  return {
    workspaceId,
    nodes,
    edges,
    readableProjectCount: readableProjects.length,
    totalConcepts,
    truncated: nodes.length < totalAvailableNodes,
    selection: "bridge-first",
  };
}
