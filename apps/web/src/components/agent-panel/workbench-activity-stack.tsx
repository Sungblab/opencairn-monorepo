"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { IngestProgressView } from "@/components/ingest/ingest-progress-view";
import { useIngestStream } from "@/hooks/use-ingest-stream";
import { useIngestStore, type IngestRunState } from "@/stores/ingest-store";

const MAX_VISIBLE_RUNS = 3;

export function WorkbenchActivityStack() {
  const t = useTranslations("agentPanel.activityStack");
  const runsById = useIngestStore((s) => s.runs);
  const runs = useMemo(
    () =>
      Object.values(runsById)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, MAX_VISIBLE_RUNS),
    [runsById],
  );

  if (runs.length === 0) return null;

  return (
    <section
      aria-label={t("title")}
      className="border-b border-border bg-background px-3 py-2"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{t("title")}</h3>
        <span className="rounded-[var(--radius-control)] bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {t("count", { count: runs.length })}
        </span>
      </div>
      <div className="space-y-2">
        {runs.map((run) => (
          <WorkbenchIngestRun key={run.workflowId} run={run} />
        ))}
      </div>
    </section>
  );
}

function WorkbenchIngestRun({ run }: { run: IngestRunState }) {
  const t = useTranslations("agentPanel.activityStack");
  useSafeIngestStream(run.status === "running" ? run.workflowId : null);

  return (
    <article className="rounded-[var(--radius-control)] border border-border bg-muted/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">
          {t("ingest")}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t(`status.${run.status}`)}
        </span>
      </div>
      <IngestProgressView wfid={run.workflowId} mode="dock" />
    </article>
  );
}

function useSafeIngestStream(wfid: string | null): void {
  const canStream = typeof EventSource !== "undefined";
  useIngestStream(canStream ? wfid : null);
}
