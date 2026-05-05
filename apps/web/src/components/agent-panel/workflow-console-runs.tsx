"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import {
  workflowConsoleApi,
  type WorkflowConsoleRun,
} from "@/lib/api-client";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "reverted",
]);

export function WorkflowConsoleRuns({ projectId }: { projectId: string | null }) {
  const t = useTranslations("agentPanel.workflowConsole");
  const query = useQuery({
    queryKey: ["workflow-console-runs", projectId],
    enabled: Boolean(projectId),
    queryFn: () => workflowConsoleApi.list(projectId!, 5),
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((run) => !TERMINAL_STATUSES.has(run.status)) ? 5000 : false;
    },
  });

  const runs = query.data?.runs ?? [];
  if (!projectId || (!query.isLoading && !query.isError && runs.length === 0)) {
    return null;
  }

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

function WorkflowConsoleRunRow({ run }: { run: WorkflowConsoleRun }) {
  const t = useTranslations("agentPanel.workflowConsole");
  const progress = useMemo(() => {
    if (!run.progress) return null;
    if (typeof run.progress.percent === "number") return run.progress.percent;
    if (
      typeof run.progress.current === "number" &&
      typeof run.progress.total === "number" &&
      run.progress.total > 0
    ) {
      return Math.min(100, Math.round((run.progress.current / run.progress.total) * 100));
    }
    return null;
  }, [run.progress]);

  return (
    <article className="rounded border border-border bg-background px-2.5 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
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
          {run.outputs.slice(0, 3).map((output) => (
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
              </span>
            )
          ))}
        </div>
      ) : null}
    </article>
  );
}

function LogOutputSummary({ output }: { output: WorkflowConsoleRun["outputs"][number] }) {
  const t = useTranslations("agentPanel.workflowConsole");
  const metadata = output.metadata ?? {};
  const packageManager =
    typeof metadata.packageManager === "string" ? metadata.packageManager : null;
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

function StatusDot({ status }: { status: WorkflowConsoleRun["status"] }) {
  const tone =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed" || status === "cancelled" || status === "reverted"
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
