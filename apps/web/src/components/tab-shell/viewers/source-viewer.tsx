"use client";
import { useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import type {
  PDFViewerConfig,
  PDFViewerProps,
  PluginRegistry,
} from "@embedpdf/react-pdf-viewer";
import { Download, ExternalLink, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";

const EmbedPDFViewer = dynamic<PDFViewerProps>(
  () => import("@embedpdf/react-pdf-viewer").then((mod) => mod.PDFViewer),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="h-full w-full animate-pulse bg-neutral-200 dark:bg-neutral-900"
      />
    ),
  },
);

const READ_ONLY_DISABLED_CATEGORIES = [
  "annotation",
  "redaction",
  "signature",
  "stamp",
] as const;

function emitViewerReady(tab: Tab, registry: PluginRegistry) {
  if (!tab.targetId || typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("opencairn:source-pdf-ready", {
      detail: {
        tabId: tab.id,
        noteId: tab.targetId,
        title: tab.title,
        registry,
      },
    }),
  );
}

export function SourceViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.source");
  const fileUrl = useMemo(
    () => (tab.targetId ? `/api/notes/${tab.targetId}/file` : null),
    [tab.targetId],
  );
  const title = tab.title || t("title");
  const viewerConfig = useMemo<PDFViewerConfig | null>(
    () =>
      fileUrl
        ? {
            src: fileUrl,
            tabBar: "never",
            theme: { preference: "system" },
            disabledCategories: [...READ_ONLY_DISABLED_CATEGORIES],
            export: { defaultFileName: title },
          }
        : null,
    [fileUrl, title],
  );
  const onReady = useCallback(
    (registry: PluginRegistry) => {
      emitViewerReady(tab, registry);
    },
    [tab],
  );

  if (!fileUrl || !viewerConfig) return null;

  return (
    <div
      data-testid="source-viewer"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-200 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
        <FileText aria-hidden="true" className="size-4 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
        </div>
        <a
          aria-label={t("open")}
          title={t("open")}
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex size-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
        <a
          aria-label={t("download")}
          title={t("download")}
          href={fileUrl}
          download={title}
          className="inline-flex size-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
        >
          <Download aria-hidden="true" className="size-4" />
        </a>
      </div>
      <section
        aria-label={t("frameTitle", { title })}
        className="min-h-0 flex-1 bg-neutral-100 dark:bg-neutral-950"
      >
        <EmbedPDFViewer
          config={viewerConfig}
          onReady={onReady}
          style={{ width: "100%", height: "100%" }}
        />
      </section>
    </div>
  );
}
