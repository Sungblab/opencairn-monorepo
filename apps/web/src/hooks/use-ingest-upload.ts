"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useIngestStore } from "@/stores/ingest-store";
import type { UploadIntentId } from "@/components/upload/upload-intents";

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

export interface IngestUploadManyResult {
  file: File;
  ok: boolean;
  result?: IngestUploadResult;
  error?: unknown;
}

interface IngestUploadOptions {
  noteId?: string;
  followUpIntent?: UploadIntentId | null;
  followUpBatchId?: string | null;
  followUpBatchSize?: number | null;
}

interface IngestUploadManyOptions extends IngestUploadOptions {
  concurrency?: number;
}

export function useIngestUpload(): {
  upload: (
    file: File,
    projectId: string,
    opts?: IngestUploadOptions,
  ) => Promise<IngestUploadResult>;
  uploadMany: (
    files: Iterable<File> | ArrayLike<File>,
    projectId: string,
    opts?: IngestUploadManyOptions,
  ) => Promise<IngestUploadManyResult[]>;
  isUploading: boolean;
  error: IngestUploadError | null;
} {
  const [activeUploads, setActiveUploads] = useState(0);
  const [error, setError] = useState<IngestUploadError | null>(null);
  const qc = useQueryClient();

  const refreshProjectTree = useCallback(
    async (projectId: string) => {
      await qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
      await qc.refetchQueries({
        queryKey: ["project-tree", projectId],
        type: "active",
      });
    },
    [qc],
  );

  const uploadOne = useCallback(
    async (
      file: File,
      projectId: string,
      opts?: IngestUploadOptions,
    ): Promise<IngestUploadResult> => {
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
          {
            sourceBundleNodeId: json.sourceBundleNodeId,
            projectId,
            followUpIntent: opts?.followUpIntent ?? null,
            followUpBatchId: opts?.followUpBatchId ?? null,
            followUpBatchSize: opts?.followUpBatchSize ?? null,
          },
        );
      await refreshProjectTree(projectId);
      return json;
    },
    [refreshProjectTree],
  );

  const upload = useCallback(
    async (
      file: File,
      projectId: string,
      opts?: IngestUploadOptions,
    ): Promise<IngestUploadResult> => {
      setActiveUploads((count) => count + 1);
      setError(null);
      try {
        return await uploadOne(file, projectId, opts);
      } finally {
        setActiveUploads((count) => Math.max(0, count - 1));
      }
    },
    [uploadOne],
  );

  const uploadMany = useCallback(
    async (
      files: Iterable<File> | ArrayLike<File>,
      projectId: string,
      opts?: IngestUploadManyOptions,
    ): Promise<IngestUploadManyResult[]> => {
      const selected = Array.from(files);
      if (selected.length === 0) return [];
      const concurrency = Math.max(
        1,
        Math.min(opts?.concurrency ?? 3, selected.length),
      );
      const followUpBatchId =
        opts?.followUpIntent === "comparison" && selected.length > 1
          ? `upload-batch-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`
          : (opts?.followUpBatchId ?? null);
      const uploadOpts: IngestUploadOptions = {
        ...opts,
        followUpBatchId,
        followUpBatchSize: followUpBatchId ? selected.length : null,
      };
      const results = new Array<IngestUploadManyResult>(selected.length);
      let cursor = 0;

      setActiveUploads((count) => count + selected.length);
      setError(null);
      try {
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (cursor < selected.length) {
              const index = cursor;
              cursor += 1;
              const file = selected[index]!;
              try {
                results[index] = {
                  file,
                  ok: true,
                  result: await uploadOne(file, projectId, uploadOpts),
                };
              } catch (err) {
                results[index] = { file, ok: false, error: err };
              }
            }
          }),
        );
        return results;
      } finally {
        setActiveUploads((count) => Math.max(0, count - selected.length));
      }
    },
    [uploadOne],
  );

  return { upload, uploadMany, isUploading: activeUploads > 0, error };
}
