"use client";

import { useQueries } from "@tanstack/react-query";
import { api, type FolderRow, type NoteRow } from "@/lib/api-client";

export interface ProjectTree {
  folders: FolderRow[];
  notes: NoteRow[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Parallel fetch of folders + notes for a project, shaped for the sidebar
 * tree view (Task 9/10). Both queries share the `projectId` cache dimension
 * so invalidation can target `["folders", projectId]` / `["notes-by-project",
 * projectId]` on mutations.
 */
export function useProjectTree(projectId: string): ProjectTree {
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
