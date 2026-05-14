"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Code2,
  ExternalLink,
  FileUp,
  FolderKanban,
  PenLine,
  Search,
} from "lucide-react";

import { workflowConsoleApi, type WorkflowConsoleRun } from "@/lib/api-client";
import { AgentRunTimeline } from "./agent-run-timeline";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "reverted",
]);

type AgentWorkRole = WorkflowConsoleRun["agentRole"];

const ROLE_ICON = {
  research: Search,
  write: PenLine,
  organize: FolderKanban,
  export: FileUp,
  code: Code2,
  review: ClipboardCheck,
} satisfies Record<AgentWorkRole, typeof Search>;

function isActiveRun(run: WorkflowConsoleRun) {
  return !TERMINAL_STATUSES.has(run.status);
}

function uniqueRoleSteps(runs: WorkflowConsoleRun[]) {
  const seen = new Set<AgentWorkRole>();
  return [...runs]
    .reverse()
    .map((run) => ({
      run,
      role: run.agentRole,
    }))
    .filter((step) => {
      if (seen.has(step.role)) return false;
      seen.add(step.role);
      return true;
    });
}

function timelineRunsForActiveGroup(
  runs: WorkflowConsoleRun[],
  activeRun: WorkflowConsoleRun | null,
) {
  const anchor = activeRun ?? runs[0] ?? null;
  if (!anchor) return [];
  return uniqueRoleSteps(
    runs.filter((run) => run.workGroupId === anchor.workGroupId),
  );
}

export function WorkflowConsoleRuns({
  projectId,
}: {
  projectId: string | null;
}) {
  const t = useTranslations("agentPanel.workflowConsole");
  const query = useQuery({
    queryKey: ["workflow-console-runs", projectId],
    enabled: Boolean(projectId),
    queryFn: () => workflowConsoleApi.list(projectId!, 5),
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((run) => !TERMINAL_STATUSES.has(run.status))
        ? 5000
        : false;
    },
  });

  const runs = query.data?.runs ?? [];
  if (!projectId || (!query.isLoading && !query.isError && runs.length === 0)) {
    return null;
  }

  const activeRun = runs.find(isActiveRun) ?? null;
  const activeQueue = runs.filter(isActiveRun);
  const roleSteps = timelineRunsForActiveGroup(runs, activeRun);

  return (
    <section
      aria-label={t("title")}
      className="border-b border-border px-3 py-2"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
          {t("title")}
        </h2>
        {query.isFetching ? (
          <span className="text-[11px] text-muted-foreground">
            {t("refreshing")}
          </span>
        ) : null}
      </div>

      {query.isError ? (
        <p className="text-xs text-destructive">{t("loadFailed")}</p>
      ) : null}
      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("loading")}</p>
      ) : null}

      {activeRun ? <ActiveRoleBanner run={activeRun} /> : null}
      {activeQueue.length > 1 ? <AgentWorkQueue runs={activeQueue} /> : null}
      {activeQueue.length > 0 ? (
        <AgentRunTimeline
          runs={roleSteps.map((step) => step.run)}
          className="mb-2 rounded border border-border bg-background px-2.5 py-2"
        />
      ) : null}
      {roleSteps.length > 1 ? <RoleHandoffTimeline steps={roleSteps} /> : null}

      {runs.length > 0 ? (
        <div className="space-y-2">
          {runs.map((run) => (
            <WorkflowConsoleRunRow key={run.runId} run={run} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AgentWorkQueue({ runs }: { runs: WorkflowConsoleRun[] }) {
  const t = useTranslations("agentPanel.workflowConsole");
  return (
    <div className="mb-2 rounded border border-border bg-muted/20 px-2.5 py-2">
      <h3 className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
        {t("workQueueTitle")}
      </h3>
      <div className="mt-1.5 space-y-1.5">
        {runs.slice(0, 3).map((run) => {
          const role = run.agentRole;
          const Icon = ROLE_ICON[role];
          return (
            <div
              key={run.runId}
              className="flex min-w-0 items-center justify-between gap-2"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate text-xs font-medium text-foreground">
                  {t("queueItem", {
                    role: t(`role.${role}`),
                    status: t(`status.${run.status}`),
                  })}
                </span>
              </div>
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {run.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoleHandoffTimeline({
  steps,
}: {
  steps: { run: WorkflowConsoleRun; role: AgentWorkRole }[];
}) {
  const t = useTranslations("agentPanel.workflowConsole");
  return (
    <div className="mb-2 rounded border border-border bg-background px-2.5 py-2">
      <h3 className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
        {t("handoffTitle")}
      </h3>
      <ol className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden">
        {steps.map((step, index) => {
          const Icon = ROLE_ICON[step.role];
          return (
            <li
              key={`${step.role}:${step.run.runId}`}
              className="flex min-w-0 shrink items-center gap-1.5"
            >
              {index > 0 ? (
                <span
                  aria-hidden
                  className="h-px w-3 shrink-0 bg-border"
                />
              ) : null}
              <span className="inline-flex min-w-0 items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
                <Icon aria-hidden className="h-3 w-3 shrink-0" />
                <span className="truncate">{t(`role.${step.role}`)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ActiveRoleBanner({ run }: { run: WorkflowConsoleRun }) {
  const t = useTranslations("agentPanel.workflowConsole");
  const role = run.agentRole;
  const Icon = ROLE_ICON[role];
  return (
    <div className="mb-2 rounded border border-primary/30 bg-primary/5 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="min-w-0 truncate text-xs font-medium text-foreground">
          {t("activeRole", {
            role: t(`role.${role}`),
            status: t(`status.${run.status}`),
          })}
        </p>
      </div>
      <p className="mt-1 truncate pl-9 text-[11px] text-muted-foreground">
        {run.title}
      </p>
    </div>
  );
}

function WorkflowConsoleRunRow({ run }: { run: WorkflowConsoleRun }) {
  const t = useTranslations("agentPanel.workflowConsole");
  const role = run.agentRole;
  const Icon = ROLE_ICON[role];
  const progress = useMemo(() => {
    if (!run.progress) return null;
    if (typeof run.progress.percent === "number") return run.progress.percent;
    if (
      typeof run.progress.current === "number" &&
      typeof run.progress.total === "number" &&
      run.progress.total > 0
    ) {
      return Math.min(
        100,
        Math.round((run.progress.current / run.progress.total) * 100),
      );
    }
    return null;
  }, [run.progress]);

  return (
    <article className="rounded border border-border bg-background px-2.5 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Icon aria-hidden className="h-3 w-3 shrink-0" />
            <span className="truncate">{t(`role.${role}`)}</span>
          </div>
          <p className="truncate text-sm font-medium text-foreground">
            {run.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`type.${run.runType}`)} · {t(`status.${run.status}`)}
          </p>
        </div>
        <StatusDot status={run.status} />
      </div>

      {progress != null ? (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("progress", { percent: progress })}
          </p>
        </div>
      ) : null}

      {run.error?.message ? (
        <p className="mt-2 line-clamp-2 text-xs text-destructive">
          {run.error.message}
        </p>
      ) : null}

      {run.outputs.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {run.outputs.slice(0, 3).map((output) =>
            output.url ? (
              <a
                key={output.id}
                href={output.url}
                className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
              >
                <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                <span className="truncate">{output.label}</span>
              </a>
            ) : (
              <span
                key={output.id}
                className="inline-flex max-w-full flex-col rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
              >
                <span className="truncate">{output.label}</span>
                {output.outputType === "log" ? (
                  <LogOutputSummary output={output} />
                ) : null}
                {output.outputType === "preview" ? (
                  <PlanOutputSummary output={output} />
                ) : null}
              </span>
            ),
          )}
        </div>
      ) : null}
    </article>
  );
}

function LogOutputSummary({
  output,
}: {
  output: WorkflowConsoleRun["outputs"][number];
}) {
  const t = useTranslations("agentPanel.workflowConsole");
  const metadata = output.metadata ?? {};
  const packageManager =
    typeof metadata.packageManager === "string"
      ? metadata.packageManager
      : null;
  const exitCode =
    typeof metadata.exitCode === "number" ? metadata.exitCode : null;
  const packages = installedPackageSummary(metadata.installed);
  if (!packageManager && exitCode == null && !packages) return null;
  return (
    <span className="mt-0.5 max-w-full truncate text-[11px]">
      {t("logSummary", {
        packageManager: packageManager ?? "-",
        packages: packages ?? "-",
        exitCode: exitCode ?? -1,
      })}
    </span>
  );
}

function PlanOutputSummary({
  output,
}: {
  output: WorkflowConsoleRun["outputs"][number];
}) {
  const t = useTranslations("agentPanel.workflowConsole");
  const metadata = output.metadata ?? {};
  const staleEvidenceBlockers =
    typeof metadata.staleEvidenceBlockers === "number"
      ? metadata.staleEvidenceBlockers
      : 0;
  const evidenceFreshness = metadata.evidenceFreshness;
  const freshnessRecord =
    evidenceFreshness &&
    typeof evidenceFreshness === "object" &&
    !Array.isArray(evidenceFreshness)
      ? (evidenceFreshness as Record<string, unknown>)
      : {};
  const evidenceIssues = Array.isArray(metadata.evidenceIssues)
    ? metadata.evidenceIssues.filter(isEvidenceIssue)
    : [];
  const staleCount =
    typeof freshnessRecord.stale === "number"
      ? freshnessRecord.stale
      : staleEvidenceBlockers;
  const missingCount =
    typeof freshnessRecord.missing === "number"
      ? freshnessRecord.missing
      : evidenceIssues.filter((issue) => issue.freshnessStatus === "missing")
          .length;
  const issueVerificationStatus = evidenceIssues.find(
    (issue) => typeof issue.verificationStatus === "string",
  )?.verificationStatus;
  const verificationStatus =
    issueVerificationStatus ??
    (typeof metadata.verificationStatus === "string"
      ? metadata.verificationStatus
      : null);
  const issueRecoveryCodes = evidenceIssues
    .map((issue) => issue.recoveryCode)
    .filter((code): code is string => typeof code === "string");
  const recoveryCodes =
    issueRecoveryCodes.length > 0
      ? issueRecoveryCodes
      : Array.isArray(metadata.recoveryCodes)
        ? metadata.recoveryCodes.filter(
            (code): code is string => typeof code === "string",
          )
        : [];
  const issueEvidenceRefs = evidenceIssues.flatMap((issue) => issue.refs);
  const staleEvidenceRefs =
    issueEvidenceRefs.length > 0
      ? issueEvidenceRefs
          .map(evidenceRefLabel)
          .filter((label): label is string => Boolean(label))
          .slice(0, 2)
      : Array.isArray(metadata.staleEvidenceRefs)
        ? metadata.staleEvidenceRefs
            .map(evidenceRefLabel)
            .filter((label): label is string => Boolean(label))
            .slice(0, 2)
        : [];
  if (
    staleCount <= 0 &&
    missingCount <= 0 &&
    staleEvidenceRefs.length === 0 &&
    !verificationStatus &&
    recoveryCodes.length === 0
  )
    return null;
  const verificationStatusLabel = verificationStatus
    ? verificationStatusLabelFor(t, verificationStatus)
    : verificationStatusLabelFor(t, "unknown");
  const recoveryCodeLabel =
    recoveryCodes.length > 0 ? recoveryCodeLabelFor(t, recoveryCodes[0]!) : "-";
  return (
    <span className="mt-0.5 flex max-w-full flex-col gap-0.5 text-[11px]">
      {staleCount > 0 ? (
        <span className="truncate text-amber-700 dark:text-amber-300">
          {t("evidenceSummary", {
            count: staleCount,
            status: t("freshnessStatus.stale"),
          })}
        </span>
      ) : null}
      {missingCount > 0 ? (
        <span className="truncate text-amber-700 dark:text-amber-300">
          {t("evidenceSummary", {
            count: missingCount,
            status: t("freshnessStatus.missing"),
          })}
        </span>
      ) : null}
      {staleEvidenceRefs.length > 0 ? (
        <span className="truncate text-amber-700 dark:text-amber-300">
          {t("staleEvidenceDetail", {
            refs: staleEvidenceRefs.join(", "),
          })}
        </span>
      ) : null}
      {verificationStatus || recoveryCodes.length > 0 ? (
        <span className="truncate">
          {t("verificationSummary", {
            status: verificationStatusLabel,
            code: recoveryCodeLabel,
          })}
        </span>
      ) : null}
    </span>
  );
}

type EvidenceIssue = {
  freshnessStatus?: string;
  recoveryCode?: string;
  verificationStatus?: string;
  refs: unknown[];
};

function isEvidenceIssue(value: unknown): value is EvidenceIssue {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).refs),
  );
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
  if (chunkId && noteId)
    return `note ${noteId}/chunk ${chunkId}${version}${hash}`;
  return noteId ? `note ${noteId}${version}${hash}` : null;
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function shortHash(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 12);
}

function verificationStatusLabelFor(
  t: ReturnType<typeof useTranslations>,
  status: string,
): string {
  switch (status) {
    case "pending":
      return t("verificationStatus.pending");
    case "passed":
      return t("verificationStatus.passed");
    case "failed":
      return t("verificationStatus.failed");
    case "blocked":
      return t("verificationStatus.blocked");
    default:
      return t("verificationStatus.unknown");
  }
}

function recoveryCodeLabelFor(
  t: ReturnType<typeof useTranslations>,
  code: string,
): string {
  switch (code) {
    case "stale_context":
      return t("recoveryCode.stale_context");
    case "verification_failed":
      return t("recoveryCode.verification_failed");
    case "missing_source":
      return t("recoveryCode.missing_source");
    case "manual.review":
      return t("recoveryCode.manual_review");
    default:
      return code;
  }
}

function installedPackageSummary(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : null;
      if (!name) return null;
      const version =
        typeof record.version === "string" ? record.version : null;
      return version ? `${name}@${version}` : name;
    })
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : null;
}

function StatusDot({ status }: { status: WorkflowConsoleRun["status"] }) {
  const tone =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed" ||
          status === "cancelled" ||
          status === "expired" ||
          status === "reverted"
        ? "bg-destructive"
        : status === "approval_required" || status === "blocked"
          ? "bg-amber-500"
          : "bg-primary";
  return (
    <span
      aria-hidden
      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone}`}
    />
  );
}
