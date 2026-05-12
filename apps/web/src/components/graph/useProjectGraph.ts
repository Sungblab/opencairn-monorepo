"use client";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GraphExpandResponse,
  ViewSpec,
  ViewType,
} from "@opencairn/shared";
import type { GroundedGraphResponse } from "./grounded-types";
import { useViewStateStore } from "./view-state-store";

const STALE_MS = 30_000;

interface Options {
  view?: ViewType;
  root?: string;
}

const GROUNDED_VIEWS = new Set<ViewType>([
  "graph",
  "mindmap",
  "cards",
  "timeline",
  "board",
]);

async function fetchGraphView(
  projectId: string,
  opts: Options,
  signal?: AbortSignal,
): Promise<GroundedGraphResponse> {
  const params = new URLSearchParams();
  // Phase 1 default: ?view=graph + degree-ordered top-500. Stays regression-zero
  // for callers that pass no opts (e.g. ProjectGraph from Phase 1).
  const view = opts.view ?? "graph";
  params.set("view", view);
  if (opts.root) params.set("root", opts.root);
  let path = `/api/projects/${projectId}/graph`;
  if (GROUNDED_VIEWS.has(view)) {
    path = `/api/projects/${projectId}/knowledge-surface`;
    params.set("includeEvidence", "true");
  } else {
    params.set("limit", "500");
    params.set("order", "degree");
  }
  const res = await fetch(
    `${path}?${params.toString()}`,
    { credentials: "include", signal },
  );
  if (!res.ok) throw new Error(`graph ${res.status}`);
  return (await res.json()) as GroundedGraphResponse;
}

function edgeId(edge: ViewSpec["edges"][number]): string {
  return edge.id ?? `${edge.sourceId}->${edge.targetId}:${edge.relationType}`;
}

function groundedFromInline(inline: ViewSpec): GroundedGraphResponse {
  return {
    ...inline,
    edges: inline.edges.map((edge) => ({
      ...edge,
      id: edgeId(edge),
      surfaceType: edge.surfaceType ?? "semantic_relation",
      displayOnly: edge.displayOnly ?? false,
      sourceNoteIds: edge.sourceNoteIds ?? [],
      sourceNotes: edge.sourceNotes ?? [],
      sourceContexts: edge.sourceContexts ?? [],
    })),
    truncated: false,
    totalConcepts: inline.nodes.length,
  };
}

export function useProjectGraph(projectId: string, opts: Options = {}) {
  const view = opts.view ?? "graph";
  const root = opts.root ?? null;
  // Inline ViewSpec emitted by the Visualization Agent takes priority — when
  // present we synthesise a GraphViewResponse from it and skip the network
  // round-trip entirely (Plan 5 Phase 2 § view-state-store).
  const inline = useViewStateStore((s) => s.getInline(projectId, view, root));
  const qc = useQueryClient();
  // Cache key is partitioned by (projectId, view, root) so switching views
  // doesn't blow away the previous view's data and triggers an isolated fetch.
  const queryKey = ["project-graph", projectId, view, root] as const;

  const query = useQuery<GroundedGraphResponse>({
    queryKey,
    enabled: !!projectId,
    staleTime: STALE_MS,
    queryFn: async ({ signal }) => {
      if (inline) {
        return groundedFromInline(inline);
      }
      return fetchGraphView(projectId, opts, signal);
    },
  });

  const expand = useCallback(
    async (conceptId: string, hops: number = 1) => {
      const res = await fetch(
        `/api/projects/${projectId}/graph/expand/${conceptId}?hops=${hops}`,
      );
      if (!res.ok) throw new Error(`expand ${res.status}`);
      const slice = (await res.json()) as GraphExpandResponse;
      qc.setQueryData<GroundedGraphResponse>(queryKey, (prev) => {
        if (!prev) return prev;
        const nodeMap = new Map(prev.nodes.map((n) => [n.id, n]));
        for (const n of slice.nodes) nodeMap.set(n.id, n);
        const edgeMap = new Map(prev.edges.map((e) => [e.id, e]));
        for (const e of slice.edges) edgeMap.set(e.id, e);
        return {
          ...prev,
          nodes: [...nodeMap.values()],
          edges: [...edgeMap.values()],
        };
      });
    },
    [projectId, qc, queryKey],
  );

  return { ...query, expand };
}
