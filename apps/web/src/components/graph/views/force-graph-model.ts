import type { GroundedGraphResponse } from "../grounded-types";

export const GRAPH_LABEL_MAX = 28;
export const GRAPH_FULL_LABEL_ZOOM_THRESHOLD = 1.0;

export type ForceGraphNode = {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  degree: number;
  noteCount: number;
  firstNoteId: string | null;
  val: number;
};

export type ForceGraphLink = {
  edgeId: string;
  source: string;
  target: string;
  relationType: string;
  weight: number;
  supportStatus?: string;
};

export type ForceGraphData = {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
  topNodeIds: Set<string>;
};

export type GraphNeighborhood = {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
};

export function truncateGraphLabel(label: string, max = GRAPH_LABEL_MAX): string {
  const trimmed = label.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1))}...`;
}

type EdgeIdentity = {
  id?: string;
  sourceId: string;
  targetId: string;
  relationType: string;
};

function edgeId(edge: EdgeIdentity): string {
  return edge.id ?? `${edge.sourceId}->${edge.targetId}:${edge.relationType}`;
}

export function buildForceGraphData(
  snap: GroundedGraphResponse,
): ForceGraphData {
  const nodes = snap.nodes.map((node) => {
    const degree = node.degree ?? 0;
    return {
      id: node.id,
      name: node.name,
      shortLabel: truncateGraphLabel(node.name),
      description: node.description ?? "",
      degree,
      noteCount: node.noteCount ?? 0,
      firstNoteId: node.firstNoteId ?? null,
      val: Math.max(3, Math.min(12, 3 + Math.sqrt(degree + 1) * 2)),
    };
  });
  const topNodeIds = new Set(
    [...nodes]
      .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
      .slice(0, Math.min(12, nodes.length))
      .map((node) => node.id),
  );
  const links = snap.edges.map((edge) => ({
    edgeId: edgeId(edge),
    source: edge.sourceId,
    target: edge.targetId,
    relationType: edge.relationType,
    weight: edge.weight,
    supportStatus: edge.support?.status,
  }));

  return { nodes, links, topNodeIds };
}

export function getGraphNeighborhood(
  edges: GroundedGraphResponse["edges"],
  nodeId: string | null,
): GraphNeighborhood {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!nodeId) return { nodeIds, edgeIds };
  nodeIds.add(nodeId);
  for (const edge of edges) {
    if (edge.sourceId !== nodeId && edge.targetId !== nodeId) continue;
    nodeIds.add(edge.sourceId);
    nodeIds.add(edge.targetId);
    edgeIds.add(edgeId(edge));
  }
  return { nodeIds, edgeIds };
}

export function getGraphLabel(
  node: ForceGraphNode,
  opts: {
    zoom: number;
    topNodeIds: Set<string>;
    hoveredNodeId: string | null;
    selectedNodeId: string | null;
    neighborIds: Set<string>;
  },
): string {
  const important =
    opts.topNodeIds.has(node.id) ||
    opts.hoveredNodeId === node.id ||
    opts.selectedNodeId === node.id ||
    opts.neighborIds.has(node.id);

  if (!important && opts.zoom < GRAPH_FULL_LABEL_ZOOM_THRESHOLD) return "";
  return node.shortLabel;
}
