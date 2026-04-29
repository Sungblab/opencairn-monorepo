"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MAX_CANVAS_SOURCE_BYTES } from "@opencairn/shared";
import {
  buildSandboxHTML,
  type CanvasIframeLanguage,
  type CanvasPythonLabels,
} from "./sandbox-html-template";
import { useCanvasMessages } from "./useCanvasMessages";

export type CanvasPythonResult = { figures: string[]; timedOut: boolean };

type Props = {
  source: string;
  language: CanvasIframeLanguage;
  className?: string;
  // Optional callback fired when the python iframe finishes its run. The
  // parent uses this to populate the figure-save UI in CanvasOutputsGallery.
  // No-op for non-python languages.
  onPythonResult?: (result: CanvasPythonResult) => void;
};

export function CanvasFrame({
  source,
  language,
  className = "",
  onPythonResult,
}: Props) {
  const t = useTranslations("canvas");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // `messageError` is the runtime channel — populated only by postMessage
  // events from inside the iframe (CANVAS_ERROR). Validation errors are
  // derived synchronously from props and never written to state.
  const [messageError, setMessageError] = useState<string | null>(null);
  const [height, setHeight] = useState(480);

  // Latest-callback ref so a fresh inline arrow for onPythonResult doesn't
  // force the message-listener to re-bind on every render.
  const onPythonResultRef = useRef(onPythonResult);
  onPythonResultRef.current = onPythonResult;

  // Pure derivation: source > 64KB returns the i18n string, otherwise null.
  // Kept out of useMemo's blob-builder so we don't call setState during render.
  const sizeError = useMemo<string | null>(
    () =>
      new TextEncoder().encode(source).byteLength > MAX_CANVAS_SOURCE_BYTES
        ? t("errors.sourceTooLarge")
        : null,
    [source, t],
  );

  // Pull localized python status labels even when language !== "python" so the
  // hook order stays stable across language switches. The labels object is
  // ignored by buildSandboxHTML for non-python languages.
  const pythonLabels: CanvasPythonLabels = useMemo(
    () => ({
      loading: t("runner.status.loading"),
      ready: t("runner.status.ready"),
      running: t("runner.status.running"),
      done: t("runner.status.done"),
      error: t("runner.status.error"),
      timedOut: t("errors.executionTimeout"),
    }),
    [t],
  );

  const blobUrl = useMemo(() => {
    if (sizeError) return null;
    const html = buildSandboxHTML(source, language, { pythonLabels });
    const blob = new Blob([html], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [source, language, sizeError, pythonLabels]);

  // Always revoke the previous Blob URL on remap or unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useCanvasMessages(iframeRef, (m) => {
    if (m.type === "CANVAS_ERROR") setMessageError(m.error);
    if (m.type === "CANVAS_RESIZE") setHeight(m.height);
    if (m.type === "CANVAS_PYTHON_RESULT") {
      onPythonResultRef.current?.({
        figures: m.figures,
        timedOut: m.timedOut,
      });
    }
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
        // window.parent.* (sandbox escape per ADR-006). The python branch
        // also runs Pyodide inside this iframe specifically to inherit this
        // boundary — if Pyodide ran in the parent realm it would expose
        // session-bound APIs to any collaborator who plants Python in a
        // shared canvas note (2026-04-29 audit Finding 3).
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
