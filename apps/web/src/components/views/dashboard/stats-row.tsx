"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/lib/api-client";

// Header card row — 4 stats in a single grid. We keep the value formatting
// here (delta line, KRW, BYOK badge) rather than pushing it into i18n strings
// because the surrounding numbers are pure data; i18n owns the labels and the
// formatted templates only.
export function StatsRow({ wsId }: { wsId: string }) {
  const t = useTranslations("dashboard.stats");
  const { data } = useQuery({
    queryKey: ["dashboard-stats", wsId],
    queryFn: () => dashboardApi.stats(wsId),
  });

  const card = (label: string, value: string, sub?: string) => (
    <div className="rounded border border-border p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );

  // Skeleton until data lands. 4 grey blocks at the same dimensions so the
  // grid doesn't reflow when the API returns.
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[88px] animate-pulse rounded border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {card(
        t("docs"),
        String(data.docs),
        t("weekDelta", { n: data.docs_week_delta }),
      )}
      {card(
        t("research"),
        t("researchInProgress", { n: data.research_in_progress }),
      )}
      {card(
        t("credits"),
        t("creditsAmount", { value: data.credits_krw.toLocaleString() }),
      )}
      {card(t("byok"), data.byok_connected ? t("connected") : t("disconnected"))}
    </div>
  );
}
