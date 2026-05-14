"use client";

import { useState } from "react";
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

import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import { taskFeedbackApi } from "@/lib/api-client";
import { useTabsStore } from "@/stores/tabs-store";

export type AgentFileCardItem = {
  id: string;
  projectId?: string;
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
        ...(typeof record.projectId === "string"
          ? { projectId: record.projectId }
          : {}),
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

function openGenerationArtifact(file: AgentFileCardItem) {
  const tabs = useTabsStore.getState();
  const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
  openOriginalFileTab(file.id, file.title, {
    openToRight: active?.kind === "note" && active.mode === "source",
  });
}

export function DocumentGenerationCards({
  items,
}: {
  items: DocumentGenerationCardItem[];
}) {
  const t = useTranslations("agentFiles.generation");
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
            className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-left"
          >
            <div className="flex items-start gap-2">
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
                {item.file?.kind === "image" && downloadUrl ? (
                  <img
                    src={downloadUrl}
                    alt={item.file.title}
                    className="mt-2 max-h-44 w-full rounded-[var(--radius-control)] border border-border object-contain"
                  />
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={!canOpen}
                  className="app-btn-ghost inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs disabled:cursor-default disabled:opacity-50"
                  onClick={() => {
                    if (!item.file) return;
                    openGenerationArtifact(item.file);
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
            {item.status === "completed" && item.file?.projectId ? (
              <TaskFeedbackCard item={item} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TaskFeedbackCard({ item }: { item: DocumentGenerationCardItem }) {
  const t = useTranslations("agentFiles.generation.feedback");
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [followUpIntent, setFollowUpIntent] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(rating: "useful" | "not_useful" | "skipped") {
    setPending(true);
    try {
      await taskFeedbackApi.submit({
        projectId: item.file!.projectId!,
        targetType: "document_generation",
        targetId: item.requestId,
        artifactId: item.file?.id,
        rating,
        ...(reason ? { reason } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(followUpIntent ? { followUpIntent } : {}),
        metadata: {
          format: item.format,
          filename: item.filename ?? item.file?.filename,
          sourceKinds: item.sourceKinds,
          qualitySignals: item.qualitySignals ?? [],
        },
      });
      setSubmitted(true);
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-[var(--radius-control)] border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-foreground">
        {t("submitted")}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {t("title")}
        </span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="app-btn-ghost h-7 rounded-[var(--radius-control)] px-2 text-xs"
            disabled={pending}
            onClick={() => void submit("useful")}
          >
            {t("useful")}
          </button>
          <button
            type="button"
            className="app-btn-ghost h-7 rounded-[var(--radius-control)] px-2 text-xs"
            disabled={pending}
            onClick={() => setReason((value) => value ?? "too_shallow")}
          >
            {t("notUseful")}
          </button>
          <button
            type="button"
            className="app-btn-ghost h-7 rounded-[var(--radius-control)] px-2 text-xs text-muted-foreground"
            disabled={pending}
            onClick={() => void submit("skipped")}
          >
            {t("skip")}
          </button>
        </div>
      </div>
      {reason ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {["inaccurate", "too_shallow", "wrong_format", "missing_sources"].map(
              (key) => (
                <button
                  key={key}
                  type="button"
                  className={`h-7 rounded-[var(--radius-control)] border px-2 text-xs ${
                    reason === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                  onClick={() => setReason(key)}
                >
                  {t(`reason.${key}`)}
                </button>
              ),
            )}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            placeholder={t("commentPlaceholder")}
            className="min-h-16 w-full resize-none rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {["refine", "regenerate", "open"].map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`h-7 rounded-[var(--radius-control)] border px-2 text-xs ${
                    followUpIntent === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                  onClick={() => setFollowUpIntent(key)}
                >
                  {t(`followUp.${key}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="app-btn-primary h-7 rounded-[var(--radius-control)] px-2 text-xs"
              disabled={pending}
              onClick={() => void submit("not_useful")}
            >
              {t("submit")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AgentFileCards({ files }: { files: AgentFileCardItem[] }) {
  const t = useTranslations("agentFiles.card");

  return (
    <div className="grid gap-2">
      {files.map((file) => (
        <button
          key={file.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted"
          onClick={() => {
            openGenerationArtifact(file);
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
            {file.kind === "image" ? (
              <img
                src={`/api/agent-files/${encodeURIComponent(file.id)}/file`}
                alt={file.title}
                className="mt-2 max-h-40 w-full rounded-[var(--radius-control)] border border-border object-contain"
              />
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">{t("open")}</span>
        </button>
      ))}
    </div>
  );
}
