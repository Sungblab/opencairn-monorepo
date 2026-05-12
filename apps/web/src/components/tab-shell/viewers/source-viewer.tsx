"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  AnnotationCapability,
  AnnotationEvent,
  AnnotationTransferItem,
  PDFViewerConfig,
  PDFViewerProps,
  PluginRegistry,
} from "@embedpdf/react-pdf-viewer";
import { Download, ExternalLink, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";
import { pdfAnnotationsApi, type PdfAnnotationPayload } from "@/lib/api-client";
import { SourceContextRail } from "./source-context-rail";

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

type AnnotationProvider = {
  provides(): Readonly<AnnotationCapability>;
};

function getAnnotationCapability(registry: PluginRegistry): Readonly<AnnotationCapability> | null {
  const provider = registry.getCapabilityProvider("annotation") as AnnotationProvider | null;
  return provider?.provides() ?? null;
}

function toAnnotationPayload(items: AnnotationTransferItem[]): PdfAnnotationPayload {
  return JSON.parse(JSON.stringify(items)) as PdfAnnotationPayload;
}

function usePdfAnnotationPersistence(noteId: string | null, registry: PluginRegistry | null) {
  const saveTimerRef = useRef<number | null>(null);
  const importingRef = useRef(false);

  useEffect(() => {
    if (!noteId || !registry) return;
    let cancelled = false;
    let imported = false;
    let unsubscribe: (() => void) | null = null;

    const clearSaveTimer = () => {
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };

    const setup = async () => {
      await registry.pluginsReady();
      if (cancelled) return;
      const capability = getAnnotationCapability(registry);
      if (!capability) return;

      const importSavedAnnotations = async () => {
        if (imported || cancelled) return;
        imported = true;
        const saved = await pdfAnnotationsApi.get(noteId);
        if (cancelled || saved.annotations.length === 0) return;
        importingRef.current = true;
        capability.importAnnotations(
          saved.annotations as unknown as AnnotationTransferItem[],
        );
        window.setTimeout(() => {
          importingRef.current = false;
        }, 0);
      };

      const persistAnnotations = async () => {
        const exported = await capability.exportAnnotations().toPromise();
        if (cancelled) return;
        await pdfAnnotationsApi.save(noteId, toAnnotationPayload(exported));
      };

      const schedulePersist = () => {
        clearSaveTimer();
        saveTimerRef.current = window.setTimeout(() => {
          void persistAnnotations().catch(() => undefined);
        }, 500);
      };

      const onAnnotationEvent = (event: AnnotationEvent) => {
        if (event.type === "loaded") {
          void importSavedAnnotations().catch(() => undefined);
          return;
        }
        if (importingRef.current || !event.committed) return;
        schedulePersist();
      };

      unsubscribe = capability.onAnnotationEvent(onAnnotationEvent);
      void importSavedAnnotations().catch(() => undefined);
    };

    void setup().catch(() => undefined);

    return () => {
      cancelled = true;
      clearSaveTimer();
      unsubscribe?.();
    };
  }, [noteId, registry]);
}

export function SourceViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.source");
  const { projectId } = useCurrentProjectContext();
  const fileUrl = useMemo(
    () => (tab.targetId ? `/api/notes/${tab.targetId}/file` : null),
    [tab.targetId],
  );
  const title = tab.title || t("title");
  const viewerElementId = `source-pdf-area-${tab.id}`;
  const [registry, setRegistry] = useState<PluginRegistry | null>(null);
  const viewerConfig = useMemo<PDFViewerConfig | null>(
    () =>
      fileUrl
        ? {
            src: fileUrl,
            tabBar: "never",
            theme: { preference: "system" },
            disabledCategories: [...READ_ONLY_DISABLED_CATEGORIES],
            annotations: {
              autoCommit: true,
              annotationAuthor: "OpenCairn",
            },
            export: { defaultFileName: title },
          }
        : null,
    [fileUrl, title],
  );
  const onReady = useCallback(
    (registry: PluginRegistry) => {
      setRegistry(registry);
      emitViewerReady(tab, registry);
    },
    [tab],
  );
  usePdfAnnotationPersistence(tab.targetId ?? null, registry);

  if (!fileUrl || !viewerConfig || !tab.targetId) return null;

  return (
    <div
      data-testid="source-viewer"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-200 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50 xl:flex-row"
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-white px-3 shadow-sm dark:bg-neutral-950">
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
            className="inline-flex size-8 items-center justify-center rounded-md border border-border text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
          <a
            aria-label={t("download")}
            title={t("download")}
            href={fileUrl}
            download={title}
            className="inline-flex size-8 items-center justify-center rounded-md border border-border text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
          >
            <Download aria-hidden="true" className="size-4" />
          </a>
        </div>
        <section
          id={viewerElementId}
          data-testid="source-pdf-area"
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
      <SourceContextRail
        noteId={tab.targetId}
        projectId={projectId}
        sourceTitle={title}
        viewerElementId={viewerElementId}
      />
    </div>
  );
}
