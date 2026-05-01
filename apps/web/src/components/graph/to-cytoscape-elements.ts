import type { CytoscapeElement, FilterState, GraphSnapshot } from "./graph-types";
import type { EdgeSupport, GroundedEdge } from "./grounded-types";

function edgeSupport(edge: GraphSnapshot["edges"][number]): EdgeSupport | undefined {
  return "support" in edge ? (edge as GroundedEdge).support : undefined;
}

/**
 * Project the GraphResponse + active filters into the Cytoscape elements
 * shape. Edges are dropped if either endpoint is filtered out — Cytoscape
 * tolerates dangling edges, but the visual is misleading.
 */
export function toCytoscapeElements(
  snap: GraphSnapshot,
  filters: FilterState,
): CytoscapeElement[] {
  const search = filters.search.trim().toLowerCase();
  const visibleNodeIds = new Set<string>();
  const nodeElements: CytoscapeElement[] = [];
  for (const n of snap.nodes) {
    if (search && !n.name.toLowerCase().includes(search)) continue;
    visibleNodeIds.add(n.id);
    nodeElements.push({
      data: {
        id: n.id,
        label: n.name,
        type: "node",
        // Plan 5 Phase 2: ViewNode makes degree/firstNoteId optional (mindmap
        // / cards / timeline / board sometimes don't carry them). Default to
        // 0 / null so downstream styling + the open-first-note action stay
        // safe — Phase 1 GraphNodes always supply these so behavior is
        // unchanged for the default `view=graph` path.
        degree: n.degree ?? 0,
        firstNoteId: n.firstNoteId ?? null,
      },
    });
  }
  const edgeElements: CytoscapeElement[] = [];
  for (const e of snap.edges) {
    const support = edgeSupport(e);
    if (!visibleNodeIds.has(e.sourceId)) continue;
    if (!visibleNodeIds.has(e.targetId)) continue;
    if (filters.relation && e.relationType !== filters.relation) continue;
    edgeElements.push({
      data: {
        // Plan 5 Phase 2: ViewEdge.id is optional (AI-emitted ViewSpecs may
        // omit it). Cytoscape requires a stable id per element — synthesise
        // one from source/target/relation when missing so re-renders don't
        // shuffle edges around.
        id: e.id ?? `${e.sourceId}->${e.targetId}:${e.relationType}`,
        source: e.sourceId,
        target: e.targetId,
        type: "edge",
        relationType: e.relationType,
        weight: e.weight,
        supportStatus: support?.status,
        supportScore: support?.supportScore,
        citationCount: support?.citationCount,
        evidenceBundleId: support?.evidenceBundleId,
      },
    });
  }
  return [...nodeElements, ...edgeElements];
}
