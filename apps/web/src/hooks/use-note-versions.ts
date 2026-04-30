"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createNoteCheckpoint,
  getNoteVersion,
  getNoteVersionDiff,
  listNoteVersions,
  restoreNoteVersion,
  type NoteVersionDiffAgainst,
} from "@/lib/api-client-note-versions";

export const noteVersionKeys = {
  list: (noteId: string) => ["note-versions", noteId] as const,
  detail: (noteId: string, version: number | null) =>
    ["note-version", noteId, version] as const,
  diff: (
    noteId: string,
    version: number | null,
    against: NoteVersionDiffAgainst,
  ) => ["note-version-diff", noteId, version, against] as const,
};

export function useNoteVersions(noteId: string, enabled = true) {
  return useQuery({
    queryKey: noteVersionKeys.list(noteId),
    queryFn: () => listNoteVersions(noteId),
    enabled: enabled && Boolean(noteId),
  });
}

export function useNoteVersionDetail(noteId: string, version: number | null) {
  return useQuery({
    queryKey: noteVersionKeys.detail(noteId, version),
    queryFn: () => getNoteVersion(noteId, version as number),
    enabled: Boolean(noteId && version),
  });
}

export function useNoteVersionDiff(
  noteId: string,
  version: number | null,
  enabled: boolean,
  against: NoteVersionDiffAgainst = "current",
) {
  return useQuery({
    queryKey: noteVersionKeys.diff(noteId, version, against),
    queryFn: () => getNoteVersionDiff(noteId, version as number, against),
    enabled: enabled && Boolean(noteId && version),
  });
}

export function useCreateNoteCheckpoint(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => createNoteCheckpoint(noteId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: noteVersionKeys.list(noteId) });
    },
  });
}

export function useRestoreNoteVersion(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => restoreNoteVersion(noteId, version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["note", noteId] });
      void qc.invalidateQueries({ queryKey: noteVersionKeys.list(noteId) });
    },
  });
}
