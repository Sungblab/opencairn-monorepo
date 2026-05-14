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
import { useLocale, useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";
import { pdfAnnotationsApi, type PdfAnnotationPayload } from "@/lib/api-client";
import { SourceContextRail } from "./source-context-rail";
import {
  EMBEDPDF_DISABLED_EDIT_CATEGORIES,
  EMBEDPDF_PEN_ANNOTATION_CONFIG,
  EMBEDPDF_SELF_CONTAINED_CONFIG,
  embedPdfI18nConfig,
  embedPdfZoomConfig,
} from "./embedpdf-config";
import {
  pdfViewStateKey,
  useEmbedPdfPagePersistence,
} from "./embedpdf-view-state";
import { PdfDrawingToolbar } from "./pdf-drawing-toolbar";

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
        try {
          capability.importAnnotations(
            saved.annotations as unknown as AnnotationTransferItem[],
          );
        } finally {
          importingRef.current = false;
        }
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
  const locale = useLocale();
  const t = useTranslations("appShell.viewers.source");
  const { projectId, wsSlug } = useCurrentProjectContext();
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
            ...EMBEDPDF_SELF_CONTAINED_CONFIG,
            tabBar: "never",
            theme: { preference: "system" },
            disabledCategories: [...EMBEDPDF_DISABLED_EDIT_CATEGORIES],
            annotations: {
              ...EMBEDPDF_PEN_ANNOTATION_CONFIG,
            },
            export: { defaultFileName: title },
            i18n: embedPdfI18nConfig(locale),
            zoom: embedPdfZoomConfig(locale),
          }
        : null,
    [fileUrl, locale, title],
  );
  const onReady = useCallback(
    (registry: PluginRegistry) => {
      setRegistry(registry);
      emitViewerReady(tab, registry);
    },
    [tab],
  );
  usePdfAnnotationPersistence(tab.targetId ?? null, registry);
  useEmbedPdfPagePersistence(
    tab.targetId ? pdfViewStateKey("source", tab.targetId) : null,
    registry,
  );

  if (!fileUrl || !viewerConfig || !tab.targetId) return null;

  return (
    <div
      data-testid="source-viewer"
      className="oc-pdf-viewer flex h-full min-h-0 flex-col overflow-hidden bg-neutral-200 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50 xl:flex-row"
    >
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <section
          id={viewerElementId}
          data-testid="source-pdf-area"
          aria-label={t("frameTitle", { title })}
          className="relative h-full min-h-0 w-full flex-1 bg-neutral-100 dark:bg-neutral-950"
        >
          <PdfDrawingToolbar registry={registry} floating />
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
        wsSlug={wsSlug}
        sourceTitle={title}
        viewerElementId={viewerElementId}
      />
    </div>
  );
}
