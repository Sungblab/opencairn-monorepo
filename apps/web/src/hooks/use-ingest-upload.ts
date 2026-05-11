"use client";
import { useCallback, useState } from "react";
import { useIngestStore } from "@/stores/ingest-store";

// Bridges upload entry points to /api/ingest/upload and the in-app ingest
// store. Uploads open the original file first; a background app-shell
// subscriber watches the workflow and only reports terminal status.
//
// API contract: POST /api/ingest/upload returns 202 { workflowId, objectKey }.
// We feed the workflowId into the store so the SSE listener can attach.

export interface IngestUploadResult {
  workflowId: string;
  objectKey: string;
  sourceBundleNodeId: string | null;
  originalFileId: string | null;
}

export interface IngestUploadError {
  status: number;
  message: string;
}

export function useIngestUpload(): {
  upload: (
    file: File,
    projectId: string,
    opts?: { noteId?: string },
  ) => Promise<IngestUploadResult>;
  isUploading: boolean;
  error: IngestUploadError | null;
} {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<IngestUploadError | null>(null);

  const upload = useCallback(
    async (
      file: File,
      projectId: string,
      opts?: { noteId?: string },
    ): Promise<IngestUploadResult> => {
      setIsUploading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("projectId", projectId);
        if (opts?.noteId) fd.append("noteId", opts.noteId);

        // Same-origin fetch → cookies attach automatically. We bypass
        // apiClient because the response is a 202 (apiClient treats
        // anything but 204 as JSON) and we want narrow control of the
        // error shape for the UI. The Hono /api/ingest/upload handler
        // explicitly returns JSON on 202, so res.json() is safe.
        const res = await fetch("/api/ingest/upload", {
          method: "POST",
          credentials: "include",
          body: fd,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          const err: IngestUploadError = {
            status: res.status,
            message: body.error ?? `upload_failed_${res.status}`,
          };
          setError(err);
          throw err;
        }

        const json = (await res.json()) as IngestUploadResult;
        // Drive the background ingest store; UI feedback is owned by
        // IngestNotifications in the app shell.
        useIngestStore
          .getState()
          .startRun(
            json.workflowId,
            file.type || "application/octet-stream",
            file.name,
            { sourceBundleNodeId: json.sourceBundleNodeId },
          );
        return json;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return { upload, isUploading, error };
}
