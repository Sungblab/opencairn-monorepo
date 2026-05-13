import type { ViewNode } from "@opencairn/shared";
import type { GroundedEdge } from "../grounded-types";

const CENTER_X = 640;
const CENTER_Y = 420;
const LEVEL_RADIUS = 210;
const OUTER_RING_GAP = 120;
const CANVAS_PADDING = 220;
const SINGLE_CHILD_ANGLE_STEP = 0.78;

export type MindmapPresetPosition = {
  x: number;
  y: number;
};

export type MindmapPresetLayout = {
  rootId: string | null;
  positions: Map<string, MindmapPresetPosition>;
  width: number;
  height: number;
};

function chooseRoot(
  nodes: ViewNode[],
  edges: GroundedEdge[],
  requestedRootId: string | null | undefined,
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (requestedRootId && nodeIds.has(requestedRootId)) return requestedRootId;
  const incidentCounts = new Map<string, number>();
  for (const edge of edges) {
    if (nodeIds.has(edge.sourceId)) {
      incidentCounts.set(edge.sourceId, (incidentCounts.get(edge.sourceId) ?? 0) + 1);
    }
    if (nodeIds.has(edge.targetId)) {
      incidentCounts.set(edge.targetId, (incidentCounts.get(edge.targetId) ?? 0) + 1);
    }
  }
  return [...nodes].sort((a, b) => {
    const incidentDelta =
      (incidentCounts.get(b.id) ?? 0) - (incidentCounts.get(a.id) ?? 0);
    if (incidentDelta !== 0) return incidentDelta;
    const degreeDelta = (b.degree ?? 0) - (a.degree ?? 0);
    if (degreeDelta !== 0) return degreeDelta;
    return a.name.localeCompare(b.name);
  })[0]?.id ?? null;
}

function sortedNeighbors(
  ids: Set<string> | undefined,
  nodeById: Map<string, ViewNode>,
  incidentCounts: Map<string, number>,
) {
  return [...(ids ?? [])].sort((a, b) => {
    const incidentDelta = (incidentCounts.get(b) ?? 0) - (incidentCounts.get(a) ?? 0);
    if (incidentDelta !== 0) return incidentDelta;
    return (nodeById.get(a)?.name ?? a).localeCompare(nodeById.get(b)?.name ?? b);
  });
}

function positionLevel(
  ids: string[],
  level: number,
  positions: Map<string, MindmapPresetPosition>,
) {
  const radius = LEVEL_RADIUS * level;
  const levelOffset = (level - 1) * SINGLE_CHILD_ANGLE_STEP;
  ids.forEach((id, index) => {
    const angle =
      ids.length === 1
        ? -Math.PI / 2 + levelOffset
        : -Math.PI / 2 + levelOffset + (index / ids.length) * Math.PI * 2;
    positions.set(id, {
      x: CENTER_X + Math.cos(angle) * radius,
      y: CENTER_Y + Math.sin(angle) * radius,
    });
  });
}

export function layoutMindmapPreset(
  nodes: ViewNode[],
  edges: GroundedEdge[],
  requestedRootId: string | null | undefined,
): MindmapPresetLayout {
  const positions = new Map<string, MindmapPresetPosition>();
  if (nodes.length === 0) {
    return { rootId: null, positions, width: 960, height: 640 };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodeById.keys());
  const adjacency = new Map<string, Set<string>>();
  const incidentCounts = new Map<string, number>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
    if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set());
    if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set());
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
    incidentCounts.set(edge.sourceId, (incidentCounts.get(edge.sourceId) ?? 0) + 1);
    incidentCounts.set(edge.targetId, (incidentCounts.get(edge.targetId) ?? 0) + 1);
  }

  const rootId = chooseRoot(nodes, edges, requestedRootId);
  if (!rootId) {
    return { rootId: null, positions, width: 960, height: 640 };
  }

  positions.set(rootId, { x: CENTER_X, y: CENTER_Y });
  const visited = new Set([rootId]);
  const levels = new Map<number, string[]>();
  const queue: Array<{ id: string; level: number }> = [{ id: rootId, level: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const nextId of sortedNeighbors(
      adjacency.get(current.id),
      nodeById,
      incidentCounts,
    )) {
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      const level = current.level + 1;
      levels.set(level, [...(levels.get(level) ?? []), nextId]);
      queue.push({ id: nextId, level });
    }
  }

  for (const [level, ids] of levels) {
    positionLevel(ids, level, positions);
  }

  const disconnected = nodes
    .filter((node) => !visited.has(node.id))
    .sort((a, b) => {
      const incidentDelta =
        (incidentCounts.get(b.id) ?? 0) - (incidentCounts.get(a.id) ?? 0);
      if (incidentDelta !== 0) return incidentDelta;
      return a.name.localeCompare(b.name);
    });
  if (disconnected.length > 0) {
    const baseRadius = LEVEL_RADIUS * (Math.max(1, ...levels.keys()) + 1);
    disconnected.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / disconnected.length) * Math.PI * 2;
      const radius = baseRadius + (index % 2) * OUTER_RING_GAP;
      positions.set(node.id, {
        x: CENTER_X + Math.cos(angle) * radius,
        y: CENTER_Y + Math.sin(angle) * radius,
      });
    });
  }

  const xs = [...positions.values()].map((pos) => pos.x);
  const ys = [...positions.values()].map((pos) => pos.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  if (minX < CANVAS_PADDING || minY < CANVAS_PADDING) {
    const dx = Math.max(0, CANVAS_PADDING - minX);
    const dy = Math.max(0, CANVAS_PADDING - minY);
    for (const pos of positions.values()) {
      pos.x += dx;
      pos.y += dy;
    }
  }

  const maxX = Math.max(...[...positions.values()].map((pos) => pos.x));
  const maxY = Math.max(...[...positions.values()].map((pos) => pos.y));
  return {
    rootId,
    positions,
    width: Math.max(960, maxX + CANVAS_PADDING),
    height: Math.max(640, maxY + CANVAS_PADDING),
  };
}
