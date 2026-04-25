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
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(480);

  // Build the Blob URL or surface the size error. Re-runs only when source/lang change.
  const blobUrl = useMemo(() => {
    if (new TextEncoder().encode(source).byteLength > MAX_CANVAS_SOURCE_BYTES) {
      setError(t("errors.sourceTooLarge"));
      return null;
    }
    setError(null);
    const html = buildSandboxHTML(source, language);
    const blob = new Blob([html], { type: "text/html" });
    return URL.createObjectURL(blob);
    // setError + t are stable refs for our purposes; intentionally narrow deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, language]);

  // Always revoke the previous Blob URL on remap or unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useCanvasMessages(iframeRef, (m) => {
    if (m.type === "CANVAS_ERROR") setError(m.error);
    if (m.type === "CANVAS_RESIZE") setHeight(m.height);
  });

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
