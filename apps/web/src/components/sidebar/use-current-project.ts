"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

export interface CurrentProjectContext {
  wsSlug: string | null;
  projectId: string | null;
  routeProjectId: string | null;
}

const LAST_PROJECT_PREFIX = "opencairn:last-project:";

function storageKey(wsSlug: string) {
  return `${LAST_PROJECT_PREFIX}${wsSlug}`;
}

function readLastProject(wsSlug: string | null) {
  if (!wsSlug || typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey(wsSlug));
}

// Tiny helper around useParams so sidebar components stop spelling out the
// same <{ wsSlug; projectId }> generic everywhere. Workspace-level routes
// (dashboard/settings/import/...) do not carry a projectId in the URL, so the
// hook falls back to the last project selected inside the same workspace.
// The data fetch for the project record lives in useCurrentProjectData below.
export function useCurrentProjectContext(): CurrentProjectContext {
  const params = useParams<{ wsSlug?: string; projectId?: string }>();
  const wsSlug = params?.wsSlug ?? null;
  const routeProjectId = params?.projectId ?? null;
  const [lastProjectId, setLastProjectId] = useState<string | null>(() =>
    readLastProject(wsSlug),
  );

  useEffect(() => {
    setLastProjectId(readLastProject(wsSlug));
  }, [wsSlug]);

  useEffect(() => {
    if (!wsSlug || !routeProjectId || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(wsSlug), routeProjectId);
    setLastProjectId(routeProjectId);
  }, [wsSlug, routeProjectId]);

  return {
    wsSlug,
    projectId: routeProjectId ?? lastProjectId,
    routeProjectId,
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
