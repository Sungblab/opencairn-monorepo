"use client";

import { useEffect, useMemo, useState } from "react";
import { FilePlus2, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  agentActionsApi,
  documentGenerationApi,
  type DocumentGenerationFormat,
  type DocumentGenerationSourceOption,
} from "@/lib/api-client";

const FORMATS: DocumentGenerationFormat[] = ["pdf", "docx", "pptx", "xlsx"];
const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

type Props = {
  projectId: string | null;
  onEvent(event: unknown): void;
};

function defaultFilename(format: DocumentGenerationFormat): string {
  return `generated-document.${format}`;
}

function filenameForFormat(value: string, format: DocumentGenerationFormat): string {
  const trimmed = value.trim();
  if (!trimmed) return defaultFilename(format);
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "");
  return `${withoutExtension || "generated-document"}.${format}`;
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
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<DocumentGenerationSourceOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<DocumentGenerationFormat>("pdf");
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

  const selectedSources = useMemo(
    () => sources.filter((source) => selectedIds.includes(source.id)),
    [selectedIds, sources],
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
    const finalFilename = filenameForFormat(filename, format);
    try {
      const response = await documentGenerationApi.generate(currentProjectId, {
        type: "generate_project_object",
        requestId: crypto.randomUUID(),
        generation: {
          format,
          prompt: prompt.trim(),
          locale: "ko",
          template:
            format === "pptx"
              ? "deck"
              : format === "xlsx"
                ? "spreadsheet"
                : "report",
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
          <div className="grid max-h-40 gap-1 overflow-auto">
            {sources.map((source) => (
              <label
                key={source.id}
                className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedIds.includes(source.id)}
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
                setFormat(event.target.value as DocumentGenerationFormat);
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
              placeholder={defaultFilename(format)}
              onChange={(event) => setFilename(event.target.value)}
            />
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
