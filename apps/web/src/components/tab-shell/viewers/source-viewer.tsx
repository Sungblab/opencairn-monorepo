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
import { Button } from "@/components/ui/button";
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

type SourcePreviewKind =
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "text"
  | "table"
  | "deck"
  | "document"
  | "source";

function sourcePreviewKindFromTitle(title: string): SourcePreviewKind {
  const lower = title.toLowerCase();
  if (/\.(pdf)$/.test(lower)) return "pdf";
  if (/\bpdf\b/.test(lower)) return "pdf";
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return "image";
  if (/\.(mp3|wav|m4a|ogg|flac)$/.test(lower)) return "audio";
  if (/\.(mp4|webm|mov|mkv)$/.test(lower)) return "video";
  if (/\.(xlsx?|csv|tsv)$/.test(lower)) return "table";
  if (/\.(txt|md|markdown|json|log)$/.test(lower)) return "text";
  if (/\.(pptx?|key)$/.test(lower)) return "deck";
  if (/\.(docx?|hwp|hwpx|rtf|odt)$/.test(lower)) return "document";
  return "source";
}

function contentTypeForPreviewKind(kind: SourcePreviewKind): string {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "image":
      return "image/*";
    case "audio":
      return "audio/*";
    case "video":
      return "video/*";
    case "text":
      return "text/plain";
    case "table":
      return "text/csv";
    case "deck":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "document":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
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
  const previewKind = sourcePreviewKindFromTitle(title);
  const sourceContentType = contentTypeForPreviewKind(previewKind);
  const viewerElementId = `source-pdf-area-${tab.id}`;
  const [registry, setRegistry] = useState<PluginRegistry | null>(null);
  const viewerConfig = useMemo<PDFViewerConfig | null>(
    () =>
      fileUrl && previewKind === "pdf"
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
    [fileUrl, locale, previewKind, title],
  );
  const onReady = useCallback(
    (registry: PluginRegistry) => {
      setRegistry(registry);
      emitViewerReady(tab, registry);
    },
    [tab],
  );
  usePdfAnnotationPersistence(
    previewKind === "pdf" ? (tab.targetId ?? null) : null,
    registry,
  );
  useEmbedPdfPagePersistence(
    previewKind === "pdf" && tab.targetId
      ? pdfViewStateKey("source", tab.targetId)
      : null,
    registry,
  );

  if (!fileUrl || !tab.targetId) return null;

  return (
    <div
      data-testid="source-viewer"
      className="oc-pdf-viewer flex h-full min-h-0 flex-col overflow-hidden bg-neutral-200 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50 xl:flex-row"
    >
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {previewKind === "pdf" && viewerConfig ? (
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
        ) : (
          <GenericSourcePreview
            id={viewerElementId}
            title={title}
            fileUrl={fileUrl}
            kind={previewKind === "pdf" ? "source" : previewKind}
          />
        )}
      </div>
      <SourceContextRail
        noteId={tab.targetId}
        projectId={projectId}
        wsSlug={wsSlug}
        sourceTitle={title}
        viewerElementId={viewerElementId}
        sourceContentType={sourceContentType}
      />
    </div>
  );
}

function GenericSourcePreview({
  id,
  title,
  fileUrl,
  kind,
}: {
  id: string;
  title: string;
  fileUrl: string;
  kind: Exclude<SourcePreviewKind, "pdf">;
}) {
  const t = useTranslations("appShell.viewers.source.generic");
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);
  const isText = kind === "text";

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    setText(null);
    setTextError(false);
    fetch(fileUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`source ${response.status}`);
        return response.text();
      })
      .then((body) => {
        if (!cancelled) setText(body.slice(0, 120_000));
      })
      .catch(() => {
        if (!cancelled) setTextError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fileUrl, isText]);

  return (
    <section
      id={id}
      data-testid="source-generic-area"
      aria-label={t("frameTitle", { title })}
      className="app-scrollbar-thin h-full min-h-0 w-full flex-1 overflow-auto bg-background text-foreground"
    >
      {kind === "image" ? (
        <div className="flex min-h-full items-center justify-center p-4">
          <img
            src={fileUrl}
            alt={title}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : null}
      {kind === "audio" ? (
        <div className="flex min-h-full items-center justify-center p-6">
          <audio controls src={fileUrl} className="w-full max-w-2xl" />
        </div>
      ) : null}
      {kind === "video" ? (
        <div className="flex min-h-full items-center justify-center bg-black p-4">
          <video controls src={fileUrl} className="max-h-full max-w-full" />
        </div>
      ) : null}
      {isText ? (
        <div className="mx-auto w-full max-w-5xl p-4">
          {textError ? (
            <FallbackSourcePanel title={title} fileUrl={fileUrl} kind={kind} />
          ) : text == null ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-3 text-xs leading-5">
              {text}
            </pre>
          )}
        </div>
      ) : null}
      {kind === "document" || kind === "deck" || kind === "table" || kind === "source" ? (
        <FallbackSourcePanel title={title} fileUrl={fileUrl} kind={kind} />
      ) : null}
    </section>
  );
}

function FallbackSourcePanel({
  title,
  fileUrl,
  kind,
}: {
  title: string;
  fileUrl: string;
  kind: Exclude<SourcePreviewKind, "pdf" | "image" | "audio" | "video">;
}) {
  const t = useTranslations("appShell.viewers.source.generic");
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t(`kinds.${kind}`)}
      </div>
      <h2 className="max-w-full truncate text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{t("fallback")}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={fileUrl} target="_blank" rel="noreferrer" />}
        >
          {t("open")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={fileUrl} download />}
        >
          {t("download")}
        </Button>
      </div>
    </div>
  );
}
