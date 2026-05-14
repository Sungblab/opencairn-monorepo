"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { studioToolsApi } from "@/lib/api-client";
import {
  recommendedUploadIntentIds,
  UPLOAD_INTENTS,
  uploadIntentDefinition,
  type UploadIntentId,
} from "./upload-intents";

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

  async function startUpload(files: File[], followUpIntent: UploadIntentId) {
    if (!projectId || files.length === 0 || uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setLocalUploading(true);
    setLocalError(false);
    try {
      const results = await uploadMany(files, projectId, {
        concurrency: 3,
        followUpIntent,
      });
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
  projectId,
  open,
  files,
  uploading,
  error,
  onOpenChange,
  onFilesChange,
  onStart,
}: {
  projectId: string | null;
  open: boolean;
  files: File[];
  uploading: boolean;
  error: boolean;
  onOpenChange(open: boolean): void;
  onFilesChange(files: File[]): void;
  onStart(intent: UploadIntentId): void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const tUpload = useTranslations("sidebar.upload");
  const tPreflight = useTranslations("project.tools.preflight");
  const [intent, setIntent] = useState<UploadIntentId>("none");
  const [preflightNotice, setPreflightNotice] = useState<string | null>(null);
  const [preflightBlocked, setPreflightBlocked] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const recommendedIntentIds = useMemo(
    () => recommendedUploadIntentIds(files),
    [files],
  );
  const selectedIntent = uploadIntentDefinition(intent);

  useEffect(() => {
    let cancelled = false;
    setPreflightBlocked(false);
    setPreflightNotice(null);
    if (!projectId || files.length === 0 || !selectedIntent.preflight) {
      setPreflightLoading(false);
      return;
    }
    setPreflightLoading(true);
    setPreflightNotice(tPreflight("loading"));
    void studioToolsApi
      .preflight(projectId, {
        tool: selectedIntent.preflight.profile,
        sourceTokenEstimate:
          selectedIntent.preflight.sourceTokenEstimate * Math.max(1, files.length),
      })
      .then(({ preflight }) => {
        if (cancelled) return;
        if (!preflight.canStart) {
          setPreflightBlocked(true);
          setPreflightNotice(
            tPreflight("blocked", {
              credits: preflight.cost.billableCredits,
              available: preflight.balance.availableCredits,
            }),
          );
          return;
        }
        setPreflightBlocked(false);
        setPreflightNotice(
          preflight.requiresConfirmation
            ? tPreflight("confirm", {
                credits: preflight.cost.billableCredits,
              })
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setPreflightBlocked(false);
          setPreflightNotice(tPreflight("error"));
        }
      })
      .finally(() => {
        if (!cancelled) setPreflightLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [files.length, projectId, selectedIntent.preflight, tPreflight]);

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
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase text-muted-foreground">
              {tUpload("intent.title")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {UPLOAD_INTENTS.map((item) => {
                const recommended =
                  files.length === 0 || recommendedIntentIds.has(item.id);
                return (
                  <label
                    key={item.id}
                    data-testid={`upload-intent-${item.id}`}
                    className={`flex min-h-20 cursor-pointer items-start gap-2 rounded-[var(--radius-card)] border px-3 py-2 text-sm transition ${
                      intent === item.id
                        ? "border-foreground bg-muted/45"
                        : "border-border bg-background hover:border-foreground hover:bg-muted/35"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${inputId}-intent`}
                      value={item.id}
                      checked={intent === item.id}
                      onChange={() => setIntent(item.id)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        <span>{tUpload(`intent.items.${item.i18nKey}.title`)}</span>
                        {recommended && item.id !== "none" ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                            {tUpload("intent.recommended")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {tUpload(`intent.items.${item.i18nKey}.description`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {preflightNotice ? (
            <p className="rounded-[var(--radius-control)] border border-border bg-muted/25 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {preflightNotice}
            </p>
          ) : null}
          <button
            type="button"
            disabled={
              files.length === 0 ||
              uploading ||
              preflightLoading ||
              preflightBlocked
            }
            onClick={() => onStart(intent)}
            className="inline-flex min-h-10 w-full items-center justify-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? tUpload("uploading") : tUpload("start")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
