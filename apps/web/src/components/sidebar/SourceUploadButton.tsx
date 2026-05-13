"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIngestUpload } from "@/hooks/use-ingest-upload";

const ACCEPT_ATTR = [
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

export function SourceUploadButton({
  projectId,
  children,
  className = "w-full justify-start gap-2",
  iconClassName = "h-4 w-4",
}: {
  projectId: string;
  children?: ReactNode;
  className?: string;
  iconClassName?: string;
}) {
  const t = useTranslations("sidebar");
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState(false);
  const [uploadingLocal, setUploadingLocal] = useState(false);
  const uploadInFlightRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadMany, isUploading, error } = useIngestUpload();
  const uploading = isUploading || uploadingLocal;

  async function startUpload(selectedFiles = files) {
    if (selectedFiles.length === 0) return;
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setUploadingLocal(true);
    setLocalError(false);
    try {
      const results = await uploadMany(selectedFiles, projectId, {
        concurrency: 3,
      });
      const firstOpened = results.find(
        (item) => item.ok && item.result?.originalFileId,
      );
      if (firstOpened?.result?.originalFileId) {
        openOriginalFileTab(
          firstOpened.result.originalFileId,
          firstOpened.file.name,
        );
      }
      const failed = results.some((item) => !item.ok);
      setLocalError(failed);
      if (!failed) {
        setFiles([]);
        setOpen(false);
      }
    } catch {
      setLocalError(true);
    } finally {
      uploadInFlightRef.current = false;
      setUploadingLocal(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function pickFiles(nextFiles: FileList | null) {
    setLocalError(false);
    setFiles(nextFiles ? Array.from(nextFiles) : []);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={className}
      >
        {children ?? (
          <>
            <UploadCloud aria-hidden className={iconClassName} />
            <span className="truncate">{t("upload_source")}</span>
          </>
        )}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (uploading) return;
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("upload.title")}</DialogTitle>
            <DialogDescription>{t("upload.description")}</DialogDescription>
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
                  ? t("upload.selected", { name: files[0]!.name })
                  : files.length > 1
                    ? t("upload.selected_many", { count: files.length })
                    : t("upload.drop")}
              </span>
              <span className="max-w-sm text-xs leading-5 text-muted-foreground">
                {t("upload.hint")}
              </span>
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              className="sr-only"
              accept={ACCEPT_ATTR}
              multiple
              onChange={(event) => pickFiles(event.target.files)}
            />
            {(localError || error) && (
              <p role="alert" className="text-sm text-destructive">
                {t("upload.error")}
              </p>
            )}
            <button
              type="button"
              disabled={files.length === 0 || uploading}
              onClick={() => void startUpload()}
              className="inline-flex min-h-10 w-full items-center justify-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? t("upload.uploading") : t("upload.start")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
