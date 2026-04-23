"use client";

import { useQueries } from "@tanstack/react-query";
import { api, type FolderRow, type NoteRow } from "@/lib/api-client";

export interface LegacyProjectTree {
  folders: FolderRow[];
  notes: NoteRow[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Pre-Phase-2 parallel fetch of folders + notes for the legacy Sidebar
 * component at `components/sidebar/Sidebar.tsx`. Renamed (and exported under
 * `useLegacyProjectTree`) when Phase 2 introduced the unified
 * `/api/projects/:id/tree` endpoint + SSE-driven `useProjectTree` at
 * `hooks/use-project-tree.ts`. Kept here until Task 14 swaps the legacy
 * Sidebar out of the app shell — at that point this file can be deleted.
 */
export function useLegacyProjectTree(projectId: string): LegacyProjectTree {
  const [foldersQ, notesQ] = useQueries({
    queries: [
      {
        queryKey: ["folders", projectId],
        queryFn: () => api.listFolders(projectId),
        enabled: Boolean(projectId),
      },
      {
        queryKey: ["notes-by-project", projectId],
        queryFn: () => api.listNotesByProject(projectId),
        enabled: Boolean(projectId),
      },
    ],
  });

  return {
    folders: foldersQ.data ?? [],
    notes: notesQ.data ?? [],
    isLoading: foldersQ.isLoading || notesQ.isLoading,
    isError: foldersQ.isError || notesQ.isError,
  };
}
