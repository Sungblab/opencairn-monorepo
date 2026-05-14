"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type {
  PDFViewerConfig,
  PDFViewerProps,
  PluginRegistry,
} from "@embedpdf/react-pdf-viewer";
import {
  Download,
  Eye,
  ExternalLink,
  FileCode,
  FileDown,
  FileText,
  GitBranch,
  MessageSquareText,
  Loader2,
  Play,
  Presentation,
  RefreshCcw,
  Table2,
  UploadCloud,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { JsonView, defaultStyles } from "react-json-view-lite";
import remarkGfm from "remark-gfm";
import {
  validateStudyArtifact,
  type AgentFileSummary,
  type StudyArtifact,
} from "@opencairn/shared";
import "react-json-view-lite/dist/index.css";
import type { AgentCommandId } from "@/components/agent-panel/agent-commands";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import type { Tab } from "@/stores/tabs-store";
import { useTabsStore } from "@/stores/tabs-store";
import { documentGenerationApi, integrationsApi } from "@/lib/api-client";
import { newTab } from "@/lib/tab-factory";
import { urls } from "@/lib/urls";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
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

interface AgentFileResponse {
  file: AgentFileSummary;
}

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
export function AgentFileViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("agentFiles.viewer");
  const qc = useQueryClient();
  const targetId = tab.targetId;
  const { data, isLoading, isError } = useQuery<AgentFileResponse>({
    queryKey: ["agent-file", targetId],
    enabled: Boolean(targetId),
    refetchInterval: (query) => {
      const file = (query.state.data as AgentFileResponse | undefined)?.file;
      if (
        file &&
        isOfficeDocument(file) &&
        file.compiledMimeType !== "application/pdf" &&
        file.ingestStatus !== "failed"
      ) {
        return 2500;
      }
      if (
        file?.ingestStatus === "queued" ||
        file?.ingestStatus === "running"
      ) {
        return 2500;
      }
      return false;
    },
    queryFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`agent-file ${res.status}`);
      return (await res.json()) as AgentFileResponse;
    },
  });
  const googleIntegration = useQuery({
    queryKey: ["integrations", "google", data?.file.workspaceId],
    enabled: Boolean(data?.file.workspaceId),
    queryFn: () => integrationsApi.google(data!.file.workspaceId),
  });

  const compile = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}/compile`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`compile ${res.status}`);
      return (await res.json()) as AgentFileResponse;
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["agent-file", targetId] });
      void qc.invalidateQueries({
        queryKey: ["project-tree", result.file.projectId],
      });
    },
  });

  const ingest = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}/ingest`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`ingest ${res.status}`);
      return (await res.json()) as AgentFileResponse;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["agent-file", targetId] }),
  });

  const canvas = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}/canvas`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`canvas ${res.status}`);
      return (await res.json()) as { noteId: string };
    },
    onSuccess: ({ noteId }) => {
      const tabs = useTabsStore.getState();
      tabs.addTab(
        newTab({
          kind: "note",
          targetId: noteId,
          title: data?.file.title ?? t("canvas"),
          mode: "canvas",
          preview: false,
        }),
      );
    },
  });
  const googleExport = useMutation({
    mutationFn: async (file: AgentFileSummary) =>
      documentGenerationApi.exportProjectObject(
        file.projectId,
        googleExportActionForFile(file),
      ),
    onSuccess: (_result, file) => {
      void qc.invalidateQueries({
        queryKey: ["workflow-console-runs", file.projectId],
      });
    },
  });

  useEffect(() => {
    const file = data?.file;
    const title = file?.title?.trim() || file?.filename?.trim();
    if (!title || tab.title === title) return;
    useTabsStore.getState().updateTab(tab.id, { title });
  }, [data?.file, tab.id, tab.title]);

  if (!targetId) return null;
  if (isLoading) {
    return (
      <div className="h-full p-4 text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }
  if (isError || !data?.file) {
    return (
      <div className="h-full p-4 text-sm text-destructive">{t("error")}</div>
    );
  }

  const file = data.file;
  const fileUrl = `/api/agent-files/${file.id}/file`;
  const compiledUrl = `/api/agent-files/${file.id}/compiled`;
  const showFileToolbar = file.kind !== "pdf";
  const googleConnected = Boolean(googleIntegration.data?.connected);
  const googleExportLabel = googleConnected
    ? t("googleExport")
    : t("googleExportConnectRequired");
  const handleGoogleExport = () => {
    if (googleConnected) {
      googleExport.mutate(file);
      return;
    }
    const tabs = useTabsStore.getState();
    const existing = tabs.findTabByTarget("ws_settings", "integrations");
    if (existing) {
      tabs.setActive(existing.id);
      return;
    }
    tabs.addTab(
      newTab({
        kind: "ws_settings",
        targetId: "integrations",
        title: t("googleSettingsTitle"),
      }),
    );
  };

  return (
    <div
      data-testid="agent-file-viewer"
      className="flex h-full min-h-0 flex-col bg-background"
    >
      {showFileToolbar ? (
        <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{file.filename}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {t("meta", {
                kind: file.kind,
                version: file.version,
                bytes: formatBytes(file.bytes),
              })}
              {file.kind === "latex" ? (
                <StatusPill label={t(`compileStatus.${file.compileStatus}`)} />
              ) : null}
              <StatusPill label={t(`ingestStatus.${file.ingestStatus}`)} />
            </div>
          </div>
          <a
            href={fileUrl}
            download={file.filename}
            title={t("download")}
            aria-label={t("download")}
            className={buttonVariants({ size: "sm", variant: "ghost" })}
          >
            <Download className="h-4 w-4" />
          </a>
          <Button
            size="sm"
            variant="ghost"
            title={t("askAgent")}
            aria-label={t("askAgent")}
            onClick={() => usePanelStore.getState().openAgentPanelTab("chat")}
          >
            <MessageSquareText className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={t("ingest")}
            aria-label={t("ingest")}
            onClick={() => ingest.mutate()}
            disabled={ingest.isPending}
          >
            <UploadCloud className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={googleExportLabel}
            aria-label={googleExportLabel}
            onClick={handleGoogleExport}
            disabled={googleIntegration.isLoading || googleExport.isPending}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          {file.kind === "latex" ? (
            <Button
              size="sm"
              variant="ghost"
              title={t("compile")}
              aria-label={t("compile")}
              onClick={() => compile.mutate()}
              disabled={compile.isPending}
            >
              <RefreshCcw className="h-4 w-4" />
            </Button>
          ) : null}
          {file.kind === "code" || file.kind === "html" ? (
            <Button
              size="sm"
              variant="ghost"
              title={t("canvas")}
              aria-label={t("canvas")}
              onClick={() => canvas.mutate()}
              disabled={canvas.isPending}
            >
              <Play className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <FileBody
          file={file}
          fileUrl={fileUrl}
          compiledUrl={compiledUrl}
          onIngest={() => ingest.mutate()}
          ingestPending={ingest.isPending}
        />
      </div>
    </div>
  );
}

function googleExportActionForFile(file: AgentFileSummary) {
  if (file.kind === "docx") {
    return {
      type: "export_project_object" as const,
      objectId: file.id,
      provider: "google_docs" as const,
      format: "docx" as const,
    };
  }
  if (file.kind === "xlsx") {
    return {
      type: "export_project_object" as const,
      objectId: file.id,
      provider: "google_sheets" as const,
      format: "xlsx" as const,
    };
  }
  if (file.kind === "pptx") {
    return {
      type: "export_project_object" as const,
      objectId: file.id,
      provider: "google_slides" as const,
      format: "pptx" as const,
    };
  }
  return {
    type: "export_project_object" as const,
    objectId: file.id,
    provider: "google_drive" as const,
  };
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
      {label}
    </span>
  );
}

function FileBody({
  file,
  fileUrl,
  compiledUrl,
  onIngest,
  ingestPending,
}: {
  file: AgentFileSummary;
  fileUrl: string;
  compiledUrl: string;
  onIngest: () => void;
  ingestPending: boolean;
}) {
  const t = useTranslations("agentFiles.viewer");
  const textLike = useMemo(
    () => ["text", "latex", "code"].includes(file.kind),
    [file.kind],
  );

  if (file.kind === "image") {
    return (
      <div className="app-scrollbar-thin flex h-full items-center justify-center overflow-auto bg-muted/30 p-4">
        <img
          src={fileUrl}
          alt={file.filename}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  if (file.kind === "html") {
    return (
      <PreviewSourceFrame fileUrl={fileUrl} sourceLabel={t("source")}>
        <iframe
          title={file.filename}
          src={fileUrl}
          sandbox="allow-scripts"
          className="h-full w-full border-0"
        />
      </PreviewSourceFrame>
    );
  }
  if (file.kind === "pdf") {
    return (
      <AgentFilePdfViewer
        file={file}
        fileUrl={fileUrl}
        onIngest={onIngest}
        ingestPending={ingestPending}
      />
    );
  }
  if (isOfficeDocument(file)) {
    return (
      <OfficeDocumentPreview
        file={file}
        fileUrl={fileUrl}
        compiledUrl={compiledUrl}
        onIngest={onIngest}
        ingestPending={ingestPending}
      />
    );
  }
  if (file.kind === "latex" && file.compileStatus === "completed") {
    return (
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        <TextPreview fileUrl={fileUrl} />
        <iframe
          title={`${file.filename} PDF`}
          src={compiledUrl}
          className="h-full w-full border-0 border-l"
        />
      </div>
    );
  }
  if (file.kind === "markdown") return <MarkdownPreview fileUrl={fileUrl} />;
  if (file.kind === "json") return <JsonPreview fileUrl={fileUrl} />;
  if (file.kind === "csv") return <CsvPreview fileUrl={fileUrl} />;
  if (textLike) return <TextPreview fileUrl={fileUrl} />;
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <FileCode className="mr-2 h-4 w-4" />
      {file.mimeType}
    </div>
  );
}

function isOfficeDocument(file: AgentFileSummary) {
  const filename = file.filename.toLowerCase();
  return (
    file.kind === "docx" ||
    file.kind === "pptx" ||
    file.kind === "xlsx" ||
    filename.endsWith(".docx") ||
    filename.endsWith(".pptx") ||
    filename.endsWith(".xlsx") ||
    file.mimeType.includes("officedocument") ||
    file.mimeType.includes("powerpoint") ||
    file.mimeType.includes("spreadsheet")
  );
}

function OfficeDocumentPreview({
  file,
  fileUrl,
  compiledUrl,
  onIngest,
  ingestPending,
}: {
  file: AgentFileSummary;
  fileUrl: string;
  compiledUrl: string;
  onIngest: () => void;
  ingestPending: boolean;
}) {
  const t = useTranslations("agentFiles.viewer");
  const isConverting =
    file.ingestStatus === "not_started" ||
    file.ingestStatus === "queued" ||
    file.ingestStatus === "running";

  if (file.compiledMimeType === "application/pdf") {
    return (
      <AgentFilePdfViewer
        file={file}
        fileUrl={compiledUrl}
        downloadUrl={fileUrl}
        onIngest={onIngest}
        ingestPending={ingestPending}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-muted/20 p-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-background p-5 text-sm shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          {isConverting ? (
            <Loader2
              className="h-4 w-4 animate-spin text-primary"
              aria-hidden
            />
          ) : file.kind === "pptx" ? (
            <Presentation className="h-4 w-4 text-orange-600" aria-hidden />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 truncate">
            {isConverting ? t("officeConvertingTitle") : file.filename}
          </span>
        </div>
        <p className="text-muted-foreground">
          {isConverting
            ? t("officeConvertingDescription")
            : t("officePreviewUnavailable")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={fileUrl}
            download={file.filename}
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <FileDown className="mr-1.5 h-4 w-4" />
            {t("download")}
          </a>
        </div>
      </div>
    </div>
  );
}

function useMaterialCommandRunner() {
  return useCallback((commandId: AgentCommandId) => {
    usePanelStore.getState().openAgentPanelTab("chat");
    useAgentWorkbenchStore.getState().requestCommand(commandId);
  }, []);
}

function firstRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SourceMaterialPanel({
  file,
  fileUrl,
  onIngest,
  ingestPending,
}: {
  file: AgentFileSummary;
  fileUrl: string;
  onIngest: () => void;
  ingestPending: boolean;
}) {
  const t = useTranslations("agentFiles.viewer.material");
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ wsSlug?: string | string[] }>();
  const wsSlug = firstRouteParam(params.wsSlug);
  const runCommand = useMaterialCommandRunner();
  const isAnalyzing =
    ingestPending ||
    file.ingestStatus === "queued" ||
    file.ingestStatus === "running";
  const canOpenSourceNote = Boolean(file.sourceNoteId && wsSlug);
  const statusTone =
    file.ingestStatus === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
      : file.ingestStatus === "failed"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        : isAnalyzing
          ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300"
          : "border-border bg-muted/40 text-muted-foreground";

  const openSourceNote = () => {
    if (!file.sourceNoteId || !wsSlug) return;
    const tabs = useTabsStore.getState();
    tabs.addTab(
      newTab({
        kind: "note",
        targetId: file.sourceNoteId,
        title: t("sourceNoteTab"),
        mode: "reading",
        preview: false,
      }),
    );
    router.push(urls.workspace.note(locale, wsSlug, file.sourceNoteId));
  };

  const openProjectGraph = () => {
    if (!wsSlug) return;
    const tabs = useTabsStore.getState();
    tabs.addTab(
      newTab({
        kind: "project",
        targetId: file.projectId,
        title: t("graphTab"),
        titleKey: "appShell.tabTitles.graph",
        mode: "graph",
        preview: false,
      }),
    );
    router.push(urls.workspace.projectGraph(locale, wsSlug, file.projectId));
  };

  const statusDetail =
    file.ingestStatus === "completed"
      ? t("statusDetail.completed")
      : file.ingestStatus === "failed"
        ? t("statusDetail.failed")
        : isAnalyzing
          ? t("statusDetail.running")
          : t("statusDetail.notStarted");

  return (
    <div className="border-b bg-background/95 px-3 py-1.5">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium">{file.filename}</span>
          <span
            title={statusDetail}
            aria-label={`${t(`status.${file.ingestStatus}`)}: ${statusDetail}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              statusTone,
            )}
          >
            {isAnalyzing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : null}
            {t(`status.${file.ingestStatus}`)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="default"
            onClick={() => runCommand("make_note")}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            {t("actions.note")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runCommand("concept_wiki")}
          >
            <GitBranch className="mr-1.5 h-4 w-4" />
            {t("actions.wiki")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runCommand("quiz")}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            {t("actions.quiz")}
          </Button>
          <Button
            size="sm"
            variant={file.ingestStatus === "failed" ? "default" : "ghost"}
            onClick={onIngest}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-1.5 h-4 w-4" />
            )}
            {file.ingestStatus === "failed"
              ? t("actions.retry")
              : t("actions.reanalyze")}
          </Button>
          <details className="group relative text-xs text-muted-foreground">
            <summary
              className={cn(
                buttonVariants({ size: "sm", variant: "ghost" }),
                "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden",
              )}
            >
              {t("advanced")}
            </summary>
            <div className="absolute right-0 top-full z-30 mt-2 flex min-w-48 flex-col gap-1 rounded-md border bg-background p-2 shadow-lg">
              <Button
                size="sm"
                variant="ghost"
                onClick={openSourceNote}
                disabled={!canOpenSourceNote}
                className="justify-start"
              >
                <Eye className="mr-1.5 h-4 w-4" />
                {t("actions.openExtract")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={openProjectGraph}
                className="justify-start"
              >
                <GitBranch className="mr-1.5 h-4 w-4" />
                {t("actions.openGraph")}
              </Button>
              <a
                href={fileUrl}
                download={file.filename}
                className={cn(
                  buttonVariants({ size: "sm", variant: "ghost" }),
                  "justify-start",
                )}
              >
                <Download className="mr-1.5 h-4 w-4" />
                {t("actions.download")}
              </a>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function AgentFilePdfViewer({
  file,
  fileUrl,
  downloadUrl,
  onIngest,
  ingestPending,
}: {
  file: AgentFileSummary;
  fileUrl: string;
  downloadUrl?: string;
  onIngest: () => void;
  ingestPending: boolean;
}) {
  const locale = useLocale();
  const [registry, setRegistry] = useState<PluginRegistry | null>(null);
  const config = useMemo<PDFViewerConfig>(
    () => ({
      src: fileUrl,
      ...EMBEDPDF_SELF_CONTAINED_CONFIG,
      tabBar: "never",
      theme: { preference: "system" },
      export: { defaultFileName: file.filename },
      disabledCategories: [...EMBEDPDF_DISABLED_EDIT_CATEGORIES],
      annotations: {
        ...EMBEDPDF_PEN_ANNOTATION_CONFIG,
      },
      i18n: embedPdfI18nConfig(locale),
      zoom: embedPdfZoomConfig(locale),
    }),
    [file.filename, fileUrl, locale],
  );
  const onReady = useCallback((registry: PluginRegistry) => {
    setRegistry(registry);
  }, []);
  useEmbedPdfPagePersistence(pdfViewStateKey("agent-file", file.id), registry);

  return (
    <div
      data-testid="agent-file-pdf-viewer"
      className="oc-pdf-viewer flex h-full min-h-0 w-full flex-col bg-neutral-100 dark:bg-neutral-950"
    >
      <SourceMaterialPanel
        file={file}
        fileUrl={downloadUrl ?? fileUrl}
        onIngest={onIngest}
        ingestPending={ingestPending}
      />
      <div className="relative min-h-0 flex-1">
        <PdfDrawingToolbar registry={registry} floating />
        <EmbedPDFViewer
          config={config}
          onReady={onReady}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}

function PreviewSourceFrame({
  children,
  fileUrl,
  sourceLabel,
}: {
  children: ReactNode;
  fileUrl: string;
  sourceLabel: string;
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-2">
      <div className="min-h-0">{children}</div>
      <div className="min-h-0 border-l">
        <TextPreview fileUrl={fileUrl} label={sourceLabel} />
      </div>
    </div>
  );
}

function MarkdownPreview({ fileUrl }: { fileUrl: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);

  return (
    <div className="app-scrollbar-thin h-full overflow-auto p-6">
      <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Eye className="h-3.5 w-3.5" />
        {t("preview")}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("loadingInline")}</p>
      ) : (
        <article className="max-w-4xl space-y-4 text-sm leading-7">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-2xl font-semibold leading-tight">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-xl font-semibold leading-tight">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-base font-semibold leading-tight">
                  {children}
                </h3>
              ),
              p: ({ children }) => <p>{children}</p>,
              ul: ({ children }) => (
                <ul className="ml-5 list-disc space-y-1">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="ml-5 list-decimal space-y-1">{children}</ol>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 pl-4 text-muted-foreground">
                  {children}
                </blockquote>
              ),
              code: ({ children }) => (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="app-scrollbar-thin overflow-auto rounded border bg-muted/40 p-3 text-xs leading-5">
                  {children}
                </pre>
              ),
              table: ({ children }) => (
                <table className="min-w-full border-collapse text-xs">
                  {children}
                </table>
              ),
              th: ({ children }) => (
                <th className="border-b px-3 py-2 text-left font-medium">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border-b px-3 py-2 align-top">{children}</td>
              ),
            }}
          >
            {data ?? ""}
          </ReactMarkdown>
        </article>
      )}
    </div>
  );
}

function JsonPreview({ fileUrl }: { fileUrl: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);
  const [sourceOpen, setSourceOpen] = useState(false);
  const parsed = useMemo(() => {
    if (!data) return null;
    try {
      return JSON.parse(data) as object;
    } catch {
      return null;
    }
  }, [data]);

  if (isLoading)
    return (
      <div className="h-full p-4 text-sm text-muted-foreground">
        {t("loadingInline")}
      </div>
    );
  if (parsed == null) return <TextPreview fileUrl={fileUrl} />;
  const studyArtifact = validateStudyArtifact(parsed);

  if (studyArtifact.success) {
    return (
      <StudyArtifactPreview
        artifact={studyArtifact.artifact}
        fileUrl={fileUrl}
        sourceOpen={sourceOpen}
        onToggleSource={() => setSourceOpen((open) => !open)}
      />
    );
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-cols-1",
        sourceOpen && "lg:grid-cols-2",
      )}
    >
      <div className="app-scrollbar-thin h-full overflow-auto p-4 text-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            {t("jsonTree")}
          </div>
          <SourceToggleButton
            open={sourceOpen}
            onClick={() => setSourceOpen((open) => !open)}
          />
        </div>
        <JsonView data={parsed} style={defaultStyles} />
      </div>
      {sourceOpen ? (
        <div className="min-h-0 border-t lg:border-l lg:border-t-0">
          <TextPreview fileUrl={fileUrl} label={t("source")} />
        </div>
      ) : null}
    </div>
  );
}

function StudyArtifactPreview({
  artifact,
  fileUrl,
  sourceOpen,
  onToggleSource,
}: {
  artifact: StudyArtifact;
  fileUrl: string;
  sourceOpen: boolean;
  onToggleSource: () => void;
}) {
  const t = useTranslations("agentFiles.viewer.studyArtifact");
  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-cols-1",
        sourceOpen && "lg:grid-cols-2",
      )}
    >
      <div className="app-scrollbar-thin h-full overflow-auto p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              <span>{t("label")}</span>
              <StatusPill label={t("type", { type: artifact.type })} />
              <StatusPill label={t("difficulty", { difficulty: artifact.difficulty })} />
              <StatusPill
                label={t("sourceCount", { count: artifact.sourceIds.length })}
              />
            </div>
            <h2 className="text-lg font-semibold">{artifact.title}</h2>
            {artifact.tags.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("tags", { tags: artifact.tags.join(", ") })}
              </p>
            ) : null}
          </div>
          <SourceToggleButton open={sourceOpen} onClick={onToggleSource} />
        </div>
        {renderStudyArtifactBody(artifact, t)}
      </div>
      {sourceOpen ? (
        <div className="min-h-0 border-t lg:border-l lg:border-t-0">
          <TextPreview fileUrl={fileUrl} label={t("source")} />
        </div>
      ) : null}
    </div>
  );
}

function renderStudyArtifactBody(
  artifact: StudyArtifact,
  t: ReturnType<typeof useTranslations>,
) {
  switch (artifact.type) {
    case "quiz_set":
      return (
        <QuestionList
          title={t("questionCount", { count: artifact.questions.length })}
          questions={artifact.questions}
          t={t}
        />
      );
    case "mock_exam":
      return (
        <div className="space-y-4">
          <SectionLabel>{t("sectionCount", { count: artifact.sections.length })}</SectionLabel>
          {artifact.sections.map((section) => (
            <section key={section.id} className="rounded-md border p-4">
              <h3 className="font-medium">{section.title}</h3>
              {section.instructions ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {section.instructions}
                </p>
              ) : null}
              <div className="mt-3">
                <QuestionList
                  title={t("questionCount", { count: section.questions.length })}
                  questions={section.questions}
                  t={t}
                />
              </div>
            </section>
          ))}
        </div>
      );
    case "flashcard_deck":
      return (
        <div className="space-y-3">
          <SectionLabel>{t("cardCount", { count: artifact.cards.length })}</SectionLabel>
          {artifact.cards.map((card) => (
            <div key={card.id} className="grid gap-2 rounded-md border p-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  {t("front")}
                </div>
                <p className="mt-1 text-sm">{card.front}</p>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  {t("back")}
                </div>
                <p className="mt-1 text-sm">{card.back}</p>
              </div>
            </div>
          ))}
        </div>
      );
    case "fill_blank_set":
      return (
        <div className="space-y-3">
          <SectionLabel>{t("itemCount", { count: artifact.items.length })}</SectionLabel>
          {artifact.items.map((item, index) => (
            <div key={item.id} className="rounded-md border p-4">
              <div className="text-xs font-medium text-muted-foreground">
                {index + 1}
              </div>
              <p className="mt-1 text-sm">{item.prompt}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.blanks.map((blank) => (
                  <StatusPill key={blank.id} label={blank.answer} />
                ))}
              </div>
              <Explanation text={item.explanation} t={t} />
            </div>
          ))}
        </div>
      );
    case "exam_prep_pack":
      return (
        <div className="space-y-5">
          <LabeledList
            title={t("itemCount", { count: artifact.keyConcepts.length })}
            items={artifact.keyConcepts.map((item) => ({
              id: item.id,
              title: item.term,
              body: item.explanation,
            }))}
          />
          <QuestionList
            title={t("questionCount", {
              count: artifact.expectedQuestions.length,
            })}
            questions={artifact.expectedQuestions}
            t={t}
          />
        </div>
      );
    case "compare_table":
      return (
        <StudyTable
          columns={artifact.columns}
          rows={artifact.rows.map((row) => [row.label, ...row.cells])}
        />
      );
    case "glossary":
      return (
        <LabeledList
          title={t("itemCount", { count: artifact.terms.length })}
          items={artifact.terms.map((term) => ({
            id: term.id,
            title: term.term,
            body: term.definition,
            aside: term.example,
          }))}
        />
      );
    case "cheat_sheet":
      return (
        <div className="space-y-3">
          <SectionLabel>{t("sectionCount", { count: artifact.sections.length })}</SectionLabel>
          {artifact.sections.map((section) => (
            <section key={section.id} className="rounded-md border p-4">
              <h3 className="font-medium">{section.heading}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {section.bullets.map((bullet, index) => (
                  <li key={index}>{bullet}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );
    case "data_table":
      return (
        <StudyTable
          columns={artifact.columns}
          rows={artifact.rows.map((row) =>
            artifact.columns.map((column) => formatUnknown(row[column])),
          )}
        />
      );
    case "interactive_html":
      return (
        <pre className="app-scrollbar-thin overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
          {artifact.html}
        </pre>
      );
  }
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground">{children}</div>;
}

function QuestionList({
  title,
  questions,
  t,
}: {
  title: string;
  questions: Array<Extract<StudyArtifact, { type: "quiz_set" }>["questions"][number]>;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-3">
      <SectionLabel>{title}</SectionLabel>
      {questions.map((question, index) => (
        <article key={question.id} className="rounded-md border p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {index + 1} · {question.kind}
          </div>
          <p className="text-sm font-medium">{question.prompt}</p>
          {question.choices?.length ? (
            <div className="mt-3 grid gap-2">
              {question.choices.map((choice) => (
                <div key={choice.id} className="rounded border bg-muted/20 px-3 py-2 text-sm">
                  <span className="mr-2 font-medium text-muted-foreground">
                    {choice.id}
                  </span>
                  {choice.text}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 text-xs text-muted-foreground">
            {t("answer")}: {formatUnknown(question.answer)}
          </div>
          <Explanation text={question.explanation} t={t} />
          {question.sourceRefs.length > 0 ? (
            <div className="mt-2 text-xs text-muted-foreground">
              {t("sourceRefs", { count: question.sourceRefs.length })}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function Explanation({
  text,
  t,
}: {
  text?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!text) return null;
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      <span className="font-medium">{t("explanation")}: </span>
      {text}
    </p>
  );
}

function LabeledList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; title: string; body: string; aside?: string }>;
}) {
  return (
    <div className="space-y-3">
      <SectionLabel>{title}</SectionLabel>
      {items.map((item) => (
        <article key={item.id} className="rounded-md border p-4">
          <h3 className="font-medium">{item.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
          {item.aside ? <p className="mt-2 text-sm">{item.aside}</p> : null}
        </article>
      ))}
    </div>
  );
}

function StudyTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="app-scrollbar-thin overflow-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-background">
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-b px-3 py-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top">
                  <div className="max-w-96 whitespace-pre-wrap">{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  return JSON.stringify(value);
}

function CsvPreview({ fileUrl }: { fileUrl: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);
  const table = useMemo(() => parseCsv(data ?? ""), [data]);
  const [sourceOpen, setSourceOpen] = useState(false);

  if (isLoading)
    return (
      <div className="h-full p-4 text-sm text-muted-foreground">
        {t("loadingInline")}
      </div>
    );
  if (table.length === 0) return <TextPreview fileUrl={fileUrl} />;

  const headers = table[0] ?? [];
  const rows = table.slice(1);
  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-cols-1",
        sourceOpen && "lg:grid-cols-2",
      )}
    >
      <div className="app-scrollbar-thin h-full overflow-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Table2 className="h-3.5 w-3.5" />
            {t("csvTable", { rows: rows.length })}
          </div>
          <SourceToggleButton
            open={sourceOpen}
            onClick={() => setSourceOpen((open) => !open)}
          />
        </div>
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-background">
            <tr>
              {headers.map((cell, index) => (
                <th
                  key={index}
                  className="border-b px-3 py-2 font-medium text-muted-foreground"
                >
                  {cell || t("column", { index: index + 1 })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b last:border-0">
                {headers.map((_, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn(
                      "px-3 py-2 align-top",
                      rowIndex % 2 === 1 && "bg-muted/20",
                    )}
                  >
                    <div className="max-w-80 truncate">
                      {row[cellIndex] ?? ""}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sourceOpen ? (
        <div className="min-h-0 border-t lg:border-l lg:border-t-0">
          <TextPreview fileUrl={fileUrl} label={t("source")} />
        </div>
      ) : null}
    </div>
  );
}

function SourceToggleButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("agentFiles.viewer");
  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={onClick}
      className="app-btn-ghost min-h-7 shrink-0 rounded-[var(--radius-control)] border border-border px-2 text-xs text-muted-foreground"
    >
      {open ? t("hideSource") : t("showSource")}
    </button>
  );
}

function TextPreview({ fileUrl, label }: { fileUrl: string; label?: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {label ? (
        <div className="flex h-9 items-center gap-2 border-b px-3 text-xs font-medium text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {label}
        </div>
      ) : null}
      <pre className="app-scrollbar-thin min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5">
        {isLoading ? t("loadingInline") : data}
      </pre>
    </div>
  );
}

function useTextFile(fileUrl: string) {
  return useQuery({
    queryKey: ["agent-file-text", fileUrl],
    queryFn: async () => {
      const res = await fetch(fileUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`file ${res.status}`);
      return res.text();
    },
  });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.length > 1 || row[0].length > 0) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }

  row.push(cell);
  if (row.length > 1 || row[0].length > 0) rows.push(row);
  return rows.slice(0, 500);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
