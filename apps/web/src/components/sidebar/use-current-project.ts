"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

export interface CurrentProjectContext {
  wsSlug: string | null;
  projectId: string | null;
}

// Tiny helper around useParams so sidebar components stop spelling out the
// same <{ wsSlug; projectId }> generic everywhere. Deliberately synchronous —
// the data fetch for the project record lives in useCurrentProjectData below
// so headers/hero can reuse it without pulling react-query into every caller.
export function useCurrentProjectContext(): CurrentProjectContext {
  const params = useParams<{ wsSlug?: string; projectId?: string }>();
  return {
    wsSlug: params?.wsSlug ?? null,
    projectId: params?.projectId ?? null,
  };
}

export interface CurrentProjectRecord {
  id: string;
  name: string;
  workspaceId: string;
}

// Fetches the currently selected project record. Gated on projectId so the
// hook is safe to mount on routes (dashboard, settings, ...) that have no
// project in scope. Callers treat `data === undefined` as "no project".
export function useCurrentProjectData(projectId: string | null) {
  return useQuery({
    queryKey: ["project", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<CurrentProjectRecord> => {
      const res = await fetch(`/api/projects/${projectId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`projects/${projectId} ${res.status}`);
      return (await res.json()) as CurrentProjectRecord;
    },
    staleTime: 30_000,
  });
}
