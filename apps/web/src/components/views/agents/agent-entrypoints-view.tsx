"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  FileAudio,
  Lightbulb,
  Play,
  RefreshCw,
  Rows3,
  RotateCw,
  Square,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  plan8AgentsApi,
  type Plan8AgentName,
  type Plan8AgentRun,
  type Plan8AudioFile,
  type Plan8StaleAlert,
  type Plan8Suggestion,
} from "@/lib/api-client";
import { urls } from "@/lib/urls";

type LaunchKind = Plan8AgentName;

const LAUNCH_ORDER: LaunchKind[] = [
  "synthesis",
  "curator",
  "connector",
  "staleness",
  "narrator",
];

function formatPayload(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload)
    .slice(0, 3)
    .map(([key, value]) => {
      const rendered =
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : JSON.stringify(value);
      return `${key}: ${rendered}`;
    });
  return parts.join(" / ");
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds) return null;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

function isRunTerminal(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

function workspaceSlugFromPathname(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/workspace\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function usePlan8RunPolling({
  run,
  refetch,
}: {
  run: Plan8AgentRun | null;
  refetch: () => void;
}) {
  useEffect(() => {
    if (!run || isRunTerminal(run.status)) return;
    const interval = window.setInterval(refetch, 5000);
    return () => window.clearInterval(interval);
  }, [refetch, run]);
}

export function AgentEntryPointsView({ projectId }: { projectId: string }) {
  const locale = useLocale();
  const t = useTranslations("agents");
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["plan8-agents", projectId], [projectId]);

  const [synthesisNoteIds, setSynthesisNoteIds] = useState<string[]>([]);
  const [connectorConceptId, setConnectorConceptId] = useState("");
  const [narratorNoteId, setNarratorNoteId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const workspaceSlug = useMemo(workspaceSlugFromPathname, []);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => plan8AgentsApi.overview(projectId),
  });
  const selectedRun =
    data?.agentRuns.find((run) => run.runId === selectedRunId) ?? null;

  usePlan8RunPolling({
    run: selectedRun,
    refetch: () => {
      void refetch();
    },
  });

  useEffect(() => {
    if (!data) return;
    if (synthesisNoteIds.length === 0) {
      setSynthesisNoteIds(data.launch.notes.slice(0, 2).map((note) => note.id));
    }
    if (!connectorConceptId && data.launch.concepts[0]) {
      setConnectorConceptId(data.launch.concepts[0].id);
    }
    if (!narratorNoteId && data.launch.notes[0]) {
      setNarratorNoteId(data.launch.notes[0].id);
    }
  }, [connectorConceptId, data, narratorNoteId, synthesisNoteIds.length]);

  const launch = useMutation({
    mutationFn: async (kind: LaunchKind) => {
      switch (kind) {
        case "synthesis":
          return plan8AgentsApi.runSynthesis({
            projectId,
            noteIds: synthesisNoteIds,
            title: t("defaults.synthesisTitle"),
          });
        case "curator":
          return plan8AgentsApi.runCurator({ projectId });
        case "connector":
          return plan8AgentsApi.runConnector({
            projectId,
            conceptId: connectorConceptId,
          });
        case "staleness":
          return plan8AgentsApi.runStaleness({ projectId });
        case "narrator":
          return plan8AgentsApi.runNarrator({ noteId: narratorNoteId });
      }
    },
    onSuccess: (result, kind) => {
      toast.success(t("toast.started", { agent: t(`launch.${kind}.name`) }), {
        description: result.workflowId,
      });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast.error(t("toast.failed"));
    },
  });

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );

  function formatDate(value: string): string {
    return dateFormatter.format(new Date(value));
  }

  function canLaunch(kind: LaunchKind): boolean {
    if (launch.isPending) return false;
    if (kind === "synthesis") return synthesisNoteIds.length > 0;
    if (kind === "connector") return Boolean(connectorConceptId);
    if (kind === "narrator") return Boolean(narratorNoteId);
    return true;
  }

  function toggleSynthesisNote(noteId: string) {
    setSynthesisNoteIds((current) =>
      current.includes(noteId)
        ? current.filter((id) => id !== noteId)
        : [...current, noteId].slice(0, 10),
    );
  }

  return (
    <div data-testid="route-agents" className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-sm hover:bg-accent disabled:opacity-50"
          disabled={isFetching}
        >
          <RefreshCw
            aria-hidden
            className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </button>
      </header>

      {isLoading ? (
        <div className="rounded border border-border p-4 text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : isError || !data ? (
        <div className="rounded border border-destructive/40 p-4 text-sm text-destructive">
          {t("error")}
        </div>
      ) : (
        <>
          <section className="grid gap-3 xl:grid-cols-5">
            {LAUNCH_ORDER.map((kind) => (
              <LaunchPanel
                key={kind}
                kind={kind}
                disabled={!canLaunch(kind)}
                onLaunch={() => launch.mutate(kind)}
              >
                {kind === "synthesis" ? (
                  <div className="flex max-h-32 flex-col gap-1 overflow-auto">
                    {data.launch.notes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t("launch.noNotes")}
                      </p>
                    ) : (
                      data.launch.notes.map((note) => (
                        <label
                          key={note.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={synthesisNoteIds.includes(note.id)}
                            onChange={() => toggleSynthesisNote(note.id)}
                          />
                          <span className="truncate">{note.title}</span>
                        </label>
                      ))
                    )}
                  </div>
                ) : null}
                {kind === "connector" ? (
                  <select
                    aria-label={t("launch.connector.select")}
                    value={connectorConceptId}
                    onChange={(event) =>
                      setConnectorConceptId(event.target.value)
                    }
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  >
                    {data.launch.concepts.length === 0 ? (
                      <option value="">{t("launch.noConcepts")}</option>
                    ) : (
                      data.launch.concepts.map((concept) => (
                        <option key={concept.id} value={concept.id}>
                          {concept.name}
                        </option>
                      ))
                    )}
                  </select>
                ) : null}
                {kind === "narrator" ? (
                  <select
                    aria-label={t("launch.narrator.select")}
                    value={narratorNoteId}
                    onChange={(event) => setNarratorNoteId(event.target.value)}
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  >
                    {data.launch.notes.length === 0 ? (
                      <option value="">{t("launch.noNotes")}</option>
                    ) : (
                      data.launch.notes.map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.title}
                        </option>
                      ))
                    )}
                  </select>
                ) : null}
              </LaunchPanel>
            ))}
          </section>

          <section className="grid gap-6 2xl:grid-cols-2">
            <RunsTable
              rows={data.agentRuns}
              formatDate={formatDate}
              empty={t("empty.runs")}
              onSelectRun={setSelectedRunId}
            />
            <SuggestionsTable
              rows={data.suggestions}
              formatDate={formatDate}
              empty={t("empty.suggestions")}
              locale={locale}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
            />
            <StaleAlertsTable
              rows={data.staleAlerts}
              formatDate={formatDate}
              empty={t("empty.staleAlerts")}
              locale={locale}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
            />
            <AudioFilesList
              rows={data.audioFiles}
              formatDate={formatDate}
              empty={t("empty.audioFiles")}
              locale={locale}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
            />
          </section>
          <RunDetailSheet
            run={selectedRun}
            open={Boolean(selectedRun)}
            onOpenChange={(open) => {
              if (!open) setSelectedRunId(null);
            }}
            formatDate={formatDate}
            onRetry={(agentName) => launch.mutate(agentName)}
            retryDisabled={
              !selectedRun ||
              launch.isPending ||
              !canLaunch(selectedRun.agentName)
            }
          />
        </>
      )}
    </div>
  );
}

function LaunchPanel({
  kind,
  disabled,
  onLaunch,
  children,
}: {
  kind: LaunchKind;
  disabled: boolean;
  onLaunch: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("agents");
  const Icon =
    kind === "synthesis"
      ? Bot
      : kind === "curator"
        ? Lightbulb
        : kind === "connector"
          ? Rows3
          : kind === "staleness"
            ? AlertTriangle
            : Volume2;
  return (
    <div className="flex min-h-40 flex-col gap-3 rounded border border-border p-3">
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t(`launch.${kind}.name`)}</h2>
      </div>
      <div className="min-h-8 flex-1">{children}</div>
      <button
        type="button"
        onClick={onLaunch}
        disabled={disabled}
        className="app-btn-primary h-8 rounded px-3 text-xs"
      >
        <Play aria-hidden className="h-3.5 w-3.5" />
        {t("launch.run")}
      </button>
    </div>
  );
}

function RunsTable({
  rows,
  formatDate,
  empty,
  onSelectRun,
}: {
  rows: Plan8AgentRun[];
  formatDate: (value: string) => string;
  empty: string;
  onSelectRun: (runId: string) => void;
}) {
  const t = useTranslations("agents");
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{t("sections.runs")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("tables.agent")}</th>
              <th className="pb-2 text-left">{t("tables.status")}</th>
              <th className="pb-2 text-left">{t("tables.started")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.runId} className="border-t border-border">
                <td className="py-2">
                  <button
                    type="button"
                    aria-label={row.runId}
                    onClick={() => onSelectRun(row.runId)}
                    className="inline-flex flex-col items-start gap-0.5 text-left hover:text-primary"
                  >
                    <span>{t(`launch.${row.agentName}.name`)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {row.runId}
                    </span>
                  </button>
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {t.has(`status.${row.status}`)
                    ? t(`status.${row.status}`)
                    : row.status}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {formatDate(row.startedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SuggestionsTable({
  rows,
  formatDate,
  empty,
  locale,
  projectId,
  workspaceSlug,
}: {
  rows: Plan8Suggestion[];
  formatDate: (value: string) => string;
  empty: string;
  locale: string;
  projectId: string;
  workspaceSlug: string | null;
}) {
  const t = useTranslations("agents");
  return (
    <section id="plan8-suggestions">
      <h2 className="mb-3 text-lg font-semibold">
        {t("sections.suggestions")}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("tables.type")}</th>
              <th className="pb-2 text-left">{t("tables.detail")}</th>
              <th className="pb-2 text-left">{t("tables.created")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2">{t(`suggestionTypes.${row.type}`)}</td>
                <td className="max-w-72 truncate py-2 text-xs text-muted-foreground">
                  <OutputDetail
                    payload={row.payload}
                    fallback={formatPayload(row.payload) || t("empty.payload")}
                    locale={locale}
                    projectId={projectId}
                    workspaceSlug={workspaceSlug}
                  />
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {formatDate(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function StaleAlertsTable({
  rows,
  formatDate,
  empty,
  locale,
  projectId,
  workspaceSlug,
}: {
  rows: Plan8StaleAlert[];
  formatDate: (value: string) => string;
  empty: string;
  locale: string;
  projectId: string;
  workspaceSlug: string | null;
}) {
  const t = useTranslations("agents");
  return (
    <section id="plan8-stale-alerts">
      <h2 className="mb-3 text-lg font-semibold">
        {t("sections.staleAlerts")}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("tables.note")}</th>
              <th className="pb-2 text-left">{t("tables.score")}</th>
              <th className="pb-2 text-left">{t("tables.detected")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2">
                  <NoteLink
                    noteId={row.noteId}
                    title={row.noteTitle}
                    locale={locale}
                    projectId={projectId}
                    workspaceSlug={workspaceSlug}
                  />
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {Math.round(row.stalenessScore * 100)}
                  {t("scoreSuffix")}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {formatDate(row.detectedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AudioFilesList({
  rows,
  formatDate,
  empty,
  locale,
  projectId,
  workspaceSlug,
}: {
  rows: Plan8AudioFile[];
  formatDate: (value: string) => string;
  empty: string;
  locale: string;
  projectId: string;
  workspaceSlug: string | null;
}) {
  const t = useTranslations("agents");
  return (
    <section id="plan8-audio-files">
      <h2 className="mb-3 text-lg font-semibold">
        {t("sections.audioFiles")}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-2 rounded border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileAudio
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <NoteLink
                    noteId={row.noteId}
                    title={row.noteTitle}
                    locale={locale}
                    projectId={projectId}
                    workspaceSlug={workspaceSlug}
                    className="truncate text-sm font-medium"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDuration(row.durationSec) ?? formatDate(row.createdAt)}
                </span>
              </div>
              <audio
                controls
                preload="none"
                src={row.urlPath}
                aria-label={t("audio.aria", { title: row.noteTitle })}
                className="h-9 w-full"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NoteLink({
  noteId,
  title,
  locale,
  projectId,
  workspaceSlug,
  className,
}: {
  noteId: string;
  title: string;
  locale: string;
  projectId: string;
  workspaceSlug: string | null;
  className?: string;
}) {
  if (!workspaceSlug) return <span className={className}>{title}</span>;
  return (
    <a
      href={urls.workspace.projectNote(locale, workspaceSlug, projectId, noteId)}
      className={`inline-flex items-center gap-1 hover:text-primary ${className ?? ""}`}
    >
      <span className="truncate">{title}</span>
      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
    </a>
  );
}

function OutputDetail({
  payload,
  fallback,
  locale,
  projectId,
  workspaceSlug,
}: {
  payload: Record<string, unknown>;
  fallback: string;
  locale: string;
  projectId: string;
  workspaceSlug: string | null;
}) {
  const noteId = typeof payload.noteId === "string" ? payload.noteId : null;
  const title = typeof payload.title === "string" ? payload.title : fallback;
  if (!noteId || !workspaceSlug) return <>{fallback}</>;
  return (
    <NoteLink
      noteId={noteId}
      title={title}
      locale={locale}
      projectId={projectId}
      workspaceSlug={workspaceSlug}
    />
  );
}

function RunDetailSheet({
  run,
  open,
  onOpenChange,
  formatDate,
  onRetry,
  retryDisabled,
}: {
  run: Plan8AgentRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatDate: (value: string) => string;
  onRetry: (agentName: Plan8AgentName) => void;
  retryDisabled: boolean;
}) {
  const t = useTranslations("agents");
  if (!run) return null;
  const terminal = isRunTerminal(run.status);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t("detail.title", { agent: t(`launch.${run.agentName}.name`) })}
          </SheetTitle>
          <SheetDescription>
            {terminal ? t("detail.pollingTerminal") : t("detail.pollingLive")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-auto px-4">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("detail.runId")}</dt>
            <dd className="break-all font-mono text-xs">{run.runId}</dd>
            <dt className="text-muted-foreground">{t("detail.workflowId")}</dt>
            <dd className="break-all font-mono text-xs">{run.workflowId}</dd>
            <dt className="text-muted-foreground">{t("tables.status")}</dt>
            <dd>
              {t.has(`status.${run.status}`)
                ? t(`status.${run.status}`)
                : run.status}
            </dd>
            <dt className="text-muted-foreground">{t("tables.started")}</dt>
            <dd>{formatDate(run.startedAt)}</dd>
            <dt className="text-muted-foreground">{t("detail.ended")}</dt>
            <dd>{run.endedAt ? formatDate(run.endedAt) : t("detail.notEnded")}</dd>
            <dt className="text-muted-foreground">{t("detail.cost")}</dt>
            <dd>{t("detail.costValue", { value: run.totalCostKrw })}</dd>
          </dl>

          {run.errorMessage ? (
            <div className="rounded border border-destructive/40 p-3 text-sm text-destructive">
              {run.errorMessage}
            </div>
          ) : null}

          <section>
            <h3 className="mb-2 text-sm font-semibold">
              {t("detail.outputs")}
            </h3>
            <div className="grid gap-2">
              <a className="app-btn-secondary h-8 rounded px-3 text-xs" href="#plan8-suggestions">
                {t("detail.links.suggestions")}
              </a>
              <a className="app-btn-secondary h-8 rounded px-3 text-xs" href="#plan8-stale-alerts">
                {t("detail.links.staleAlerts")}
              </a>
              <a className="app-btn-secondary h-8 rounded px-3 text-xs" href="#plan8-audio-files">
                {t("detail.links.audioFiles")}
              </a>
            </div>
          </section>
        </div>

        <SheetFooter>
          <button
            type="button"
            className="app-btn-primary h-9 rounded px-3 text-sm"
            disabled={retryDisabled}
            onClick={() => onRetry(run.agentName)}
          >
            <RotateCw aria-hidden className="h-4 w-4" />
            {t("detail.retry")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-border px-3 text-sm text-muted-foreground"
            disabled
          >
            <Square aria-hidden className="h-4 w-4" />
            {t("detail.cancel")}
          </button>
          <p className="text-xs text-muted-foreground">
            {t("detail.cancelUnavailable")}
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
