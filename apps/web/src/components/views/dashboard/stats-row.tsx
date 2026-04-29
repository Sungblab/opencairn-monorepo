"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/lib/api-client";

// Header card row — 4 stats in a single grid. We keep the value formatting
// here (delta line, KRW, BYOK badge) rather than pushing it into i18n strings
// because the surrounding numbers are pure data; i18n owns the labels and the
// formatted templates only.
//
// Mockup §dashboard quick-stats: every card carries a contextual sub-line
// (e.g. "≈ Deep Research 3회" under credits, "Gemini API" under BYOK), so
// the layout stays vertically uniform and the cards read as paired
// label/value/context blocks instead of bare numbers.
export function StatsRow({ wsId }: { wsId: string }) {
  const t = useTranslations("dashboard.stats");
  const { data } = useQuery({
    queryKey: ["dashboard-stats", wsId],
    queryFn: () => dashboardApi.stats(wsId),
  });

  const card = (
    label: string,
    value: React.ReactNode,
    sub?: string | null,
  ) => (
    <div
      className="rounded p-4"
      style={{ border: "1.5px solid var(--theme-border)" }}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{sub ?? " "}</p>
    </div>
  );

  // Skeleton until data lands. 4 grey blocks at the same dimensions so the
  // grid doesn't reflow when the API returns. Height includes the new sub
  // line so the swap is invisible.
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[100px] animate-pulse rounded border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  // Rough credit→Deep Research conversion estimate. Plan 8 spec ballparks
  // a managed Deep Research run at ~₩4,000 of Gemini Flash usage. Keep the
  // divisor here (not in i18n) because it's data, not copy.
  const drEstimate =
    data.credits_krw > 0 ? Math.floor(data.credits_krw / 4000) : 0;
  const creditsSub =
    drEstimate > 0
      ? t("creditsEstimate", { n: drEstimate })
      : t("creditsEmpty");

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {card(
        t("docs"),
        String(data.docs),
        t("weekDelta", { n: data.docs_week_delta }),
      )}
      {card(
        t("research"),
        <>
          {data.research_in_progress}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {t("researchActiveSuffix")}
          </span>
        </>,
        data.research_in_progress > 0 ? t("researchHint") : null,
      )}
      {card(
        t("credits"),
        t("creditsAmount", { value: data.credits_krw.toLocaleString() }),
        creditsSub,
      )}
      {card(
        t("byok"),
        <span className="flex items-center gap-2">
          {data.byok_connected ? (
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-foreground"
            />
          ) : null}
          {data.byok_connected ? t("connected") : t("disconnected")}
        </span>,
        t("byokProvider"),
      )}
    </div>
  );
}
