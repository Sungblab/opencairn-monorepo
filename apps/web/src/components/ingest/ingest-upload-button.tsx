"use client";
import * as React from "react";
import { useRef } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, isUploading, error } = useIngestUpload();

  // Same guard pattern as IngestOverlays — keeps the activation surface
  // collocated with the live-ingest progress UI it depends on.
  if (process.env.NEXT_PUBLIC_FEATURE_LIVE_INGEST !== "true") return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT_ATTR}
        data-testid="ingest-file-input"
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
      <button
        type="button"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
      >
        {isUploading ? t("uploading") : t("label")}
      </button>
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
