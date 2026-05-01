"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import { useResearchStream } from "@/hooks/use-research-stream";
import { ResearchPlanReview } from "./ResearchPlanReview";
import { ResearchProgress } from "./ResearchProgress";
import type { ResearchTurn } from "@opencairn/shared";

export interface ResearchRunViewProps {
  runId: string;
  wsSlug: string;
}

// Picks the freshest approved-or-edited-or-proposed plan text. Mirrors the
// API's approve-resolution rule (apps/api/src/routes/research.ts:441-468)
// so what the user sees matches what `approve` will commit if they click.
function latestPlanText(turns: ResearchTurn[]): string {
  const order: ResearchTurn["kind"][] = [
    "user_edit",
    "plan_proposal",
  ];
  for (const kind of order) {
    const candidates = turns
      .filter((t) => t.kind === kind)
      .sort((a, b) => b.seq - a.seq);
    if (candidates[0]) return candidates[0].content;
  }
  return "";
}

export function ResearchRunView({ runId, wsSlug }: ResearchRunViewProps) {
  const t = useTranslations("research");
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: researchKeys.detail(runId),
    queryFn: () => researchApi.getRun(runId),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 5_000;
      const terminal =
        d.status === "completed" ||
        d.status === "failed" ||
        d.status === "cancelled";
      return terminal ? false : 5_000;
    },
  });

  // SSE invalidates the detail cache on every event. The query refetch ms
  // above is a backstop for missed events / network drops.
  useResearchStream(runId, () => {
    qc.invalidateQueries({ queryKey: researchKeys.detail(runId) });
  });

  const planText = useMemo(
    () => (data ? latestPlanText(data.turns) : ""),
    [data],
  );

  // Auto-redirect on completion. We don't unmount on `useEffect` cleanup
  // (router navigation does that) so the spinner state is fine if the push
  // takes a tick.
  useEffect(() => {
    if (data?.status === "completed" && data.noteId) {
      router.push(urls.workspace.note(locale, wsSlug, data.noteId));
    }
  }, [data?.status, data?.noteId, locale, wsSlug, router]);

  if (isLoading || !data) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("plan_review.loading")}
      </div>
    );
  }

  if (data.status === "failed") {
    const code = data.error?.code ?? "generic_failed";
    const message =
      code === "invalid_byok_key"
        ? t("error.invalid_byok")
        : code === "quota_exceeded"
        ? t("error.quota_exceeded")
        : code === "managed_credits_short"
        ? t("error.managed_credits_short")
        : code === "managed_disabled"
        ? t("error.managed_disabled")
        : t("error.generic_failed");
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-sm">
        <h2 className="mb-2 text-xl font-semibold">
          {t("status.failed")}
        </h2>
        <p>{message}</p>
        {code === "invalid_byok_key" && (
          <Link
            href={`/${locale}/settings/ai`}
            className="text-primary mt-2 inline-block underline"
          >
            {t("error.invalid_byok_cta")}
          </Link>
        )}
        {code === "managed_credits_short" && (
          <Link
            href={urls.settings.billing(locale)}
            className="text-primary mt-2 inline-block underline"
          >
            {t("error.managed_credits_cta")}
          </Link>
        )}
      </div>
    );
  }

  if (data.status === "cancelled") {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("status.cancelled")}
      </div>
    );
  }

  if (data.status === "completed") {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("completed.redirecting")}
      </div>
    );
  }

  if (data.status === "researching") {
    return <ResearchProgress runId={runId} artifacts={data.artifacts} />;
  }

  // planning | awaiting_approval
  return (
    <ResearchPlanReview
      runId={runId}
      planText={planText}
      status={data.status}
    />
  );
}
