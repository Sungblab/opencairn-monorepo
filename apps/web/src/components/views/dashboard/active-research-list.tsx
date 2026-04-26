"use client";

import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dashboardApi, type ResearchRunSummary } from "@/lib/api-client";

// "Active" = anything not yet terminal. Filtering client-side because the
// /api/research/runs endpoint doesn't accept a status filter today; the
// dashboard pulls a small page (limit=20) so this stays cheap.
const ACTIVE_STATUSES = new Set<ResearchRunSummary["status"]>([
  "planning",
  "awaiting_approval",
  "researching",
]);

export function ActiveResearchList({
  wsId,
  wsSlug,
}: {
  wsId: string;
  wsSlug: string;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const { data } = useQuery({
    queryKey: ["dashboard-research-runs", wsId],
    queryFn: () => dashboardApi.researchRuns(wsId, 20),
  });

  const active = (data?.runs ?? []).filter((r) => ACTIVE_STATUSES.has(r.status));

  if (!data) return null;
  if (active.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("lists.noResearch")}</p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {active.map((run) => (
        <li key={run.id}>
          <Link
            href={`/${locale}/app/w/${wsSlug}/research/${run.id}`}
            className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            <span className="truncate">{run.topic}</span>
            <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">
              {run.status}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
