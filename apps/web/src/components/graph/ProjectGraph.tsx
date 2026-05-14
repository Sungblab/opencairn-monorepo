"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { ViewType } from "@opencairn/shared";
import { plan8AgentsApi, projectsApi } from "@/lib/api-client";
import { usePanelStore } from "@/stores/panel-store";
import {
  formatRecentWikiActivitySummary,
  formatWikiHealthIssueSummary,
  hasLibrarianRepairIssue,
  WikiIndexHealthBadge,
} from "@/components/wiki/wiki-index-health";
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
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);

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
      toast.success(t("health.refreshQueued"));
    },
    onError: () => {
      toast.error(t("health.refreshFailed"));
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
        queryClient.invalidateQueries({
          queryKey: ["workflow-console-runs", projectId],
        }),
      ]);
      toast.success(t("health.librarianStarted"));
      openAgentPanelTab("activity");
    },
    onError: () => {
      toast.error(t("health.librarianFailed"));
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
  const healthIssueSummary = formatWikiHealthIssueSummary(
    wikiIndex,
    (kind, count) => t(`health.issues.${kind}`, { count }),
  );
  const recentWikiActivitySummary = formatRecentWikiActivitySummary(
    wikiIndex,
    t("health.recentActivity"),
  );
  const healthSummary =
    [healthIssueSummary, recentWikiActivitySummary]
      .filter(Boolean)
      .join(" · ") || null;

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
        <WikiIndexHealthBadge
          testId="project-graph-wiki-health"
          className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-xs font-medium"
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
