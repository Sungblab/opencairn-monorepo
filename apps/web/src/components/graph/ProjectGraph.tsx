"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";
import {
  plan8AgentsApi,
  projectsApi,
  type ProjectWikiIndex,
  type ProjectWikiIndexHealthIssueKind,
  type ProjectWikiIndexHealthStatus,
} from "@/lib/api-client";
import { ViewSwitcher } from "./ViewSwitcher";
import { ViewRenderer } from "./ViewRenderer";
import type { VisualizeDialogProps } from "./ai/VisualizeDialog";

export interface ProjectGraphProps {
  projectId: string;
}

const VIEW_BY_KEY: Record<string, ViewType> = {
  "1": "graph",
  "2": "mindmap",
  "3": "cards",
  "4": "timeline",
  "5": "board",
};

const LazyVisualizeDialog = dynamic<VisualizeDialogProps>(
  () => import("./ai/VisualizeDialog").then((mod) => mod.VisualizeDialog),
  { ssr: false },
);

export function ProjectGraph({ projectId }: ProjectGraphProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("graph");

  const { data: wikiIndex } = useQuery({
    queryKey: ["project-wiki-index", projectId],
    queryFn: () => projectsApi.wikiIndex(projectId),
    staleTime: 30_000,
  });
  const { data: projectPermissions } = useQuery({
    queryKey: ["project-permissions", projectId],
    queryFn: () => projectsApi.permissions(projectId),
    staleTime: 30_000,
  });
  const refreshWikiIndexMutation = useMutation({
    mutationFn: () => projectsApi.refreshWikiIndex(projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["project-wiki-index", projectId],
      });
    },
  });
  const runLibrarianMutation = useMutation({
    mutationFn: () => plan8AgentsApi.runLibrarian({ projectId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["plan8-agents", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["project-wiki-index", projectId],
        }),
      ]);
    },
  });

  const canRepairWikiIndex =
    projectPermissions?.role === "owner" ||
    projectPermissions?.role === "admin" ||
    projectPermissions?.role === "editor";
  const showRefresh =
    Boolean(wikiIndex) &&
    wikiIndex?.health.status !== "healthy" &&
    Boolean(canRepairWikiIndex);
  const showRunLibrarian =
    Boolean(wikiIndex) &&
    Boolean(canRepairWikiIndex) &&
    hasLibrarianRepairIssue(wikiIndex);
  const healthIssueSummary = formatWikiHealthIssueSummary(wikiIndex, (kind, count) =>
    t(`health.issues.${kind}`, { count }),
  );
  const recentWikiActivitySummary = formatRecentWikiActivitySummary(
    wikiIndex,
    t("health.recentActivity"),
  );
  const healthSummary =
    [healthIssueSummary, recentWikiActivitySummary].filter(Boolean).join(" · ") ||
    null;

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Check both event.target and the active element so we still ignore
      // keys when an input is focused even if the event was dispatched on
      // the window (real browsers route to the focused element; tests don't).
      const candidates: Array<HTMLElement | null> = [
        e.target as HTMLElement | null,
        typeof document !== "undefined"
          ? (document.activeElement as HTMLElement | null)
          : null,
      ];
      for (const el of candidates) {
        const tag = el?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || el?.isContentEditable) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const view = VIEW_BY_KEY[e.key];
      if (!view) return;
      const next = new URLSearchParams(params.toString());
      next.set("view", view);
      if (view !== "mindmap" && view !== "board") next.delete("root");
      router.replace(`?${next.toString()}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, params]);

  return (
    <div
      data-testid="project-graph-viewer"
      data-hydrated={hydrated ? "true" : "false"}
      className="flex h-full flex-col"
    >
      <ViewSwitcher onAiClick={() => setAiOpen(true)} />
      {wikiIndex ? (
        <ProjectGraphWikiHealth
          label={t("health.label")}
          status={t(`health.status.${wikiIndex.health.status}`)}
          issueSummary={healthSummary}
          tone={wikiIndex.health.status}
          showRefresh={showRefresh}
          refreshLabel={t("health.refresh")}
          refreshingLabel={t("health.refreshing")}
          refreshPending={refreshWikiIndexMutation.isPending}
          onRefresh={() => refreshWikiIndexMutation.mutate()}
          showRunLibrarian={showRunLibrarian}
          runLibrarianLabel={t("health.runLibrarian")}
          runningLibrarianLabel={t("health.runningLibrarian")}
          runLibrarianPending={runLibrarianMutation.isPending}
          onRunLibrarian={() => runLibrarianMutation.mutate()}
        />
      ) : null}
      <div className="min-h-0 flex-1">
        <ViewRenderer projectId={projectId} />
      </div>
      {aiOpen ? (
        <LazyVisualizeDialog
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
}

function ProjectGraphWikiHealth({
  label,
  status,
  issueSummary,
  tone,
  showRefresh,
  refreshLabel,
  refreshingLabel,
  refreshPending,
  onRefresh,
  showRunLibrarian,
  runLibrarianLabel,
  runningLibrarianLabel,
  runLibrarianPending,
  onRunLibrarian,
}: {
  label: string;
  status: string;
  issueSummary: string | null;
  tone: ProjectWikiIndexHealthStatus;
  showRefresh: boolean;
  refreshLabel: string;
  refreshingLabel: string;
  refreshPending: boolean;
  onRefresh: () => void;
  showRunLibrarian: boolean;
  runLibrarianLabel: string;
  runningLibrarianLabel: string;
  runLibrarianPending: boolean;
  onRunLibrarian: () => void;
}) {
  return (
    <div
      data-testid="project-graph-wiki-health"
      className={`flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-xs font-medium ${getWikiHealthClassName(
        tone,
      )}`}
    >
      <span className="shrink-0">
        {label} {status}
      </span>
      {issueSummary ? (
        <span className="min-w-0 flex-1 truncate text-current/80">
          {issueSummary}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {showRefresh ? (
        <button
          type="button"
          disabled={refreshPending}
          onClick={onRefresh}
          className="inline-flex min-h-7 items-center rounded-[var(--radius-control)] border border-current/25 bg-background/70 px-2 py-1 text-[11px] font-medium text-current hover:bg-background disabled:opacity-60"
        >
          {refreshPending ? refreshingLabel : refreshLabel}
        </button>
      ) : null}
      {showRunLibrarian ? (
        <button
          type="button"
          disabled={runLibrarianPending}
          onClick={onRunLibrarian}
          className="inline-flex min-h-7 items-center rounded-[var(--radius-control)] border border-current/25 bg-background/70 px-2 py-1 text-[11px] font-medium text-current hover:bg-background disabled:opacity-60"
        >
          {runLibrarianPending ? runningLibrarianLabel : runLibrarianLabel}
        </button>
      ) : null}
    </div>
  );
}

const LIBRARIAN_REPAIR_ISSUES = new Set<ProjectWikiIndexHealthIssueKind>([
  "duplicate_titles",
  "unresolved_missing",
  "unresolved_ambiguous",
  "orphan_pages",
]);

function hasLibrarianRepairIssue(index: ProjectWikiIndex | undefined): boolean {
  return Boolean(
    index?.health.issues.some((issue) =>
      LIBRARIAN_REPAIR_ISSUES.has(issue.kind),
    ),
  );
}

function formatWikiHealthIssueSummary(
  index: ProjectWikiIndex | undefined,
  format: (kind: ProjectWikiIndexHealthIssueKind, count: number) => string,
): string | null {
  if (!index || index.health.issues.length === 0) return null;
  return index.health.issues
    .slice(0, 2)
    .map((issue) => format(issue.kind, issue.count))
    .join(" · ");
}

function formatRecentWikiActivitySummary(
  index: ProjectWikiIndex | undefined,
  label: string,
): string | null {
  const log = index?.recentLogs[0];
  if (!log) return null;
  const reason = log.reason?.trim();
  return reason
    ? `${label}: ${log.noteTitle} - ${reason}`
    : `${label}: ${log.noteTitle} ${log.action}`;
}

function getWikiHealthClassName(status: ProjectWikiIndexHealthStatus): string {
  switch (status) {
    case "blocked":
      return "border-destructive/30 bg-destructive/5 text-destructive";
    case "needs_attention":
      return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200";
    case "updating":
      return "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200";
    case "healthy":
      return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
}
