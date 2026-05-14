"use client";

import { useId, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIngestUpload } from "@/hooks/use-ingest-upload";

export const PROJECT_UPLOAD_ACCEPT_ATTR = [
  "application/pdf",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".hwp",
  ".hwpx",
  "text/plain",
  "text/markdown",
  ".txt",
  ".md",
  "image/*",
  "audio/*",
  "video/*",
].join(",");

export function useProjectUploadDialog({
  projectId,
  onUploaded,
  openOriginal = true,
}: {
  projectId: string | null;
  onUploaded?: () => void | Promise<void>;
  openOriginal?: boolean;
}) {
  const tUpload = useTranslations("sidebar.upload");
  const { uploadMany, isUploading, error } = useIngestUpload();
  const uploadInFlightRef = useRef(false);
  const [localUploading, setLocalUploading] = useState(false);
  const [localError, setLocalError] = useState(false);

  async function startUpload(files: File[]) {
    if (!projectId || files.length === 0 || uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setLocalUploading(true);
    setLocalError(false);
    try {
      const results = await uploadMany(files, projectId, { concurrency: 3 });
      if (openOriginal) {
        const firstOpened = results.find(
          (item) => item.ok && item.result?.originalFileId,
        );
        if (firstOpened?.result?.originalFileId) {
          openOriginalFileTab(
            firstOpened.result.originalFileId,
            firstOpened.file.name,
          );
        }
      }
      await onUploaded?.();
      const failed = results.some((item) => !item.ok);
      setLocalError(failed);
      if (failed) toast.error(tUpload("error"));
      return { ok: !failed };
    } catch {
      setLocalError(true);
      toast.error(tUpload("error"));
      return { ok: false };
    } finally {
      uploadInFlightRef.current = false;
      setLocalUploading(false);
    }
  }

  return {
    startUpload,
    isUploading: isUploading || localUploading,
    hasUploadError: Boolean(error) || localError,
  };
}

export function ProjectUploadDialog({
  open,
  files,
  uploading,
  error,
  onOpenChange,
  onFilesChange,
  onStart,
}: {
  open: boolean;
  files: File[];
  uploading: boolean;
  error: boolean;
  onOpenChange(open: boolean): void;
  onFilesChange(files: File[]): void;
  onStart(): void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const tUpload = useTranslations("sidebar.upload");

  function pickFiles(nextFiles: FileList | null) {
    onFilesChange(nextFiles ? Array.from(nextFiles) : []);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (uploading) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tUpload("title")}</DialogTitle>
          <DialogDescription>{tUpload("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label
            htmlFor={inputId}
            className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border bg-muted/20 px-4 text-center text-sm transition hover:border-foreground hover:bg-muted/40"
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              pickFiles(event.dataTransfer.files);
            }}
          >
            <UploadCloud
              aria-hidden
              className="h-7 w-7 text-muted-foreground"
            />
            <span className="font-medium">
              {files.length === 1
                ? tUpload("selected", { name: files[0]!.name })
                : files.length > 1
                  ? tUpload("selected_many", { count: files.length })
                  : tUpload("drop")}
            </span>
            <span className="max-w-sm text-xs leading-5 text-muted-foreground">
              {tUpload("hint")}
            </span>
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            className="sr-only"
            accept={PROJECT_UPLOAD_ACCEPT_ATTR}
            multiple
            onChange={(event) => {
              pickFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tUpload("error")}
            </p>
          ) : null}
          <button
            type="button"
            disabled={files.length === 0 || uploading}
            onClick={onStart}
            className="inline-flex min-h-10 w-full items-center justify-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? tUpload("uploading") : tUpload("start")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
