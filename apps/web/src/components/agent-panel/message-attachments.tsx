"use client";

import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FolderOpen,
  LoaderCircle,
  XCircle,
} from "lucide-react";

import { newTab } from "@/lib/tab-factory";
import { useTabsStore } from "@/stores/tabs-store";

export type AgentFileCardItem = {
  id: string;
  title: string;
  filename: string;
  kind?: string;
  mimeType?: string;
};

type DocumentGenerationStatus = "queued" | "running" | "completed" | "failed";
type DocumentGenerationSourceKind =
  | "note"
  | "agent_file"
  | "chat_thread"
  | "research_run"
  | "synthesis_run";
type DocumentGenerationQualitySignal =
  | "metadata_fallback"
  | "unsupported_source"
  | "source_corrupt"
  | "source_oversized"
  | "scanned_no_text"
  | "no_extracted_text"
  | "source_hydration_failed"
  | "source_token_budget_exceeded";

type DocumentGenerationQualitySource = {
  id: string;
  kind: string;
  title: string;
  signals: DocumentGenerationQualitySignal[];
};

export type DocumentGenerationCardItem = {
  requestId: string;
  status: DocumentGenerationStatus;
  format?: string;
  title: string;
  filename?: string;
  errorCode?: string;
  sourceKinds: DocumentGenerationSourceKind[];
  qualitySignals?: DocumentGenerationQualitySignal[];
  qualitySources?: DocumentGenerationQualitySource[];
  file?: AgentFileCardItem;
};

export function asAgentFileCards(...values: unknown[]): AgentFileCardItem[] {
  const byId = new Map<string, AgentFileCardItem>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (record.objectType && record.objectType !== "agent_file") continue;
      if (typeof record.id !== "string") continue;
      const filename =
        typeof record.filename === "string" ? record.filename : "generated";
      byId.set(record.id, {
        id: record.id,
        title:
          typeof record.title === "string" && record.title.trim()
            ? record.title
            : filename,
        filename,
        ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
        ...(typeof record.mimeType === "string"
          ? { mimeType: record.mimeType }
          : {}),
      });
    }
  }
  return [...byId.values()];
}

function statusRank(status: DocumentGenerationStatus): number {
  switch (status) {
    case "queued":
      return 1;
    case "running":
      return 2;
    case "completed":
      return 3;
    case "failed":
      return 4;
  }
}

function setGenerationCard(
  byId: Map<string, DocumentGenerationCardItem>,
  next: DocumentGenerationCardItem,
): void {
  const prev = byId.get(next.requestId);
  if (!prev) {
    byId.set(next.requestId, next);
    return;
  }
  byId.set(next.requestId, {
    ...prev,
    ...next,
    title: next.title || prev.title,
    filename: next.filename ?? prev.filename,
    format: next.format ?? prev.format,
    errorCode: next.errorCode ?? prev.errorCode,
    sourceKinds:
      next.sourceKinds.length > 0 ? next.sourceKinds : prev.sourceKinds,
    file: next.file ?? prev.file,
    qualitySignals:
      next.qualitySignals && next.qualitySignals.length > 0
        ? next.qualitySignals
        : prev.qualitySignals,
    qualitySources:
      next.qualitySources && next.qualitySources.length > 0
        ? next.qualitySources
        : prev.qualitySources,
    status:
      statusRank(next.status) >= statusRank(prev.status)
        ? next.status
        : prev.status,
  });
}

function readQualitySignals(
  result: Record<string, unknown>,
): DocumentGenerationQualitySignal[] {
  const sourceQuality = result.sourceQuality;
  if (!sourceQuality || typeof sourceQuality !== "object") return [];
  const signals = (sourceQuality as Record<string, unknown>).signals;
  if (!Array.isArray(signals)) return [];
  return signals.filter(
    (signal): signal is DocumentGenerationQualitySignal =>
      signal === "metadata_fallback" ||
      signal === "unsupported_source" ||
      signal === "source_corrupt" ||
      signal === "source_oversized" ||
      signal === "scanned_no_text" ||
      signal === "no_extracted_text" ||
      signal === "source_hydration_failed" ||
      signal === "source_token_budget_exceeded",
  );
}

function readQualitySources(
  result: Record<string, unknown>,
): DocumentGenerationQualitySource[] {
  const sourceQuality = result.sourceQuality;
  if (!sourceQuality || typeof sourceQuality !== "object") return [];
  const sources = (sourceQuality as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((source): DocumentGenerationQualitySource[] => {
    if (!source || typeof source !== "object") return [];
    const record = source as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.kind !== "string" ||
      typeof record.title !== "string"
    ) {
      return [];
    }
    const signals = readQualitySignals({
      sourceQuality: { signals: record.signals },
    });
    return signals.length > 0
      ? [{ id: record.id, kind: record.kind, title: record.title, signals }]
      : [];
  });
}

function asGenerationFile(value: unknown): AgentFileCardItem | undefined {
  const [file] = asAgentFileCards([value]);
  return file;
}

function readGenerationRequest(value: Record<string, unknown>) {
  return typeof value.generation === "object" && value.generation !== null
    ? (value.generation as Record<string, unknown>)
    : null;
}

function readDestination(generation: Record<string, unknown> | null) {
  return generation &&
    typeof generation.destination === "object" &&
    generation.destination !== null
    ? (generation.destination as Record<string, unknown>)
    : null;
}

function readSourceKinds(
  generation: Record<string, unknown> | null,
): DocumentGenerationSourceKind[] {
  if (!generation || !Array.isArray(generation.sources)) return [];
  const kinds = new Set<DocumentGenerationSourceKind>();
  for (const source of generation.sources) {
    if (!source || typeof source !== "object") continue;
    const type = (source as Record<string, unknown>).type;
    if (
      type === "note" ||
      type === "agent_file" ||
      type === "chat_thread" ||
      type === "research_run" ||
      type === "synthesis_run"
    ) {
      kinds.add(type);
    }
  }
  return [...kinds];
}

function appendGenerationEvent(
  byId: Map<string, DocumentGenerationCardItem>,
  value: unknown,
): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "project_object_generation_requested") {
    const requestId =
      typeof record.requestId === "string" ? record.requestId : undefined;
    if (!requestId) return;
    const generation = readGenerationRequest(record);
    const destination = readDestination(generation);
    const filename =
      typeof destination?.filename === "string"
        ? destination.filename
        : undefined;
    const title =
      typeof destination?.title === "string" && destination.title.trim()
        ? destination.title
        : filename || requestId;
    setGenerationCard(byId, {
      requestId,
      status: "queued",
      format:
        typeof generation?.format === "string" ? generation.format : undefined,
      title,
      filename,
      sourceKinds: readSourceKinds(generation),
    });
    return;
  }

  if (type === "project_object_generation_status") {
    const requestId =
      typeof record.requestId === "string" ? record.requestId : undefined;
    const status =
      record.status === "running" || record.status === "queued"
        ? record.status
        : undefined;
    if (!requestId || !status) return;
    setGenerationCard(byId, {
      requestId,
      status,
      title: requestId,
      sourceKinds: [],
    });
    return;
  }

  if (
    type === "project_object_generation_completed" ||
    (record.ok === true && typeof record.requestId === "string")
  ) {
    const result =
      type === "project_object_generation_completed" &&
      typeof record.result === "object" &&
      record.result !== null
        ? (record.result as Record<string, unknown>)
        : record;
    const requestId =
      typeof result.requestId === "string" ? result.requestId : undefined;
    if (!requestId) return;
    const file = asGenerationFile(result.object);
    setGenerationCard(byId, {
      requestId,
      status: "completed",
      format: typeof result.format === "string" ? result.format : file?.kind,
      title: file?.title ?? requestId,
      filename: file?.filename,
      sourceKinds: [],
      file,
      qualitySignals: readQualitySignals(result),
      qualitySources: readQualitySources(result),
    });
    return;
  }

  if (
    type === "project_object_generation_failed" ||
    (record.ok === false && typeof record.requestId === "string")
  ) {
    const result =
      type === "project_object_generation_failed" &&
      typeof record.result === "object" &&
      record.result !== null
        ? (record.result as Record<string, unknown>)
        : record;
    const requestId =
      typeof result.requestId === "string" ? result.requestId : undefined;
    if (!requestId) return;
    setGenerationCard(byId, {
      requestId,
      status: "failed",
      format: typeof result.format === "string" ? result.format : undefined,
      title: requestId,
      errorCode:
        typeof result.errorCode === "string" ? result.errorCode : undefined,
      sourceKinds: [],
      qualitySignals: readQualitySignals(result),
      qualitySources: readQualitySources(result),
    });
  }
}

export function asDocumentGenerationCards(
  ...values: unknown[]
): DocumentGenerationCardItem[] {
  const byId = new Map<string, DocumentGenerationCardItem>();
  for (const value of values) {
    if (Array.isArray(value)) {
      value.forEach((item) => appendGenerationEvent(byId, item));
    } else {
      appendGenerationEvent(byId, value);
    }
  }
  return [...byId.values()];
}

function GenerationStatusIcon({
  status,
}: {
  status: DocumentGenerationStatus;
}) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "running":
      return (
        <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
      );
    case "queued":
      return <Clock3 className="h-4 w-4 text-muted-foreground" />;
  }
}

function generationDownloadUrl(
  item: DocumentGenerationCardItem,
): string | null {
  return item.file
    ? `/api/agent-files/${encodeURIComponent(item.file.id)}/file`
    : null;
}

export function DocumentGenerationCards({
  items,
}: {
  items: DocumentGenerationCardItem[];
}) {
  const t = useTranslations("agentFiles.generation");
  const addOrActivateTab = useTabsStore((s) => s.addTab);
  const findTabByTarget = useTabsStore((s) => s.findTabByTarget);
  const setActive = useTabsStore((s) => s.setActive);

  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const canOpen = item.status === "completed" && item.file;
        const downloadUrl = generationDownloadUrl(item);
        const sourceSummary =
          item.sourceKinds.length > 0
            ? item.sourceKinds
                .map((kind) => t(`sourceLabel.${kind}`))
                .join(", ")
            : t("sourceLabel.none");
        return (
          <div
            key={item.requestId}
            className="flex w-full items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left"
          >
            <span className="mt-0.5 shrink-0">
              <GenerationStatusIcon status={item.status} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {t("statusDetail", {
                  status: t(`statusLabel.${item.status}`),
                  format: (
                    item.format ??
                    item.file?.kind ??
                    "file"
                  ).toUpperCase(),
                  filename:
                    item.filename ?? item.file?.filename ?? item.requestId,
                })}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {t("sourceSummary", { sources: sourceSummary })}
              </span>
              {item.status === "failed" && item.errorCode ? (
                <span className="block truncate text-xs text-red-600">
                  {t("errorCode", { code: item.errorCode })}
                </span>
              ) : null}
              {item.qualitySignals && item.qualitySignals.length > 0 ? (
                <span className="block truncate text-xs text-amber-700">
                  {t("qualitySummary", {
                    signals: item.qualitySignals
                      .slice(0, 3)
                      .map((signal) => t(`qualitySignal.${signal}`))
                      .join(", "),
                  })}
                </span>
              ) : null}
              {item.qualitySources && item.qualitySources.length > 0 ? (
                <span className="block truncate text-xs text-amber-700">
                  {t("qualitySourceSummary", {
                    count: item.qualitySources.length,
                    sources: item.qualitySources
                      .slice(0, 2)
                      .map((source) => source.title)
                      .join(", "),
                  })}
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={!canOpen}
                className="app-btn-ghost inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs disabled:cursor-default disabled:opacity-50"
                onClick={() => {
                  if (!item.file) return;
                  const existing = findTabByTarget("agent_file", item.file.id);
                  if (existing) {
                    setActive(existing.id);
                    return;
                  }
                  addOrActivateTab(
                    newTab({
                      kind: "agent_file",
                      targetId: item.file.id,
                      title: item.file.title,
                      mode: "agent-file",
                      preview: false,
                    }),
                  );
                }}
              >
                <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
                {canOpen ? t("open") : t(`pendingAction.${item.status}`)}
              </button>
              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  className="app-btn-ghost inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs"
                >
                  <Download aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("download")}
                </a>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AgentFileCards({ files }: { files: AgentFileCardItem[] }) {
  const t = useTranslations("agentFiles.card");
  const addOrActivateTab = useTabsStore((s) => s.addTab);
  const findTabByTarget = useTabsStore((s) => s.findTabByTarget);
  const setActive = useTabsStore((s) => s.setActive);

  return (
    <div className="grid gap-2">
      {files.map((file) => (
        <button
          key={file.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted"
          onClick={() => {
            const existing = findTabByTarget("agent_file", file.id);
            if (existing) {
              setActive(existing.id);
              return;
            }
            addOrActivateTab(
              newTab({
                kind: "agent_file",
                targetId: file.id,
                title: file.title,
                mode: "agent-file",
                preview: false,
              }),
            );
          }}
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {file.title}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {t("created", { filename: file.filename })}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{t("open")}</span>
        </button>
      ))}
    </div>
  );
}
