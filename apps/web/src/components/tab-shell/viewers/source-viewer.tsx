"use client";
import { useMemo } from "react";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import type { Tab } from "@/stores/tabs-store";

// pdfjs-dist worker URL resolved at build time via Next's
// `new URL + import.meta.url`. Version is pinned to 3.11.174 in the
// root package.json's pnpm.overrides — @react-pdf-viewer/core@3 does
// not support pdfjs-dist v4+ (ESM boundary changes). Do NOT bump
// pdfjs-dist without also swapping the viewer package.
const WORKER_URL =
  typeof window !== "undefined"
    ? new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString()
    : "";

// CVE-2024-4367 mitigation: pdfjs-dist < 4.2.67 is vulnerable to
// arbitrary JS execution via a crafted font in a PDF. `isEvalSupported:
// false` disables the eval-based font path that is the attack vector,
// turning the CVE into a non-issue for our pinned v3 build. See
// mozilla.github.io/pdf.js/api/draft/global.html#getDocument for the
// supported options. The trade-off is slightly slower font rendering
// on old PDFs that rely on eval'd CFF glyphs — acceptable.
const SECURE_DOCUMENT_PARAMS = <T,>(options: T): T => ({
  ...options,
  isEvalSupported: false,
});

export function SourceViewer({ tab }: { tab: Tab }) {
  const url = useMemo(
    () => (tab.targetId ? `/api/notes/${tab.targetId}/file` : null),
    [tab.targetId],
  );
  // defaultLayoutPlugin is the MIT-licensed preset: toolbar (zoom, page
  // nav, search, download, print) + sidebar (thumbnails, bookmarks).
  // Gives users the same reading affordances they expect from the
  // browser's built-in PDF viewer. Restoration of the spec-designated
  // viewer — see specs/2026-04-09-opencairn-design.md §tech-stack.
  const defaultLayout = defaultLayoutPlugin();

  if (!url) return null;

  return (
    <div
      data-testid="source-viewer"
      className="h-full overflow-hidden bg-neutral-100 dark:bg-neutral-900"
    >
      <Worker workerUrl={WORKER_URL}>
        <Viewer
          fileUrl={url}
          plugins={[defaultLayout]}
          transformGetDocumentParams={SECURE_DOCUMENT_PARAMS}
        />
      </Worker>
    </div>
  );
}
