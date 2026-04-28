"use client";
import { useMemo, useState } from "react";
import { Download, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";

const PDF_VIEWER_FRAGMENT = "toolbar=1&navpanes=1&scrollbar=1&view=FitH";

function pdfViewerUrl(fileUrl: string) {
  return `${fileUrl}#${PDF_VIEWER_FRAGMENT}`;
}

export function SourceViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.source");
  const [reloadSeq, setReloadSeq] = useState(0);
  const fileUrl = useMemo(
    () => (tab.targetId ? `/api/notes/${tab.targetId}/file` : null),
    [tab.targetId],
  );
  const viewerUrl = useMemo(
    () => (fileUrl ? pdfViewerUrl(fileUrl) : null),
    [fileUrl],
  );
  const title = tab.title || t("title");

  if (!fileUrl || !viewerUrl) return null;

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
        <button
          type="button"
          aria-label={t("refresh")}
          title={t("refresh")}
          onClick={() => setReloadSeq((seq) => seq + 1)}
          className="inline-flex size-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <object
          key={reloadSeq}
          data-testid="pdf-frame"
          data-reload-seq={reloadSeq}
          data={viewerUrl}
          type="application/pdf"
          aria-label={t("frameTitle", { title })}
          className="h-full w-full rounded-md border border-neutral-300 bg-white shadow-sm dark:border-neutral-800"
        >
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-white p-6 text-center text-sm text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
            <p className="font-medium text-neutral-950 dark:text-neutral-50">
              {t("fallbackTitle")}
            </p>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-900"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              {t("fallbackOpen")}
            </a>
          </div>
        </object>
      </div>
    </div>
  );
}
