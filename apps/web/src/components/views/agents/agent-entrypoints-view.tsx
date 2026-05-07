"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Check,
  ExternalLink,
  FileAudio,
  Lightbulb,
  Library,
  Play,
  RefreshCw,
  Rows3,
  RotateCw,
  Square,
  Volume2,
  X,
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
  agenticPlansApi,
  plan8AgentsApi,
  importJobsApi,
  workflowConsoleApi,
  type Plan8AgentName,
  type Plan8AgentRun,
  type Plan8AudioFile,
  type Plan8StaleAlert,
  type Plan8Suggestion,
  type WorkflowConsoleRun,
  type WorkflowConsoleStatus,
} from "@/lib/api-client";
import { urls } from "@/lib/urls";

type LaunchKind = Plan8AgentName;
type AgenticPlanRecoveryStrategy = "retry" | "manual_review" | "cancel";

const LAUNCH_ORDER: LaunchKind[] = [
  "librarian",
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

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);
const WORKFLOW_CONSOLE_FILTERS = ["all", "active", "failed", "completed"] as const;

function isRunTerminal(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

function isWorkflowConsoleRunActive(run: WorkflowConsoleRun): boolean {
  return !TERMINAL_RUN_STATUSES.has(run.status);
}

function workflowConsoleStatusFilter(
  filter: (typeof WORKFLOW_CONSOLE_FILTERS)[number],
): WorkflowConsoleStatus | undefined {
  return filter === "failed" || filter === "completed" ? filter : undefined;
}

function workspaceSlugFromPathname(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/workspace\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function currentSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
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
  const [workflowFilter, setWorkflowFilter] = useState<
    (typeof WORKFLOW_CONSOLE_FILTERS)[number]
  >("all");
  const [workflowQuery, setWorkflowQuery] = useState("");
  const workspaceSlug = useMemo(workspaceSlugFromPathname, []);
  const requestedAgent = useMemo(() => currentSearchParam("agent"), []);
  const requestedNoteId = useMemo(() => currentSearchParam("noteId"), []);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => plan8AgentsApi.overview(projectId),
  });
  const workflowConsoleQuery = useQuery({
    queryKey: ["agents-workflow-console-runs", projectId, workflowFilter, workflowQuery],
    queryFn: () =>
      workflowConsoleApi.list(projectId, {
        limit: 25,
        status: workflowConsoleStatusFilter(workflowFilter),
        q: workflowQuery.trim() || undefined,
      }),
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
    if (
      requestedAgent === "narrator" &&
      requestedNoteId &&
      data.launch.notes.some((note) => note.id === requestedNoteId)
    ) {
      setNarratorNoteId(requestedNoteId);
      return;
    }
    if (!narratorNoteId && data.launch.notes[0]) {
      setNarratorNoteId(data.launch.notes[0].id);
    }
  }, [
    connectorConceptId,
    data,
    narratorNoteId,
    requestedAgent,
    requestedNoteId,
    synthesisNoteIds.length,
  ]);

  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const targetId = window.location.hash.replace(/^#/, "");
    if (!targetId) return;
    const schedule =
      window.requestAnimationFrame ??
      ((callback: FrameRequestCallback) => window.setTimeout(callback, 0));
    schedule(() => {
      document.getElementById(targetId)?.scrollIntoView({
        block: "start",
      });
    });
  }, [data]);

  const launch = useMutation({
    mutationFn: async (kind: LaunchKind) => {
      switch (kind) {
        case "librarian":
          return plan8AgentsApi.runLibrarian({ projectId });
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

  const resolveSuggestion = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "accepted" | "rejected";
    }) => plan8AgentsApi.resolveSuggestion(id, status),
    onSuccess: (_result, variables) => {
      toast.success(t(`toast.suggestion.${variables.status}`));
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast.error(t("toast.suggestion.failed"));
    },
  });

  const reviewStaleAlert = useMutation({
    mutationFn: (id: string) => plan8AgentsApi.reviewStaleAlert(id),
    onSuccess: () => {
      toast.success(t("toast.staleAlert.reviewed"));
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast.error(t("toast.staleAlert.failed"));
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
          className="app-btn-ghost inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 text-sm disabled:opacity-50"
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
                          <span className="relative inline-flex h-7 w-7 items-center justify-center">
                            <input
                              type="checkbox"
                              className="peer absolute inset-0 h-7 w-7 cursor-pointer opacity-0"
                              checked={synthesisNoteIds.includes(note.id)}
                              onChange={() => toggleSynthesisNote(note.id)}
                            />
                            <span
                              aria-hidden="true"
                              className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-[var(--radius-control)] border border-border bg-background text-background transition-colors peer-checked:border-foreground peer-checked:bg-foreground"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          </span>
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
                    className="h-8 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-xs"
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
                    className="h-8 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-xs"
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

          <WorkflowConsoleProjectList
            runs={workflowConsoleQuery.data?.runs ?? []}
            filter={workflowFilter}
            loading={workflowConsoleQuery.isLoading}
            error={workflowConsoleQuery.isError}
            formatDate={formatDate}
            onFilterChange={setWorkflowFilter}
            query={workflowQuery}
            onQueryChange={setWorkflowQuery}
          />

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
              disabled={resolveSuggestion.isPending}
              onResolve={(id, status) =>
                resolveSuggestion.mutate({ id, status })
              }
            />
            <StaleAlertsTable
              rows={data.staleAlerts}
              formatDate={formatDate}
              empty={t("empty.staleAlerts")}
              locale={locale}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
              disabled={reviewStaleAlert.isPending}
              onReview={(id) => reviewStaleAlert.mutate(id)}
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

function WorkflowConsoleProjectList({
  runs,
  filter,
  loading,
  error,
  formatDate,
  onFilterChange,
  query,
  onQueryChange,
}: {
  runs: WorkflowConsoleRun[];
  filter: (typeof WORKFLOW_CONSOLE_FILTERS)[number];
  loading: boolean;
  error: boolean;
  formatDate: (value: string) => string;
  onFilterChange: (filter: (typeof WORKFLOW_CONSOLE_FILTERS)[number]) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const t = useTranslations("agents");
  const visibleRuns = runs.filter((run) => {
    if (filter === "all") return true;
    if (filter === "active") return isWorkflowConsoleRunActive(run);
    return run.status === filter;
  });

  return (
    <section id="workflow-console">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("workflowConsole.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("workflowConsole.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("workflowConsole.searchPlaceholder")}
            className="h-8 w-44 rounded-[var(--radius-control)] border border-border bg-background px-2 text-xs"
          />
          <div className="inline-flex rounded-[var(--radius-control)] border border-border p-0.5">
            {WORKFLOW_CONSOLE_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onFilterChange(item)}
                className={`h-7 rounded-[var(--radius-control)] px-2 text-xs ${
                  filter === item
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`workflowConsole.filters.${item}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          {t("workflowConsole.loading")}
        </p>
      ) : error ? (
        <p className="text-sm text-destructive">
          {t("workflowConsole.error")}
        </p>
      ) : visibleRuns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("workflowConsole.empty")}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("workflowConsole.columns.run")}</th>
              <th className="pb-2 text-left">{t("workflowConsole.columns.status")}</th>
              <th className="pb-2 text-left">{t("workflowConsole.columns.updated")}</th>
              <th className="pb-2 text-left">{t("workflowConsole.columns.detail")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRuns.map((run) => (
              <tr key={run.runId} className="border-t border-border">
                <td className="py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{run.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {t(`workflowConsole.type.${run.runType}`)}
                    </div>
                  </div>
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {t(`workflowConsole.status.${run.status}`)}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {formatDate(run.updatedAt)}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  <WorkflowConsoleRunDetail run={run} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function WorkflowConsoleRunDetail({ run }: { run: WorkflowConsoleRun }) {
  const t = useTranslations("agents");
  const queryClient = useQueryClient();
  const invalidateWorkflowConsole = () => {
    if (!run.projectId) return;
    void queryClient.invalidateQueries({
      queryKey: ["agents-workflow-console-runs", run.projectId],
    });
  };
  const retryImport = useMutation({
    mutationFn: () => importJobsApi.retry(run.sourceId),
    onSuccess: () => {
      toast.success(t("workflowConsole.importActions.retrySuccess"));
      invalidateWorkflowConsole();
    },
    onError: () => {
      toast.error(t("workflowConsole.importActions.retryError"));
    },
  });
  const cancelImport = useMutation({
    mutationFn: () => importJobsApi.cancel(run.sourceId),
    onSuccess: () => {
      toast.success(t("workflowConsole.importActions.cancelSuccess"));
      invalidateWorkflowConsole();
    },
    onError: () => {
      toast.error(t("workflowConsole.importActions.cancelError"));
    },
  });
  const recoverAgenticPlan = useMutation({
    mutationFn: ({
      policy,
      strategy,
    }: {
      policy: RecoveryPolicy;
      strategy: AgenticPlanRecoveryStrategy;
    }) => {
      if (!run.projectId) throw new Error("missing_project");
      return agenticPlansApi.recover(run.projectId, run.sourceId, {
        stepId: policy.stepId,
        strategy,
      });
    },
    onSuccess: (_result, variables) => {
      toast.success(
        t("workflowConsole.recovery.success", {
          strategy: t(`workflowConsole.recovery.strategy.${variables.strategy}`),
        }),
      );
      invalidateWorkflowConsole();
    },
    onError: () => {
      toast.error(t("workflowConsole.recovery.error"));
    },
  });
  const canRetryImport =
    run.runType === "import" &&
    run.status === "failed" &&
    run.error?.retryable !== false;
  const canCancelImport =
    run.runType === "import" && (run.status === "queued" || run.status === "running");
  const recoveryPolicies = recoveryPoliciesForRun(run);

  const actionButtons =
    canRetryImport || canCancelImport ? (
      <div className="mt-1 flex flex-wrap gap-1">
        {canRetryImport ? (
          <button
            type="button"
            aria-label={t("workflowConsole.importActions.retryAria")}
            onClick={() => retryImport.mutate()}
            disabled={retryImport.isPending}
            className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
          >
            <RotateCw aria-hidden className="h-3 w-3" />
            {t("workflowConsole.importActions.retry")}
          </button>
        ) : null}
        {canCancelImport ? (
          <button
            type="button"
            aria-label={t("workflowConsole.importActions.cancelAria")}
            onClick={() => cancelImport.mutate()}
            disabled={cancelImport.isPending}
            className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
          >
            <X aria-hidden className="h-3 w-3" />
            {t("workflowConsole.importActions.cancel")}
          </button>
        ) : null}
      </div>
    ) : null;
  const recoveryDetail =
    recoveryPolicies.length > 0 ? (
      <WorkflowConsoleRecoveryDetail
        policies={recoveryPolicies}
        busy={recoverAgenticPlan.isPending}
        onRecover={(policy, strategy) => {
          if (
            strategy === "cancel" &&
            typeof window !== "undefined" &&
            !window.confirm(t("workflowConsole.recovery.cancelConfirm"))
          ) {
            return;
          }
          recoverAgenticPlan.mutate({ policy, strategy });
        }}
      />
    ) : null;
  const previewRecoverySummary =
    run.outputs.length > 0 ? (
      <div className="mt-1 grid gap-1">
        {run.outputs
          .filter((output) => output.outputType === "preview")
          .map((output) => (
            <WorkflowConsolePreviewRecoverySummary
              key={output.id}
              output={output}
            />
          ))}
      </div>
    ) : null;

  if (run.error?.message) {
    return (
      <div className="min-w-0">
        <span className="text-destructive">{run.error.message}</span>
        {previewRecoverySummary}
        {recoveryDetail}
        {actionButtons}
      </div>
    );
  }
  if (run.outputs.length === 0) {
    return (
      <div className="min-w-0">
        <span className="break-all font-mono text-[11px]">{run.runId}</span>
        {previewRecoverySummary}
        {recoveryDetail}
        {actionButtons}
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      {run.outputs.map((output) => (
        <div key={output.id} className="min-w-0">
          {output.url ? (
            <a href={output.url} className="truncate text-foreground hover:text-primary">
              {output.label}
            </a>
          ) : (
            <div className="truncate text-foreground">{output.label}</div>
          )}
          {output.outputType === "log" ? (
            <WorkflowConsoleLogOutputDetail output={output} />
          ) : null}
          {output.outputType === "preview" ? (
            <WorkflowConsolePreviewRecoverySummary output={output} />
          ) : null}
        </div>
      ))}
      {recoveryDetail}
      {actionButtons}
    </div>
  );
}

type RecoveryPolicy = {
  stepId: string;
  stepTitle: string;
  recoveryCode?: string;
  allowedStrategies: AgenticPlanRecoveryStrategy[];
};

function WorkflowConsoleRecoveryDetail({
  policies,
  busy,
  onRecover,
}: {
  policies: RecoveryPolicy[];
  busy: boolean;
  onRecover: (
    policy: RecoveryPolicy,
    strategy: AgenticPlanRecoveryStrategy,
  ) => void;
}) {
  const t = useTranslations("agents");
  return (
    <div className="mt-1 grid gap-1">
      <div className="text-[11px] font-medium text-foreground">
        {t("workflowConsole.recovery.title")}
      </div>
      {policies.slice(0, 2).map((policy) => (
        <div key={policy.stepId} className="grid gap-1">
          <div className="max-w-md truncate text-[11px] text-muted-foreground">
            {t("workflowConsole.recovery.step", {
              title: policy.stepTitle,
              code: policy.recoveryCode
                ? recoveryCodeLabelFor(t, policy.recoveryCode)
                : "-",
            })}
          </div>
          <div className="flex flex-wrap gap-1">
            {policy.allowedStrategies.map((strategy) => (
              <button
                key={`${policy.stepId}:${strategy}`}
                type="button"
                aria-label={t(`workflowConsole.recovery.aria.${strategy}`)}
                onClick={() => onRecover(policy, strategy)}
                disabled={busy}
                className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
              >
                {strategyIcon(strategy)}
                {t(`workflowConsole.recovery.strategy.${strategy}`)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkflowConsolePreviewRecoverySummary({
  output,
}: {
  output: WorkflowConsoleRun["outputs"][number];
}) {
  const t = useTranslations("agents");
  const issues = evidenceIssuesForOutput(output);
  if (issues.length === 0) return null;
  return (
    <div className="mt-0.5 grid max-w-md gap-0.5 text-[11px] text-amber-700 dark:text-amber-300">
      {issues.slice(0, 2).map((issue, index) => (
        <div key={`${issue.stepTitle}:${index}`} className="truncate">
          {t("workflowConsole.recovery.issue", {
            title: issue.stepTitle,
            freshness: freshnessStatusLabelFor(t, issue.freshnessStatus),
            refs: issue.refs.length > 0 ? issue.refs.join(", ") : "-",
          })}
        </div>
      ))}
    </div>
  );
}

function strategyIcon(strategy: AgenticPlanRecoveryStrategy) {
  if (strategy === "cancel") return <X aria-hidden className="h-3 w-3" />;
  if (strategy === "manual_review") {
    return <AlertTriangle aria-hidden className="h-3 w-3" />;
  }
  return <RotateCw aria-hidden className="h-3 w-3" />;
}

function recoveryPoliciesForRun(run: WorkflowConsoleRun): RecoveryPolicy[] {
  if (run.runType !== "agentic_plan" || !run.projectId) return [];
  return run.outputs.flatMap((output) => {
    const metadata = output.metadata ?? {};
    const policies = Array.isArray(metadata.recoveryPolicies)
      ? metadata.recoveryPolicies
      : [];
    return policies
      .map(recoveryPolicyFromUnknown)
      .filter((policy): policy is RecoveryPolicy => Boolean(policy));
  });
}

function recoveryPolicyFromUnknown(value: unknown): RecoveryPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const stepId = typeof record.stepId === "string" ? record.stepId : null;
  const stepTitle =
    typeof record.stepTitle === "string" ? record.stepTitle : null;
  const allowedStrategies = Array.isArray(record.allowedStrategies)
    ? record.allowedStrategies.filter(isRecoveryStrategy)
    : [];
  if (!stepId || !stepTitle || allowedStrategies.length === 0) return null;
  return {
    stepId,
    stepTitle,
    recoveryCode:
      typeof record.recoveryCode === "string" ? record.recoveryCode : undefined,
    allowedStrategies,
  };
}

function isRecoveryStrategy(value: unknown): value is AgenticPlanRecoveryStrategy {
  return value === "retry" || value === "manual_review" || value === "cancel";
}

type EvidenceIssueDetail = {
  stepTitle: string;
  freshnessStatus: string;
  refs: string[];
};

function evidenceIssuesForOutput(
  output: WorkflowConsoleRun["outputs"][number],
): EvidenceIssueDetail[] {
  const metadata = output.metadata ?? {};
  const issues = Array.isArray(metadata.evidenceIssues)
    ? metadata.evidenceIssues
    : [];
  return issues
    .map((issue) => {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
        return null;
      }
      const record = issue as Record<string, unknown>;
      const stepTitle =
        typeof record.stepTitle === "string" ? record.stepTitle : null;
      const freshnessStatus =
        typeof record.freshnessStatus === "string"
          ? record.freshnessStatus
          : "unknown";
      const refs = Array.isArray(record.refs)
        ? record.refs
            .map(evidenceRefLabel)
            .filter((label): label is string => Boolean(label))
        : [];
      return stepTitle ? { stepTitle, freshnessStatus, refs } : null;
    })
    .filter((issue): issue is EvidenceIssueDetail => Boolean(issue));
}

function freshnessStatusLabelFor(
  t: ReturnType<typeof useTranslations>,
  status: string,
): string {
  switch (status) {
    case "fresh":
      return t("workflowConsole.freshnessStatus.fresh");
    case "stale":
      return t("workflowConsole.freshnessStatus.stale");
    case "missing":
      return t("workflowConsole.freshnessStatus.missing");
    default:
      return t("workflowConsole.freshnessStatus.unknown");
  }
}

function recoveryCodeLabelFor(
  t: ReturnType<typeof useTranslations>,
  code: string,
): string {
  switch (code) {
    case "stale_context":
      return t("workflowConsole.recoveryCode.stale_context");
    case "verification_failed":
      return t("workflowConsole.recoveryCode.verification_failed");
    case "missing_source":
      return t("workflowConsole.recoveryCode.missing_source");
    case "manual.review":
      return t("workflowConsole.recoveryCode.manual_review");
    default:
      return code;
  }
}

function evidenceRefLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const noteId =
    typeof record.noteId === "string" ? shortId(record.noteId) : null;
  const jobId = typeof record.jobId === "string" ? shortId(record.jobId) : null;
  const chunkId =
    typeof record.chunkId === "string" ? shortId(record.chunkId) : null;
  const version =
    typeof record.analysisVersion === "number"
      ? ` v${record.analysisVersion}`
      : "";
  const hash =
    typeof record.contentHash === "string" && record.contentHash.length > 0
      ? ` ${shortHash(record.contentHash)}`
      : "";
  if (jobId && noteId) return `note ${noteId}/job ${jobId}${version}${hash}`;
  if (chunkId && noteId) {
    return `note ${noteId}/chunk ${chunkId}${version}${hash}`;
  }
  return noteId ? `note ${noteId}${version}${hash}` : null;
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function shortHash(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 12);
}

function WorkflowConsoleLogOutputDetail({
  output,
}: {
  output: WorkflowConsoleRun["outputs"][number];
}) {
  const metadata = output.metadata ?? {};
  const packageManager =
    typeof metadata.packageManager === "string" ? metadata.packageManager : null;
  const packages = installedPackageSummary(metadata.installed);
  const exitCode =
    typeof metadata.exitCode === "number" ? String(metadata.exitCode) : null;
  const rows = [
    packageManager,
    packages,
    exitCode,
  ].filter((value): value is string => Boolean(value));
  if (rows.length === 0) return null;
  return (
    <div className="mt-0.5 flex max-w-md flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
      {rows.map((value) => (
        <span key={value} className="truncate">
          {value}
        </span>
      ))}
    </div>
  );
}

function installedPackageSummary(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : null;
      if (!name) return null;
      const version = typeof record.version === "string" ? record.version : null;
      return version ? `${name}@${version}` : name;
    })
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : null;
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
    kind === "librarian"
      ? Library
      : kind === "synthesis"
      ? Bot
      : kind === "curator"
        ? Lightbulb
        : kind === "connector"
          ? Rows3
          : kind === "staleness"
            ? AlertTriangle
            : Volume2;
  return (
    <div className="flex min-h-40 flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t(`launch.${kind}.name`)}</h2>
      </div>
      <div className="min-h-8 flex-1">{children}</div>
      <button
        type="button"
        onClick={onLaunch}
        disabled={disabled}
        className="app-btn-primary h-8 rounded-[var(--radius-control)] px-3 text-xs"
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
  disabled,
  onResolve,
}: {
  rows: Plan8Suggestion[];
  formatDate: (value: string) => string;
  empty: string;
  locale: string;
  projectId: string;
  workspaceSlug: string | null;
  disabled: boolean;
  onResolve: (id: string, status: "accepted" | "rejected") => void;
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
              <th className="pb-2 text-right">{t("tables.actions")}</th>
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
                <td className="py-2">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onResolve(row.id, "accepted")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-accent disabled:opacity-50"
                      aria-label={t("suggestions.accept")}
                      title={t("suggestions.accept")}
                    >
                      <Check aria-hidden className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onResolve(row.id, "rejected")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-accent disabled:opacity-50"
                      aria-label={t("suggestions.reject")}
                      title={t("suggestions.reject")}
                    >
                      <X aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </div>
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
  disabled,
  onReview,
}: {
  rows: Plan8StaleAlert[];
  formatDate: (value: string) => string;
  empty: string;
  locale: string;
  projectId: string;
  workspaceSlug: string | null;
  disabled: boolean;
  onReview: (id: string) => void;
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
              <th className="pb-2 text-right">{t("tables.actions")}</th>
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
                <td className="py-2 text-right">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onReview(row.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-accent disabled:opacity-50"
                    aria-label={t("staleAlerts.review")}
                    title={t("staleAlerts.review")}
                  >
                    <Check aria-hidden className="h-3.5 w-3.5" />
                  </button>
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
              className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3"
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
