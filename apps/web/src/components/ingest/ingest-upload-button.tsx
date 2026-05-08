"use client";
import * as React from "react";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useIngestUpload } from "@/hooks/use-ingest-upload";

// "Add source" entry point in the project header. Without this, /api/ingest
// has no UI call site and the live-ingest spotlight + dock + tab viewer all
// remain unreachable in production.
//
// Gating: NEXT_PUBLIC_FEATURE_LIVE_INGEST controls visibility because the
// spotlight/dock UX (the actual feedback users see during ingestion) is
// itself flag-gated in IngestOverlays — exposing the trigger without the
// progress UI would silently swallow files. Flag on/off is the binary
// "show the whole live-ingest pathway" switch.
//
// File type allowlist mirrors apps/api/src/routes/ingest.ts ALLOWED_MIME_*
// so we never offer the user a type the server will 415 on.
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

export function IngestUploadButton({
  projectId,
}: {
  projectId: string;
}): React.JSX.Element | null {
  const t = useTranslations("ingest.uploadButton");
  const inputId = useId();
  const [isReady, setIsReady] = useState(false);
  const { upload, isUploading, error } = useIngestUpload();

  useEffect(() => {
    setIsReady(true);
  }, []);

  // Same guard pattern as IngestOverlays — keeps the activation surface
  // collocated with the live-ingest progress UI it depends on.
  if (process.env.NEXT_PUBLIC_FEATURE_LIVE_INGEST !== "true") return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <label
        htmlFor={inputId}
        aria-disabled={!isReady || isUploading}
        data-testid="ingest-upload-trigger"
        className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm hover:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={ACCEPT_ATTR}
          data-testid="ingest-file-input"
          disabled={!isReady || isUploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            // Reset value AFTER capturing the file so the same one can be
            // re-selected after a failed upload — without this, onChange
            // wouldn't refire when the user picks the same file twice.
            e.target.value = "";
            // Fire-and-forget: the hook surfaces failures via `error` (and
            // the spotlight provides feedback on success). The catch is
            // here only so React doesn't log an unhandled promise.
            void upload(f, projectId).catch(() => {});
          }}
        />
        {isUploading ? t("uploading") : t("label")}
      </label>
      {error && !isUploading ? (
        <p
          role="alert"
          className="max-w-[16rem] text-right text-xs text-destructive"
          data-testid="ingest-upload-error"
        >
          {error.status === 415 ? t("errorUnsupported") : t("errorGeneric")}
        </p>
      ) : null}
    </div>
  );
}
