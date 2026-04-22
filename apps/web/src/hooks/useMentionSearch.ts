"use client";

// Plan 2B Task 19 — TanStack Query wrapper for GET /api/mentions/search.
// The server handles permission filtering (canRead per row); this hook just
// passes through (type, q, workspaceId) and returns the result list.
//
// `date` type is NOT queried — dates are user-typed in the combobox and
// inserted directly as `@[date:YYYY-MM-DD]`. Callers should pass
// `enabled: false` (or simply not call this hook) for the date tab.

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

export interface MentionSearchResult {
  type: "user" | "page" | "concept";
  id: string;
  label: string;
  sublabel?: string;
  avatarUrl?: string;
}

interface Args {
  type: "user" | "page" | "concept";
  q: string;
  workspaceId: string;
  enabled?: boolean;
}

export function useMentionSearch({
  type,
  q,
  workspaceId,
  enabled = true,
}: Args) {
  return useQuery({
    queryKey: ["mention-search", type, q, workspaceId],
    queryFn: () =>
      apiClient<{ results: MentionSearchResult[] }>(
        `/mentions/search?type=${type}&q=${encodeURIComponent(q)}&workspaceId=${workspaceId}`,
      ).then((r) => r.results),
    enabled: enabled && workspaceId.length > 0,
    // Short cache: results change as new members join / pages get created,
    // but 10s is plenty of reuse for rapid keystrokes in the combobox.
    staleTime: 10_000,
  });
}
