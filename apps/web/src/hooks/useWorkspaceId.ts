"use client";

import { useQuery } from "@tanstack/react-query";

// Resolve a workspace slug → id. The /api/workspaces/by-slug/:slug endpoint
// already enforces membership so an unauthorised slug returns 404 rather
// than leaking existence via timing.
async function fetchWorkspaceId(slug: string): Promise<string | null> {
  const res = await fetch(`/api/workspaces/by-slug/${slug}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { id: string };
  return json.id;
}

export function useWorkspaceId(wsSlug: string): string | null {
  const q = useQuery({
    queryKey: ["workspace-id", wsSlug],
    queryFn: () => fetchWorkspaceId(wsSlug),
    staleTime: 5 * 60_000,
    enabled: Boolean(wsSlug),
  });
  return q.data ?? null;
}
