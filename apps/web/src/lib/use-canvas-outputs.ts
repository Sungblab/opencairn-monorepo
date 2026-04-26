"use client";

// Plan 7 Canvas Phase 2 — React Query hook over `/api/canvas/output(s)`.
//
// Two responsibilities:
//   1. List the canvas outputs attached to a note (GET).
//   2. Upload a new image/svg blob attached to a note (multipart POST).
//
// The upload path uses `FormData` so the browser produces the correct
// `multipart/form-data; boundary=...` header. `apiClient` (see ./api-client)
// detects FormData bodies and skips its default JSON Content-Type — without
// that, the server-side multipart parser would never see a boundary and
// fail to read the file part.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./api-client";

export interface CanvasOutputItem {
  id: string;
  urlPath: string;
  runId: string | null;
  mimeType: "image/png" | "image/svg+xml";
  bytes: number;
  createdAt: string;
}

export interface CanvasOutputUploadResult {
  id: string;
  urlPath: string;
}

export const canvasOutputsKeys = {
  list: (noteId: string) => ["canvas-outputs", noteId] as const,
};

export function useCanvasOutputs(noteId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: canvasOutputsKeys.list(noteId),
    queryFn: () =>
      apiClient<{ outputs: CanvasOutputItem[] }>(
        `/canvas/outputs?noteId=${encodeURIComponent(noteId)}`,
      ),
    // The list call is meaningless without a note; React Query will still
    // expose `data: undefined` while disabled.
    enabled: !!noteId,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({
      blob,
      runId,
    }: {
      blob: Blob;
      runId?: string;
    }): Promise<CanvasOutputUploadResult> => {
      const fd = new FormData();
      fd.append("noteId", noteId);
      if (runId) fd.append("runId", runId);
      fd.append("mimeType", blob.type);
      fd.append("file", blob);
      return apiClient<CanvasOutputUploadResult>(`/canvas/output`, {
        method: "POST",
        body: fd,
      });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: canvasOutputsKeys.list(noteId) }),
  });

  return {
    ...query,
    upload: uploadMutation.mutateAsync,
    uploading: uploadMutation.isPending,
  };
}
