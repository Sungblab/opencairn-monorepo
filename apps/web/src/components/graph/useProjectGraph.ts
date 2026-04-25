"use client";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GraphResponse, GraphExpandResponse } from "@opencairn/shared";
import type { GraphSnapshot } from "./graph-types";

const STALE_MS = 30_000;

export function useProjectGraph(projectId: string) {
  const qc = useQueryClient();
  const queryKey = ["project-graph", projectId] as const;

  const query = useQuery<GraphSnapshot>({
    queryKey,
    enabled: !!projectId,
    staleTime: STALE_MS,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/projects/${projectId}/graph?limit=500&order=degree`, { signal });
      if (!res.ok) throw new Error(`graph ${res.status}`);
      const body = (await res.json()) as GraphResponse;
      return body;
    },
  });

  const expand = useCallback(
    async (conceptId: string, hops: number = 1) => {
      const res = await fetch(
        `/api/projects/${projectId}/graph/expand/${conceptId}?hops=${hops}`,
      );
      if (!res.ok) throw new Error(`expand ${res.status}`);
      const slice = (await res.json()) as GraphExpandResponse;
      qc.setQueryData<GraphSnapshot>(queryKey, (prev) => {
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
