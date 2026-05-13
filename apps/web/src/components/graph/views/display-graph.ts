import type { GroundedEdge, GroundedGraphResponse } from "../grounded-types";

const PRIMARY_SURFACES = new Set([
  "semantic_relation",
  "wiki_link",
  "sequence",
  "bridge",
]);

function nodeScore(node: GroundedGraphResponse["nodes"][number]): number {
  return (node.degree ?? 0) * 4 + (node.noteCount ?? 0) * 2;
}

function edgeScore(edge: GroundedEdge): number {
  const surfaceBoost =
    edge.surfaceType === "wiki_link"
      ? 18
      : edge.surfaceType === "semantic_relation"
        ? 12
        : edge.surfaceType === "sequence" || edge.surfaceType === "bridge"
          ? 10
          : 0;
  const supportBoost =
    edge.support?.status === "supported"
      ? 10
      : edge.support?.status === "weak"
        ? 3
        : edge.support?.status === "disputed"
          ? 2
          : 0;
  return surfaceBoost + supportBoost + (edge.weight ?? 1);
}

export function simplifyGraphForDefaultView(
  data: GroundedGraphResponse,
  options?: {
    maxNodes?: number;
    maxEdges?: number;
    includeDisplayEdges?: boolean;
  },
): GroundedGraphResponse {
  const maxNodes = options?.maxNodes ?? 28;
  const maxEdges = options?.maxEdges ?? 72;
  const includeDisplayEdges = options?.includeDisplayEdges ?? false;

  if (data.nodes.length <= maxNodes) {
    const edges = includeDisplayEdges
      ? data.edges
      : data.edges.filter((edge) =>
          PRIMARY_SURFACES.has(edge.surfaceType ?? "semantic_relation"),
        );
    return {
      ...data,
      edges: [...edges].sort((a, b) => edgeScore(b) - edgeScore(a)).slice(0, maxEdges),
      truncated: data.truncated || edges.length < data.edges.length,
    };
  }

  const selected = new Set(
    [...data.nodes]
      .sort((a, b) => nodeScore(b) - nodeScore(a) || a.name.localeCompare(b.name))
      .slice(0, maxNodes)
      .map((node) => node.id),
  );
  const edges = data.edges
    .filter((edge) => {
      if (!selected.has(edge.sourceId) || !selected.has(edge.targetId)) {
        return false;
      }
      return (
        includeDisplayEdges ||
        PRIMARY_SURFACES.has(edge.surfaceType ?? "semantic_relation")
      );
    })
    .sort((a, b) => edgeScore(b) - edgeScore(a))
    .slice(0, maxEdges);

  return {
    ...data,
    nodes: data.nodes.filter((node) => selected.has(node.id)),
    edges,
    truncated: true,
  };
}
