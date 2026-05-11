"use client";

import { useEffect, useMemo, useState } from "react";
import { FilePlus2, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  agentActionsApi,
  documentGenerationApi,
  type DocumentGenerationFormat,
  type ImageRenderEngine,
  type DocumentGenerationSourceOption,
  type PdfRenderEngine,
} from "@/lib/api-client";

const FORMATS: DocumentGenerationFormat[] = ["pdf", "docx", "pptx", "xlsx", "image"];
const PDF_RENDER_ENGINES: PdfRenderEngine[] = ["latex", "pymupdf"];
const IMAGE_RENDER_ENGINES: ImageRenderEngine[] = ["svg", "model"];
const REPORT_TEMPLATES = [
  "report",
  "brief",
  "research_summary",
  "technical_report",
  "research_brief",
  "paper_style",
  "business_report",
] as const;
const DOCUMENT_GENERATION_TEMPLATES = [
  ...REPORT_TEMPLATES,
  "deck",
  "spreadsheet",
  "custom",
] as const;
type DocumentGenerationTemplate = (typeof DOCUMENT_GENERATION_TEMPLATES)[number];
const TEMPLATE_OPTIONS_BY_FORMAT = {
  pdf: REPORT_TEMPLATES,
  docx: REPORT_TEMPLATES,
  pptx: ["deck", "custom"],
  xlsx: ["spreadsheet", "custom"],
  image: ["research_brief", "technical_report", "business_report", "custom"],
} satisfies Record<DocumentGenerationFormat, readonly DocumentGenerationTemplate[]>;
const DEFAULT_TEMPLATE_BY_FORMAT = {
  pdf: "technical_report",
  docx: "report",
  pptx: "deck",
  xlsx: "spreadsheet",
  image: "research_brief",
} satisfies Record<DocumentGenerationFormat, DocumentGenerationTemplate>;
const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

type Props = {
  projectId: string | null;
  onEvent(event: unknown): void;
};

function defaultFilename(format: DocumentGenerationFormat, imageEngine: ImageRenderEngine = "svg"): string {
  if (format === "image") return imageEngine === "model" ? "generated-figure.png" : "generated-figure.svg";
  return `generated-document.${format}`;
}

function filenameForFormat(
  value: string,
  format: DocumentGenerationFormat,
  imageEngine: ImageRenderEngine = "svg",
): string {
  const trimmed = value.trim();
  if (!trimmed) return defaultFilename(format, imageEngine);
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "");
  const extension = format === "image" ? (imageEngine === "model" ? "png" : "svg") : format;
  return `${withoutExtension || (format === "image" ? "generated-figure" : "generated-document")}.${extension}`;
}

function templateOptionsFor(format: DocumentGenerationFormat): readonly DocumentGenerationTemplate[] {
  return TEMPLATE_OPTIONS_BY_FORMAT[format];
}

function eventFromAction(action: {
  requestId: string;
  status: string;
  result: Record<string, unknown> | null;
  errorCode?: string | null;
}): unknown | null {
  if (action.status === "completed" && action.result?.ok === true) {
    return {
      type: "project_object_generation_completed",
      result: action.result,
    };
  }
  if (action.status === "failed") {
    return {
      type: "project_object_generation_failed",
      result: action.result ?? {
        ok: false,
        requestId: action.requestId,
        errorCode: action.errorCode ?? "document_generation_failed",
        retryable: true,
      },
    };
  }
  if (action.status === "queued" || action.status === "running") {
    return {
      type: "project_object_generation_status",
      requestId: action.requestId,
      status: action.status,
    };
  }
  return null;
}

export function DocumentGenerationForm({ projectId, onEvent }: Props) {
  const t = useTranslations("agentPanel.documentGeneration");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<DocumentGenerationSourceOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<DocumentGenerationFormat>("pdf");
  const [renderEngine, setRenderEngine] = useState<PdfRenderEngine>("pymupdf");
  const [imageEngine, setImageEngine] = useState<ImageRenderEngine>("svg");
  const [template, setTemplate] = useState<DocumentGenerationTemplate>("technical_report");
  const [filename, setFilename] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await documentGenerationApi.sources(projectId);
        if (!cancelled) setSources(response.sources);
      } catch {
        if (!cancelled) setError(t("loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, t]);

  useEffect(() => {
    const options = templateOptionsFor(format);
    if (!options.includes(template)) {
      setTemplate(DEFAULT_TEMPLATE_BY_FORMAT[format]);
    }
  }, [format, template]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSources = useMemo(
    () => sources.filter((source) => selectedIdSet.has(source.id)),
    [selectedIdSet, sources],
  );
  const canSubmit = Boolean(projectId && prompt.trim() && selectedSources.length > 0 && !busy);
  const selectedSummary =
    selectedSources.length > 0
      ? t("selectedCount", { count: selectedSources.length })
      : t("selectedNone");

  async function pollAction(actionId: string): Promise<void> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const { action } = await agentActionsApi.get(actionId);
      const event = eventFromAction(action);
      if (event) onEvent(event);
      if (TERMINAL_STATUSES.has(action.status)) return;
    }
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    const currentProjectId = projectId;
    if (!currentProjectId) return;
    setBusy(true);
    setError(null);
    const finalFilename = filenameForFormat(filename, format, imageEngine);
    try {
      const response = await documentGenerationApi.generate(currentProjectId, {
        type: "generate_project_object",
        requestId: crypto.randomUUID(),
        generation: {
          format,
          prompt: prompt.trim(),
          locale,
          template,
          ...(format === "pdf" ? { renderEngine } : {}),
          ...(format === "image" ? { imageEngine } : {}),
          sources: selectedSources.map((source) => source.source),
          destination: {
            filename: finalFilename,
            publishAs: "agent_file",
            startIngest: false,
          },
          artifactMode: "object_storage",
        },
      });
      onEvent(response.event);
      setPrompt("");
      setFilename("");
      void pollAction(response.action.id).catch(() => {
        setError(t("pollFailed"));
      });
    } catch {
      setError(t("submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border p-2">
      <button
        type="button"
        className="app-btn-ghost flex w-full items-center justify-between rounded-[var(--radius-control)] px-2 py-1.5 text-xs"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="inline-flex items-center gap-1.5">
          <FilePlus2 aria-hidden="true" className="h-3.5 w-3.5" />
          {t("toggle")}
        </span>
        <span className="text-muted-foreground">{selectedSummary}</span>
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 rounded-[var(--radius-card)] border border-border bg-background p-2">
          <div className="app-scrollbar-thin grid max-h-40 gap-1 overflow-auto">
            {sources.map((source) => (
              <label
                key={source.id}
                className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedIdSet.has(source.id)}
                  onChange={(event) => {
                    setSelectedIds((ids) =>
                      event.target.checked
                        ? [...ids, source.id]
                        : ids.filter((id) => id !== source.id),
                    );
                  }}
                  aria-label={source.title}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{source.title}</span>
                  <span className="block truncate text-muted-foreground">
                    {t(`sourceLabel.${source.type}`)}
                    {source.subtitle ? ` · ${source.subtitle}` : ""}
                  </span>
                  {source.qualitySignals?.length ? (
                    <span className="block truncate text-amber-700">
                      {source.qualitySignals
                        .slice(0, 2)
                        .map((signal) => t(`qualitySignal.${signal}`))
                        .join(", ")}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="doc-gen-format">
              {t("format")}
            </label>
            <select
              id="doc-gen-format"
              aria-label="format"
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              value={format}
              onChange={(event) => {
                const nextFormat = event.target.value as DocumentGenerationFormat;
                setFormat(nextFormat);
                setTemplate(DEFAULT_TEMPLATE_BY_FORMAT[nextFormat]);
              }}
            >
              {FORMATS.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
            <label className="text-xs text-muted-foreground" htmlFor="doc-gen-filename">
              {t("filename")}
            </label>
            <input
              id="doc-gen-filename"
              aria-label="filename"
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              value={filename}
              placeholder={defaultFilename(format, imageEngine)}
              onChange={(event) => setFilename(event.target.value)}
            />
            <label className="text-xs text-muted-foreground" htmlFor="doc-gen-template">
              {t("template")}
            </label>
            <select
              id="doc-gen-template"
              aria-label="template"
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              value={template}
              onChange={(event) => {
                setTemplate(event.target.value as DocumentGenerationTemplate);
              }}
            >
              {templateOptionsFor(format).map((value) => (
                <option key={value} value={value}>
                  {t(`templateOption.${value}`)}
                </option>
              ))}
            </select>
            {format === "pdf" ? (
              <>
                <label className="text-xs text-muted-foreground" htmlFor="doc-gen-render-engine">
                  {t("renderEngine")}
                </label>
                <select
                  id="doc-gen-render-engine"
                  aria-label="render engine"
                  className="rounded border border-border bg-background px-2 py-1 text-xs"
                  value={renderEngine}
                  onChange={(event) => {
                    setRenderEngine(event.target.value as PdfRenderEngine);
                  }}
                >
                  {PDF_RENDER_ENGINES.map((value) => (
                    <option key={value} value={value}>
                      {t(`renderEngineOption.${value}`)}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {format === "image" ? (
              <>
                <label className="text-xs text-muted-foreground" htmlFor="doc-gen-image-engine">
                  {t("imageEngine")}
                </label>
                <select
                  id="doc-gen-image-engine"
                  aria-label="image engine"
                  className="rounded border border-border bg-background px-2 py-1 text-xs"
                  value={imageEngine}
                  onChange={(event) => {
                    setImageEngine(event.target.value as ImageRenderEngine);
                  }}
                >
                  {IMAGE_RENDER_ENGINES.map((value) => (
                    <option key={value} value={value}>
                      {t(`imageEngineOption.${value}`)}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>
          <textarea
            aria-label="prompt"
            className="min-h-20 resize-none rounded border border-border bg-background px-2 py-1.5 text-xs"
            value={prompt}
            placeholder={t("promptPlaceholder")}
            onChange={(event) => setPrompt(event.target.value)}
          />
          {selectedSources.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("sourceRequired")}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="app-btn-primary inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-control)] px-3 text-xs disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("submit")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
