"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import debounce from "lodash.debounce";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  type NoteRow,
  type PatchNoteBody,
} from "@/lib/api-client";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseSaveNoteResult {
  save: ((body: PatchNoteBody) => void) & { cancel: () => void; flush: () => void };
  flush: (body: PatchNoteBody) => void;
  status: SaveStatus;
  lastError: string | null;
}

/**
 * Debounced PATCH /notes/:id hook used by the editor.
 *
 * - `save(body)`  : 500ms-debounced save; subsequent calls coalesce.
 * - `flush(body)` : cancels pending debounce + saves synchronously (e.g. on
 *   blur / route change).
 * - `status`      : idle | saving | saved | error — drive the status pill.
 * - `lastError`   : ApiError message when `status === "error"`.
 */
export function useSaveNote(noteId: string): UseSaveNoteResult {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: PatchNoteBody) => api.patchNote(noteId, body),
    onMutate: () => {
      setStatus("saving");
    },
    onSuccess: (note: NoteRow) => {
      qc.setQueryData(["note", noteId], note);
      setStatus("saved");
      setLastError(null);
    },
    onError: (err: unknown) => {
      setStatus("error");
      setLastError(err instanceof ApiError ? err.message : String(err));
    },
  });

  // Ref keeps the debounced closure stable across renders while still
  // calling the latest `mutate` (which closes over the latest noteId).
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const debouncedSave = useMemo(
    () => debounce((body: PatchNoteBody) => mutateRef.current(body), 500),
    [],
  );

  // Cancel pending debounced calls on unmount to avoid leaking a save after
  // the component is gone.
  useEffect(() => () => debouncedSave.cancel(), [debouncedSave]);

  return {
    save: debouncedSave,
    flush: (body: PatchNoteBody) => {
      debouncedSave.cancel();
      mutation.mutate(body);
    },
    status,
    lastError,
  };
}
