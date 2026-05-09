"use client";

import { urls } from "@/lib/urls";
import { dashboardApi, type ResearchRunSummary } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  FolderPlus,
  MessageSquare,
  UploadCloud,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

const ACTIVE_STATUSES = new Set<ResearchRunSummary["status"]>([
  "planning",
  "awaiting_approval",
  "researching",
]);

function StepState({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        aria-hidden
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] ${
          done
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/50 text-muted-foreground"
        }`}
      >
        {done ? <Check className="h-2.5 w-2.5" aria-hidden /> : ""}
      </span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </li>
  );
}

function ActionCard({
  href,
  icon: Icon,
  title,
  desc,
  primary = false,
}: {
  href: string;
  icon: typeof UploadCloud;
  title: string;
  desc: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-[116px] flex-col justify-between rounded-[var(--radius-card)] border p-4 transition-colors ${
        primary
          ? "border-foreground bg-foreground text-background hover:bg-foreground/90"
          : "border-border bg-background hover:bg-muted"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <Icon className="h-5 w-5 shrink-0" aria-hidden />
        <ArrowRight
          className="h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p
          className={`mt-1 text-xs leading-5 ${
            primary ? "text-background/75" : "text-muted-foreground"
          }`}
        >
          {desc}
        </p>
      </div>
    </Link>
  );
}

export function GettingStartedPanel({
  wsId,
  wsSlug,
}: {
  wsId: string;
  wsSlug: string;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.gettingStarted");
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", wsId],
    queryFn: () => dashboardApi.stats(wsId),
  });
  const { data: recent } = useQuery({
    queryKey: ["dashboard-recent-notes", wsId, 1],
    queryFn: () => dashboardApi.recentNotes(wsId, 1),
  });
  const { data: research } = useQuery({
    queryKey: ["dashboard-research-runs", wsId],
    queryFn: () => dashboardApi.researchRuns(wsId, 20),
  });

  const hasDocs = Boolean(stats && stats.docs > 0);
  const hasRecentWork = Boolean(recent && recent.notes.length > 0);
  const activeRuns = (research?.runs ?? []).filter((run) =>
    ACTIVE_STATUSES.has(run.status),
  ).length;
  const hasAgentWork = activeRuns > 0;
  const hasSignal = hasDocs || hasRecentWork || hasAgentWork;

  return (
    <section
      aria-labelledby="getting-started-title"
      className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-background"
    >
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="flex flex-col justify-between gap-6 border-b border-border p-5 lg:border-b-0 lg:border-r lg:p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {hasSignal ? t("eyebrowActive") : t("eyebrowEmpty")}
            </p>
            <h2
              id="getting-started-title"
              className="mt-2 max-w-2xl text-2xl font-semibold tracking-normal"
            >
              {hasSignal ? t("titleActive") : t("titleEmpty")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {hasSignal ? t("descActive") : t("descEmpty")}
            </p>
          </div>
          <ol className="grid gap-2 sm:grid-cols-3">
            <StepState done={hasDocs || hasRecentWork} label={t("steps.source")} />
            <StepState done={hasDocs} label={t("steps.project")} />
            <StepState done={hasAgentWork} label={t("steps.agent")} />
          </ol>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <ActionCard
            href={urls.workspace.import(locale, wsSlug)}
            icon={UploadCloud}
            title={t("actions.import.title")}
            desc={t("actions.import.desc")}
            primary={!hasDocs}
          />
          <ActionCard
            href={urls.workspace.newProject(locale, wsSlug)}
            icon={FolderPlus}
            title={t("actions.project.title")}
            desc={t("actions.project.desc")}
          />
          <ActionCard
            href={urls.workspace.chatScope(locale, wsSlug)}
            icon={MessageSquare}
            title={t("actions.ask.title")}
            desc={t("actions.ask.desc")}
          />
        </div>
      </div>
    </section>
  );
}
