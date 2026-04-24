"use client";
import { useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";

// pdf.js ships its worker as a separate file. Next's `new URL + import.meta.url`
// pattern produces a stable worker path the browser can fetch at runtime —
// avoids bundling the worker into the main JS chunk.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

export function SourceViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.source");
  const [numPages, setNumPages] = useState<number | null>(null);
  const url = useMemo(
    () => (tab.targetId ? `/api/notes/${tab.targetId}/file` : null),
    [tab.targetId],
  );
  if (!url) return null;

  return (
    <div
      data-testid="source-viewer"
      className="h-full overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900"
    >
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<div className="p-6 text-sm text-muted-foreground">…</div>}
        error={
          <div className="p-6 text-sm text-destructive">{t("loadFailed")}</div>
        }
      >
        {Array.from({ length: numPages ?? 0 }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            className="mx-auto my-2 shadow"
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        ))}
      </Document>
    </div>
  );
}
