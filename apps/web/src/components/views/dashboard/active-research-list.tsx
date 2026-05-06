"use client";

import { urls } from "@/lib/urls";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dashboardApi, type ResearchRunSummary } from "@/lib/api-client";
import { useHydratedNow } from "@/hooks/use-hydrated-now";

// "Active" = anything not yet terminal. Filtering client-side because the
// /api/research/runs endpoint doesn't accept a status filter today; the
// dashboard pulls a small page (limit=20) so this stays cheap.
const ACTIVE_STATUSES = new Set<ResearchRunSummary["status"]>([
  "planning",
  "awaiting_approval",
  "researching",
]);

// Mockup §active-research: pulse-dot when actively researching, plain dot
// otherwise. Translates to a CSS animation for `researching`, a static
// muted dot for the planning/awaiting branches.
function StatusDot({ status }: { status: ResearchRunSummary["status"] }) {
  if (status === "researching") {
    return (
      <span
        aria-hidden
        className="relative flex h-2 w-2 shrink-0 items-center justify-center"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foreground" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
    />
  );
}

export function ActiveResearchList({
  wsId,
  wsSlug,
}: {
  wsId: string;
  wsSlug: string;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const now = useHydratedNow();
  const { data } = useQuery({
    queryKey: ["dashboard-research-runs", wsId],
    queryFn: () => dashboardApi.researchRuns(wsId, 20),
  });

  const active = (data?.runs ?? []).filter((r) => ACTIVE_STATUSES.has(r.status));

  if (!data) return null;
  if (active.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/30 p-4">
        <p className="text-sm font-medium">{t("lists.noResearchTitle")}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("lists.noResearch")}
        </p>
        <Link
          href={urls.workspace.chatScope(locale, wsSlug)}
          className="mt-3 inline-flex min-h-8 items-center rounded border border-border px-3 text-xs font-medium hover:bg-muted"
        >
          {t("lists.askLink")} →
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {active.map((run) => (
        <li
          key={run.id}
          className="flex items-center gap-4 rounded border-2 border-border bg-background p-4 transition-colors hover:border-foreground hover:bg-muted/40"
        >
          <StatusDot status={run.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{run.topic}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {now ? (
                <>
                  {format.relativeTime(new Date(run.createdAt), now)}
                  {" · "}
                </>
              ) : null}
              {t(`statusHint.${run.status}`)}
            </div>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[11px] uppercase tracking-wide ${
              run.status === "researching"
                ? "bg-foreground text-background"
                : "border border-muted-foreground/40 text-muted-foreground"
            }`}
          >
            {t(`statusChip.${run.status}`)}
          </span>
          <Link
            href={urls.workspace.researchRun(locale, wsSlug, run.id)}
            className="app-btn-ghost shrink-0 rounded px-3 py-1 text-xs"
          >
            {t("lists.openLink")} →
          </Link>
        </li>
      ))}
    </ul>
  );
}
