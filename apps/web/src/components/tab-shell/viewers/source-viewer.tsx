"use client";
import { useMemo } from "react";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import type { Tab } from "@/stores/tabs-store";

// pdfjs-dist worker served from our own public path via Next's
// `new URL + import.meta.url`. @react-pdf-viewer/core is pinned to
// pdfjs-dist@3.11.174 — DO NOT bump pdfjs-dist past v3 without also
// swapping the viewer (v4+ ESM changes broke @react-pdf-viewer).
const WORKER_URL =
  typeof window !== "undefined"
    ? new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString()
    : "";

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
        <Viewer fileUrl={url} plugins={[defaultLayout]} />
      </Worker>
    </div>
  );
}
