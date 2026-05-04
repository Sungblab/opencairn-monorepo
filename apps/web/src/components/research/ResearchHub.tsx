"use client";
import { urls } from "@/lib/urls";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import type { ResearchRunSummary } from "@opencairn/shared";
import { useHydratedNow } from "@/hooks/use-hydrated-now";
import { NewResearchDialog } from "./NewResearchDialog";

export interface ResearchHubProps {
  wsSlug: string;
  workspaceId: string;
  projects: { id: string; name: string }[];
  managedEnabled: boolean;
}

type StatusFilter = "all" | "active" | "awaiting" | "completed" | "terminal";

const FILTER_TABS: readonly StatusFilter[] = [
  "all",
  "active",
  "awaiting",
  "completed",
  "terminal",
];

// Maps a run status onto the high-level filter buckets the mockup carries
// in its tab strip (전체/진행 중/승인 대기/완료/실패·취소). Active spans
// `planning` + `researching` because both are mid-flight from the user's
// vantage; awaiting is `awaiting_approval` only.
function bucketOf(status: ResearchRunSummary["status"]): StatusFilter {
  if (status === "planning" || status === "researching") return "active";
  if (status === "awaiting_approval") return "awaiting";
  if (status === "completed") return "completed";
  return "terminal";
}

// Mockup §screen-research line 970~1046: each row has a status indicator,
// a chip in the title row, a meta line (model · time · hint), and a cost
// column on the right. Keep status indicator + chip variants as a pair.
function StatusIndicator({ status }: { status: ResearchRunSummary["status"] }) {
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
  if (status === "completed") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        className="shrink-0 text-foreground"
        aria-hidden
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: "var(--theme-danger)" }}
      />
    );
  }
  // planning, awaiting_approval, cancelled — quiet steady dot.
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
    />
  );
}

function StatusChip({
  status,
  label,
}: {
  status: ResearchRunSummary["status"];
  label: string;
}) {
  // Filled when actively running, outlined otherwise. Failed/cancelled use
  // an explicit danger tone via inline style because Tailwind doesn't have
  // a `bg-danger` token bound to the theme.
  const baseClass =
    "rounded-[var(--radius-chip)] border px-2 py-0.5 text-[10px] uppercase tracking-wide";
  if (status === "researching") {
    return (
      <span
        className={`${baseClass} border-foreground bg-foreground text-background`}
      >
        {label}
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className={`${baseClass} border-foreground/60 text-foreground`}>
        {label}
      </span>
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <span
        className={baseClass}
        style={{
          color: "var(--theme-danger)",
          borderColor: "color-mix(in srgb, var(--theme-danger) 40%, transparent)",
          backgroundColor:
            "color-mix(in srgb, var(--theme-danger) 12%, transparent)",
        }}
      >
        {label}
      </span>
    );
  }
  return (
    <span className={`${baseClass} border-border text-muted-foreground`}>
      {label}
    </span>
  );
}

export function ResearchHub({
  wsSlug,
  workspaceId,
  projects,
  managedEnabled,
}: ResearchHubProps) {
  const t = useTranslations("research");
  const tHub = useTranslations("research.hub");
  const locale = useLocale();
  const format = useFormatter();
  const now = useHydratedNow();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const { data, isLoading } = useQuery({
    queryKey: researchKeys.list(workspaceId),
    queryFn: () => researchApi.listRuns(workspaceId),
  });

  const runs = data?.runs ?? [];
  const counts = useMemo(() => {
    const acc: Record<StatusFilter, number> = {
      all: runs.length,
      active: 0,
      awaiting: 0,
      completed: 0,
      terminal: 0,
    };
    for (const r of runs) acc[bucketOf(r.status)] += 1;
    return acc;
  }, [runs]);
  const visible =
    filter === "all" ? runs : runs.filter((r) => bucketOf(r.status) === filter);

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      <header className="mb-2 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {tHub("title")}
        </h1>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="app-btn-primary rounded-[var(--radius-control)] px-3 py-1.5 text-sm"
        >
          {tHub("new_button")}
        </button>
      </header>
      <p className="mb-6 text-sm text-muted-foreground">{tHub("subtitle")}</p>

      <div className="mb-5 flex items-center gap-1 border-b border-border text-sm">
        {FILTER_TABS.map((id) => {
          const isActive = filter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={
                isActive
                  ? "-mb-px border-b-2 border-foreground px-3 py-2 font-medium text-foreground"
                  : "app-hover px-3 py-2 text-muted-foreground"
              }
            >
              <span>{tHub(`filter.${id}`)}</span>
              <span
                className={
                  isActive
                    ? "ml-1.5 text-foreground/70"
                    : "ml-1.5 text-muted-foreground"
                }
              >
                {counts[id]}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading ? null : visible.length === 0 ? (
        <div
          className="rounded-[var(--radius-card)] px-4 py-12 text-center text-sm text-muted-foreground"
          style={{ border: "1.5px dashed var(--theme-border)" }}
        >
          {filter === "all" ? tHub("empty") : tHub("empty_filtered")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => {
            const href = urls.workspace.researchRun(locale, wsSlug, r.id);
            const open = () => router.push(href);
            const modelLabel =
              r.model === "deep-research-max-preview-04-2026"
                ? t("model.deep_research_max")
                : t("model.deep_research");
            const billingLabel =
              r.billingPath === "byok"
                ? tHub("billing.byok")
                : tHub("billing.managed");
            const isFailedOrCancelled =
              r.status === "failed" || r.status === "cancelled";
            return (
              <li key={r.id}>
                <div
                  className={`app-hover flex items-center gap-4 rounded-[var(--radius-card)] p-4 ${
                    isFailedOrCancelled ? "opacity-70" : ""
                  }`}
                  style={{ border: "1.5px solid var(--theme-border)" }}
                  role="link"
                  tabIndex={0}
                  aria-label={`${tHub("list.open")}: ${r.topic}`}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  }}
                  data-testid="research-row"
                >
                  <StatusIndicator status={r.status} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {r.topic}
                      </span>
                      <StatusChip
                        status={r.status}
                        label={t(`status.${r.status}`)}
                      />
                    </div>
                    <div
                      className="truncate text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {modelLabel}
                      {now ? ` · ${format.relativeTime(new Date(r.createdAt), now)}` : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    {typeof r.totalCostUsdCents === "number" ? (
                      <div>
                        {tHub("cost.actual", {
                          value: (r.totalCostUsdCents / 100).toFixed(2),
                        })}
                      </div>
                    ) : (
                      <div>—</div>
                    )}
                    <div className="mt-0.5">{billingLabel}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        {tHub("footer_hint")}
      </p>

      <NewResearchDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(runId) => {
          setDialogOpen(false);
          router.push(urls.workspace.researchRun(locale, wsSlug, runId));
        }}
        workspaceId={workspaceId}
        projects={projects}
        managedEnabled={managedEnabled}
      />
    </div>
  );
}
