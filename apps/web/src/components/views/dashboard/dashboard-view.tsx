"use client";

import { urls } from "@/lib/urls";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { StatsRow } from "./stats-row";
import { ActiveResearchList } from "./active-research-list";
import { RecentDocsGrid } from "./recent-docs-grid";

// Compose-only orchestrator. Keeps the data fetching co-located with each
// card (StatsRow / ActiveResearchList / RecentDocsGrid) so an isolated card
// failure doesn't blank the entire dashboard.
export function DashboardView({
  wsSlug,
  wsId,
}: {
  wsSlug: string;
  wsId: string;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  return (
    <div data-testid="route-dashboard" className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link
          href={urls.workspace.newProject(locale, wsSlug)}
          className="app-btn-primary rounded px-3 py-1.5 text-sm"
        >
          {t("newProject")}
        </Link>
      </header>
      <StatsRow wsId={wsId} />
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {t("sections.activeResearch")}
          </h2>
          <Link
            href={urls.workspace.research(locale, wsSlug)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("sections.viewAll")} →
          </Link>
        </div>
        <ActiveResearchList wsId={wsId} wsSlug={wsSlug} />
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {t("sections.recentDocs")}
          </h2>
        </div>
        <RecentDocsGrid wsId={wsId} wsSlug={wsSlug} />
      </section>
    </div>
  );
}
