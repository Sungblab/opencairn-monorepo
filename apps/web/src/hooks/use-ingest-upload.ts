"use client";
import { useCallback, useState } from "react";
import { useIngestStore } from "@/stores/ingest-store";

// Bridges the project-view "Add source" button to /api/ingest/upload and the
// in-app live ingest store. Without this hook the spotlight + dock + tab
// viewer added by PR #56 had no UI call site to fire `startRun()` from, so
// the entire live-ingest UX was dead in production.
//
// API contract: POST /api/ingest/upload returns 202 { workflowId, objectKey }.
// We feed the workflowId into the store so the SSE listener attaches and the
// spotlight (when NEXT_PUBLIC_FEATURE_LIVE_INGEST=true) takes over the screen.

export interface IngestUploadResult {
  workflowId: string;
  objectKey: string;
  sourceBundleNodeId: string | null;
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
        // Drive the live-ingest store: spotlight (when flag is on) reacts to
        // spotlightWfid, dock subscribes via useIngestStream, tab can be
        // opened via tabs-store with kind='ingest' and targetId=workflowId.
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
