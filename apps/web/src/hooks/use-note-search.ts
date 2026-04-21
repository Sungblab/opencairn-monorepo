"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

/**
 * Title substring search, scoped to a project. Enabled only when `q` has at
 * least one character AND `projectId` is set — prevents the combobox from
 * hammering the API on empty input.
 */
export function useNoteSearch(q: string, projectId: string) {
  return useQuery({
    queryKey: ["note-search", projectId, q],
    queryFn: () => api.searchNotes(q, projectId),
    enabled: q.length >= 1 && Boolean(projectId),
    staleTime: 15_000,
  });
}
