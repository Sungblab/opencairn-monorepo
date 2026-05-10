"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  agenticPlansApi,
  importJobsApi,
  workflowConsoleApi,
  type WorkflowConsoleRun,
  type WorkflowConsoleStatus,
} from "@/lib/api-client";

export type WorkflowConsolePanelProps = {
  projectId: string;
  formatDate: (value: string) => string;
};

type AgenticPlanRecoveryStrategy = "retry" | "manual_review" | "cancel";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);
const WORKFLOW_CONSOLE_FILTERS = ["all", "active", "failed", "completed"] as const;

function isWorkflowConsoleRunActive(run: WorkflowConsoleRun): boolean {
  return !TERMINAL_RUN_STATUSES.has(run.status);
}

function workflowConsoleStatusFilter(
  filter: (typeof WORKFLOW_CONSOLE_FILTERS)[number],
): WorkflowConsoleStatus | undefined {
  return filter === "failed" || filter === "completed" ? filter : undefined;
}

export function WorkflowConsolePanel({
  projectId,
  formatDate,
}: WorkflowConsolePanelProps) {
  const [workflowFilter, setWorkflowFilter] = useState<
    (typeof WORKFLOW_CONSOLE_FILTERS)[number]
  >("all");
  const [workflowQuery, setWorkflowQuery] = useState("");
  const workflowConsoleQuery = useQuery({
    queryKey: ["agents-workflow-console-runs", projectId, workflowFilter, workflowQuery],
    queryFn: () =>
      workflowConsoleApi.list(projectId, {
        limit: 25,
        status: workflowConsoleStatusFilter(workflowFilter),
        q: workflowQuery.trim() || undefined,
      }),
  });

  return (
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
