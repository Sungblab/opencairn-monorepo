import type { GroundedGraphResponse } from "../grounded-types";

export const GRAPH_LABEL_MAX = 18;
export const GRAPH_FULL_LABEL_ZOOM_THRESHOLD = 1.65;
const GRAPH_TOP_LABEL_ZOOM_THRESHOLD = 1.35;
const GRAPH_TOP_LABEL_LIMIT = 6;
const HUB_DEGREE_THRESHOLD = 10;
const GRAPH_NODE_COLORS = [
  "#22c55e",
  "#06b6d4",
  "#f97316",
  "#a78bfa",
  "#60a5fa",
  "#f43f5e",
] as const;
const HUB_NODE_COLOR = "#ef4444";
const NOTE_HUB_COLOR = "#ef4444";

export type ForceGraphNode = {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  kind: "concept" | "note";
  degree: number;
  noteCount: number;
  firstNoteId: string | null;
  val: number;
  color: string;
  isHub: boolean;
};

export type ForceGraphLink = {
  edgeId: string;
  source: string;
  target: string;
  relationType: string;
  weight: number;
  supportStatus?: string;
  surfaceType?: string;
  displayOnly?: boolean;
  synthetic?: boolean;
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

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function graphNodeColor(id: string, degree: number): string {
  if (degree >= HUB_DEGREE_THRESHOLD) return HUB_NODE_COLOR;
  return GRAPH_NODE_COLORS[hashString(id) % GRAPH_NODE_COLORS.length];
}

export function buildForceGraphData(
  snap: GroundedGraphResponse,
): ForceGraphData {
  const noteTitles = new Map<string, string>();
  const noteConceptIds = new Map<string, Set<string>>();
  const addNoteConcept = (noteId: string | null | undefined, conceptId: string) => {
    if (!noteId) return;
    if (!noteConceptIds.has(noteId)) noteConceptIds.set(noteId, new Set());
    noteConceptIds.get(noteId)?.add(conceptId);
  };
  const nodes = snap.nodes.map((node) => {
    const degree = node.degree ?? 0;
    if (node.firstNoteId) {
      addNoteConcept(node.firstNoteId, node.id);
    }
    return {
      id: node.id,
      name: node.name,
      shortLabel: truncateGraphLabel(node.name),
      description: node.description ?? "",
      kind: "concept" as const,
      degree,
      noteCount: node.noteCount ?? 0,
      firstNoteId: node.firstNoteId ?? null,
      val: Math.max(5, Math.min(18, 6 + Math.sqrt(degree + 1) * 2.6)),
      color: graphNodeColor(node.id, degree),
      isHub: degree >= HUB_DEGREE_THRESHOLD,
    };
  });
  for (const edge of snap.edges) {
    for (const note of edge.sourceNotes ?? []) {
      noteTitles.set(note.id, note.title);
      addNoteConcept(note.id, edge.sourceId);
      addNoteConcept(note.id, edge.targetId);
    }
    for (const context of edge.sourceContexts ?? []) {
      noteTitles.set(context.noteId, context.noteTitle);
      addNoteConcept(context.noteId, edge.sourceId);
      addNoteConcept(context.noteId, edge.targetId);
    }
  }
  const noteHubNodes: ForceGraphNode[] = [...noteConceptIds.entries()].map(
    ([noteId, conceptIds]) => {
      const degree = conceptIds.size;
      const title = noteTitles.get(noteId) ?? "출처 노트";
      return {
        id: `note:${noteId}`,
        name: title,
        shortLabel: truncateGraphLabel(title, 28),
        description: "",
        kind: "note",
        degree,
        noteCount: 1,
        firstNoteId: noteId,
        val: Math.max(7, Math.min(22, 8 + Math.sqrt(degree + 1) * 3.4)),
        color: NOTE_HUB_COLOR,
        isHub: degree >= 2,
      };
    },
  );
  const allNodes = [...nodes, ...noteHubNodes];
  const topNodeIds = new Set(
    [...nodes, ...noteHubNodes]
      .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
      .slice(0, Math.min(GRAPH_TOP_LABEL_LIMIT, allNodes.length))
      .map((node) => node.id),
  );
  const links = snap.edges.map((edge) => ({
    edgeId: edgeId(edge),
    source: edge.sourceId,
    target: edge.targetId,
    relationType: edge.relationType,
    weight: edge.weight,
    supportStatus: edge.support?.status,
    surfaceType: edge.surfaceType,
    displayOnly: edge.displayOnly,
  }));
  const noteHubLinks: ForceGraphLink[] = [...noteConceptIds.entries()].flatMap(
    ([noteId, conceptIds]) =>
      [...conceptIds].map((conceptId) => ({
        edgeId: `note:${noteId}:${conceptId}`,
        source: `note:${noteId}`,
        target: conceptId,
        relationType: "source-note",
        weight: 1,
        synthetic: true,
      })),
  );

  return { nodes: allNodes, links: [...noteHubLinks, ...links], topNodeIds };
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
  const topNode = opts.topNodeIds.has(node.id);
  const interactive =
    opts.hoveredNodeId === node.id ||
    opts.selectedNodeId === node.id ||
    opts.neighborIds.has(node.id);

  if (interactive) return node.shortLabel;
  if (topNode && opts.zoom >= GRAPH_TOP_LABEL_ZOOM_THRESHOLD) {
    return node.shortLabel;
  }
  if (opts.zoom < GRAPH_FULL_LABEL_ZOOM_THRESHOLD) return "";
  return node.shortLabel;
}

export function getGraphLabelFontSize(opts: {
  zoom: number;
  important: boolean;
}): number {
  if (!opts.important && opts.zoom < GRAPH_FULL_LABEL_ZOOM_THRESHOLD) return 0;
  if (opts.important) return opts.zoom >= 1.8 ? 8 : 7;
  return 7;
}
