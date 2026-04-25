"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MAX_CANVAS_SOURCE_BYTES } from "@opencairn/shared";
import { buildSandboxHTML, type CanvasIframeLanguage } from "./sandbox-html-template";
import { useCanvasMessages } from "./useCanvasMessages";

type Props = {
  source: string;
  language: CanvasIframeLanguage;
  className?: string;
};

export function CanvasFrame({ source, language, className = "" }: Props) {
  const t = useTranslations("canvas");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // `messageError` is the runtime channel — populated only by postMessage
  // events from inside the iframe (CANVAS_ERROR). Validation errors are
  // derived synchronously from props and never written to state.
  const [messageError, setMessageError] = useState<string | null>(null);
  const [height, setHeight] = useState(480);

  // Pure derivation: source > 64KB returns the i18n string, otherwise null.
  // Kept out of useMemo's blob-builder so we don't call setState during render.
  const sizeError = useMemo<string | null>(
    () =>
      new TextEncoder().encode(source).byteLength > MAX_CANVAS_SOURCE_BYTES
        ? t("errors.sourceTooLarge")
        : null,
    [source, t],
  );

  const blobUrl = useMemo(() => {
    if (sizeError) return null;
    const html = buildSandboxHTML(source, language);
    const blob = new Blob([html], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [source, language, sizeError]);

  // Always revoke the previous Blob URL on remap or unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useCanvasMessages(iframeRef, (m) => {
    if (m.type === "CANVAS_ERROR") setMessageError(m.error);
    if (m.type === "CANVAS_RESIZE") setHeight(m.height);
  });

  // Display priority: a runtime postMessage error overrides the size guard
  // if both happen to be set; otherwise show whichever is present.
  const error = messageError ?? sizeError;

  if (!blobUrl) {
    return <div className="p-4 text-destructive text-sm">{error}</div>;
  }

  return (
    <div
      className={`rounded-xl overflow-hidden border bg-background ${className}`}
    >
      <iframe
        ref={iframeRef}
        src={blobUrl}
        title={t("frame.loading")}
        // CRITICAL: sandbox must be exactly "allow-scripts". Adding
        // "allow-same-origin" defeats the cross-origin Blob URL boundary —
        // user code could then read parent localStorage/cookies via
        // window.parent.* (sandbox escape per ADR-006).
        sandbox="allow-scripts"
        style={{ height, width: "100%", border: 0 }}
        loading="lazy"
      />
      {error && (
        <div className="p-2 text-sm text-destructive bg-destructive/10">
          {error}
        </div>
      )}
    </div>
  );
}
