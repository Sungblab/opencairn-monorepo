"use client";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { parseWorkspacePath } from "@/lib/url-parsers";

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

// Tiny helper around the current pathname so sidebar components stop spelling
// out the same workspace/project parsing everywhere. Workspace-level routes
// (dashboard/settings/import/...) do not carry a projectId in the URL, so the
// hook falls back to the last project selected inside the same workspace after
// mount. Keeping that fallback out of the initial render avoids SSR hydration
// drift when only the browser can read localStorage.
export function useCurrentProjectContext(): CurrentProjectContext {
  const pathname = usePathname() ?? "";
  const parsed = parseWorkspacePath(pathname);
  const params = useParams<{ wsSlug?: string }>();
  const wsSlug = parsed.wsSlug ?? params?.wsSlug ?? null;
  const routeProjectId = parsed.projectId;
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);

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
