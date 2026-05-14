"use client";

import { urls } from "@/lib/urls";
import {
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowUp,
  BookOpen,
  ClipboardCheck,
  FilePlus,
  GitBranch,
  ImagePlus,
  Layers3,
  LayoutTemplate,
  Lightbulb,
  Network,
  PenLine,
  UploadCloud,
} from "lucide-react";
import {
  integrationsApi,
  plan8AgentsApi,
  projectsApi,
  studioToolsApi,
  workflowConsoleApi,
  type ProjectNoteRow,
  type ProjectWikiIndex,
  type ProjectWikiIndexHealthStatus,
  type StudioToolPreflightResponse,
  type WorkflowConsoleRun,
} from "@/lib/api-client";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { WorkbenchActivityButton } from "@/components/agent-panel/workbench-trigger-button";
import { SourceUploadButton } from "@/components/sidebar/SourceUploadButton";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import {
  getToolDiscoveryGroups,
  type ToolDiscoveryItem,
} from "@/components/agent-panel/tool-discovery-catalog";
import {
  getToolRouteHref,
  routeShouldOpenAsWorkflow,
  toolShouldOpenAsWorkflow,
  workflowForToolItem,
} from "@/components/agent-panel/tool-discovery-actions";
import {
  getToolDiscoveryTileClassName,
  ToolDiscoveryTileContent,
} from "@/components/agent-panel/tool-discovery-tile";
import { AgentRunTimeline } from "@/components/agent-panel/agent-run-timeline";
import {
  formatWikiHealthIssueSummary,
  hasLibrarianRepairIssue,
  WikiIndexHealthBadge,
} from "@/components/wiki/wiki-index-health";
import { ProjectMetaRow } from "./project-meta-row";
import { ProjectNotesTable } from "./project-notes-table";

type PreflightState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "confirm";
      item: ToolDiscoveryItem;
      preflight: StudioToolPreflightResponse["preflight"];
    }
  | {
      status: "blocked";
      item: ToolDiscoveryItem;
      preflight: StudioToolPreflightResponse["preflight"];
    }
  | { status: "error"; item: ToolDiscoveryItem };

type ProjectGuidedStartId =
  | "paperAnalysis"
  | "report"
  | "paperDraft"
  | "review"
  | "ideation"
  | "studyPrep";

const PROJECT_GUIDED_STARTS: Array<{
  id: ProjectGuidedStartId;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  { id: "paperAnalysis", Icon: BookOpen },
  { id: "report", Icon: PenLine },
  { id: "paperDraft", Icon: FilePlus },
  { id: "review", Icon: ClipboardCheck },
  { id: "ideation", Icon: Lightbulb },
  { id: "studyPrep", Icon: Layers3 },
];

const WORKFLOW_TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "reverted",
]);

function isTerminalWorkflowStatus(status: WorkflowConsoleRun["status"]) {
  return WORKFLOW_TERMINAL_STATUSES.has(status);
}

export function ProjectView({
  wsSlug,
  projectId,
}: {
  wsSlug: string;
  projectId: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("project");
  const workspaceId = useWorkspaceId(wsSlug);
  const requestWorkflow = useAgentWorkbenchStore((s) => s.requestWorkflow);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);
  const [preflightState, setPreflightState] = useState<PreflightState>({
    status: "idle",
  });
  const toolGroups = useMemo(() => getToolDiscoveryGroups("project_home"), []);
  const googleIntegrationQuery = useQuery({
    queryKey: ["project-tools-google-integration", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    retry: false,
    queryFn: () => integrationsApi.google(workspaceId!),
  });
  const { data: meta } = useQuery({
    queryKey: ["project-meta", projectId],
    queryFn: () => projectsApi.get(projectId),
  });
  const { data: wikiIndex } = useQuery({
    queryKey: ["project-wiki-index", projectId],
    queryFn: () => projectsApi.wikiIndex(projectId),
  });
  const { data: projectPermissions } = useQuery({
    queryKey: ["project-permissions", projectId],
    queryFn: () => projectsApi.permissions(projectId),
    staleTime: 30_000,
  });
  const renameMutation = useMutation({
    mutationFn: (name: string) => projectsApi.update(projectId, { name }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["project-meta", projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      router.refresh();
    },
  });
  const refreshWikiIndexMutation = useMutation({
    mutationFn: () => projectsApi.refreshWikiIndex(projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["project-wiki-index", projectId],
      });
      toast.success(t("graphDiscovery.health.refreshQueued"));
    },
    onError: () => {
      toast.error(t("graphDiscovery.health.refreshFailed"));
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
          queryKey: ["workflow-console-runs", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["project-wiki-index", projectId],
        }),
      ]);
      toast.success(t("graphDiscovery.health.librarianStarted"));
      openAgentPanelTab("activity");
    },
    onError: () => {
      toast.error(t("graphDiscovery.health.librarianFailed"));
    },
  });
  // Page count + last activity are derived from the unfiltered notes list to
  // avoid a third endpoint just for two scalars. The notes table publishes
  // its `filter=all` payload back here when it fires; counts also feed the
  // chip labels in the table header so the two surfaces stay in sync.
  const [allNotes, setAllNotes] = useState<ProjectNoteRow[] | null>(null);
  const counts = useMemo(() => {
    const acc = { all: 0, imported: 0, research: 0, manual: 0 };
    for (const row of allNotes ?? []) {
      acc.all += 1;
      acc[row.kind] += 1;
    }
    return acc;
  }, [allNotes]);
  const lastActivityIso =
    allNotes && allNotes.length > 0 ? allNotes[0].updated_at : null;

  function projectGraphHref(view?: "cards" | "mindmap") {
    const base = urls.workspace.projectGraph(locale, wsSlug, projectId);
    return view ? `${base}?view=${view}` : base;
  }

  function executeProjectTool(
    item: ToolDiscoveryItem,
    preflight?: StudioToolPreflightResponse["preflight"],
  ) {
    if (toolShouldOpenAsWorkflow(item)) {
      void preflight;
      requestWorkflow(workflowForToolItem(item));
      openAgentPanelTab("chat");
      return;
    }
  }

  async function runProjectToolWithPreflight(item: ToolDiscoveryItem) {
    if (!item.preflight) {
      executeProjectTool(item);
      return;
    }
    setPreflightState({ status: "loading" });
    try {
      const { preflight } = await studioToolsApi.preflight(projectId, {
        tool: item.preflight.tool,
        sourceTokenEstimate: item.preflight.sourceTokenEstimate,
      });
      if (!preflight.canStart) {
        setPreflightState({ status: "blocked", item, preflight });
        return;
      }
      if (preflight.requiresConfirmation) {
        setPreflightState({ status: "confirm", item, preflight });
        return;
      }
      setPreflightState({ status: "idle" });
      executeProjectTool(item, preflight);
    } catch {
      setPreflightState({ status: "error", item });
    }
  }

  function confirmProjectToolPreflight() {
    if (preflightState.status !== "confirm") return;
    const { item, preflight } = preflightState;
    setPreflightState({ status: "idle" });
    executeProjectTool(item, preflight);
  }

  function unavailableLabel(item: ToolDiscoveryItem): string | null {
    if (
      preflightState.status === "blocked" &&
      preflightState.item.id === item.id
    ) {
      return t("tools.unavailable.overQuota");
    }
    return null;
  }

  function statusLabel(item: ToolDiscoveryItem): string | null {
    if (item.id !== "connected_sources" || !workspaceId) return null;
    if (googleIntegrationQuery.isPending) {
      return t("tools.integrationStatus.checking");
    }
    return googleIntegrationQuery.data?.connected
      ? t("tools.integrationStatus.connected")
      : t("tools.integrationStatus.disconnected");
  }

  function formatWikiIndexStats(
    index: ProjectWikiIndex | undefined,
    labels: { pages: string; links: string; orphans: string; latest?: string },
  ) {
    if (!index) return null;
    return [labels.pages, labels.links, labels.orphans, labels.latest]
      .filter(Boolean)
      .join(" · ");
  }

  const canRefreshWikiIndex =
    projectPermissions?.role === "owner" ||
    projectPermissions?.role === "admin" ||
    projectPermissions?.role === "editor";
  const canRunLibrarian = canRefreshWikiIndex;
  const shouldOfferLibrarian =
    Boolean(wikiIndex) && canRunLibrarian && hasLibrarianRepairIssue(wikiIndex);
  const workflowConsoleQuery = useQuery({
    queryKey: ["workflow-console-runs", projectId],
    queryFn: () => workflowConsoleApi.list(projectId, 10),
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((run) => !isTerminalWorkflowStatus(run.status))
        ? 5000
        : false;
    },
  });
  const activeProjectRuns = (workflowConsoleQuery.data?.runs ?? []).filter(
    (run) => !isTerminalWorkflowStatus(run.status),
  );
  const projectCommandTools = useMemo(() => {
    const byId = new Map<string, ToolDiscoveryItem>();
    for (const group of toolGroups) {
      for (const item of group.items) byId.set(item.id, item);
    }
    return byId;
  }, [toolGroups]);

  function queueProjectPrompt(prompt: string) {
    requestWorkflow({
      kind: "agent_prompt",
      toolId: "project_command_center",
      i18nKey: "commandCenter",
      prompt,
    });
    openAgentPanelTab("chat");
  }

  function runGuidedStart(id: ProjectGuidedStartId) {
    if (id === "paperAnalysis") {
      const item = projectCommandTools.get("research");
      if (item) void runProjectToolWithPreflight(item);
      return;
    }
    if (id === "report") {
      const item = projectCommandTools.get("pdf_report_fast");
      if (item) void runProjectToolWithPreflight(item);
      return;
    }
    queueProjectPrompt(t(`commandCenter.guided.${id}.prompt`));
  }

  function renderToolItem(item: ToolDiscoveryItem) {
    const title = t(`tools.items.${item.i18nKey}.title`);
    const description = t(`tools.items.${item.i18nKey}.description`);
    const unavailable = unavailableLabel(item);
    const status = statusLabel(item);

    switch (item.action.type) {
      case "route":
        if (routeShouldOpenAsWorkflow(item.action.route)) {
          return (
            <ToolButton
              key={item.id}
              icon={item.icon}
              title={title}
              description={description}
              emphasis={item.emphasis}
              statusLabel={status}
              onClick={() => executeProjectTool(item)}
            />
          );
        }
        return (
          <ToolLink
            key={item.id}
            href={getToolRouteHref({
              route: item.action.route,
              locale,
              wsSlug,
              projectId,
            })}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
            statusLabel={status}
          />
        );
      case "upload":
        return (
          <ToolUploadButton
            key={item.id}
            projectId={projectId}
            icon={item.icon}
            title={title}
            description={description}
          />
        );
      case "literature_search":
        return (
          <ToolButton
            key={item.id}
            icon={item.icon}
            title={title}
            description={description}
            statusLabel={status}
            onClick={() => executeProjectTool(item)}
          />
        );
      case "deep_research":
        return (
          <ToolButton
            key={item.id}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
            unavailableLabel={unavailable}
            disabled={Boolean(unavailable)}
            onClick={() => void runProjectToolWithPreflight(item)}
          />
        );
      case "workbench_command":
        return (
          <ToolButton
            key={item.id}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
            unavailableLabel={unavailable}
            disabled={Boolean(unavailable)}
            onClick={() =>
              item.preflight
                ? void runProjectToolWithPreflight(item)
                : executeProjectTool(item)
            }
          />
        );
      case "study_artifact_generate":
        return (
          <ToolButton
            key={item.id}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
            unavailableLabel={unavailable}
            disabled={Boolean(unavailable)}
            onClick={() =>
              item.preflight
                ? void runProjectToolWithPreflight(item)
                : executeProjectTool(item)
            }
          />
        );
      case "open_activity":
      case "open_review":
        return (
          <ToolActivityButton
            key={item.id}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
          />
        );
      case "document_generation_preset":
        return (
          <ToolButton
            key={item.id}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
            unavailableLabel={unavailable}
            disabled={Boolean(unavailable)}
            onClick={() =>
              item.preflight
                ? void runProjectToolWithPreflight(item)
                : executeProjectTool(item)
            }
          />
        );
    }
  }

  return (
    <div
      data-testid="route-project"
      className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8"
    >
      <header>
        <ProjectMetaRow
          name={meta?.name ?? ""}
          pageCount={counts.all}
          lastActivityIso={lastActivityIso}
          onRename={meta ? (name) => renameMutation.mutate(name) : undefined}
          renamePending={renameMutation.isPending}
        />
      </header>
      <ProjectCommandCenter
        title={t("commandCenter.title")}
        description={t("commandCenter.description")}
        inputLabel={t("commandCenter.inputLabel")}
        placeholder={t("commandCenter.placeholder")}
        submitLabel={t("commandCenter.submit")}
        contextLabel={t("commandCenter.contextLabel")}
        contextValue={t("commandCenter.contextValue", { count: counts.all })}
        guidedTitle={t("commandCenter.guidedTitle")}
        guidedDescription={t("commandCenter.guidedDescription")}
        guidedStarts={PROJECT_GUIDED_STARTS.map((start) => ({
          id: start.id,
          Icon: start.Icon,
          title: t(`commandCenter.guided.${start.id}.title`),
          description: t(`commandCenter.guided.${start.id}.description`),
        }))}
        activeRunsTitle={t("commandCenter.activeRuns.title")}
        activeRunsDescription={t("commandCenter.activeRuns.description")}
        activeRuns={activeProjectRuns}
        onSubmitPrompt={queueProjectPrompt}
        onGuidedStart={runGuidedStart}
      />
      <GraphDiscoveryPanel
        title={t("graphDiscovery.title")}
        description={t("graphDiscovery.description", { count: counts.all })}
        mapLabel={t("graphDiscovery.actions.map")}
        cardsLabel={t("graphDiscovery.actions.cards")}
        mindmapLabel={t("graphDiscovery.actions.mindmap")}
        indexLabel={t("graphDiscovery.index.label")}
        indexStats={formatWikiIndexStats(wikiIndex, {
          pages: t("graphDiscovery.index.pages", {
            count: wikiIndex?.totals.pages ?? 0,
          }),
          links: t("graphDiscovery.index.links", {
            count: wikiIndex?.totals.wikiLinks ?? 0,
          }),
          orphans: t("graphDiscovery.index.orphans", {
            count: wikiIndex?.totals.orphanPages ?? 0,
          }),
          latest: wikiIndex?.latestPageUpdatedAt
            ? t("graphDiscovery.index.latest", {
                date: new Intl.DateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(wikiIndex.latestPageUpdatedAt)),
              })
            : undefined,
        })}
        healthLabel={t("graphDiscovery.health.label")}
        healthStatus={
          wikiIndex
            ? t(`graphDiscovery.health.status.${wikiIndex.health.status}`)
            : null
        }
        healthIssueSummary={formatWikiHealthIssueSummary(
          wikiIndex,
          (kind, count) => t(`graphDiscovery.health.issues.${kind}`, { count }),
        )}
        healthTone={wikiIndex?.health.status ?? null}
        refreshLabel={t("graphDiscovery.health.refresh")}
        refreshingLabel={t("graphDiscovery.health.refreshing")}
        showRefresh={
          Boolean(wikiIndex) &&
          wikiIndex?.health.status !== "healthy" &&
          canRefreshWikiIndex
        }
        refreshPending={refreshWikiIndexMutation.isPending}
        onRefresh={() => refreshWikiIndexMutation.mutate()}
        runLibrarianLabel={t("graphDiscovery.health.runLibrarian")}
        runningLibrarianLabel={t("graphDiscovery.health.runningLibrarian")}
        showRunLibrarian={shouldOfferLibrarian}
        runLibrarianPending={runLibrarianMutation.isPending}
        onRunLibrarian={() => runLibrarianMutation.mutate()}
        mapHref={projectGraphHref()}
        cardsHref={projectGraphHref("cards")}
        mindmapHref={projectGraphHref("mindmap")}
      />
      {allNotes !== null && counts.all === 0 ? (
        <ProjectStarterPanel
          projectId={projectId}
          templatesHref={urls.workspace.newProject(locale, wsSlug)}
          importHref={urls.workspace.import(locale, wsSlug)}
          title={t("starter.title")}
          description={t("starter.description")}
          uploadTitle={t("starter.actions.upload.title")}
          uploadDescription={t("starter.actions.upload.description")}
          templatesTitle={t("starter.actions.templates.title")}
          templatesDescription={t("starter.actions.templates.description")}
          importTitle={t("starter.actions.import.title")}
          importDescription={t("starter.actions.import.description")}
          timetableTitle={t("starter.actions.timetable.title")}
          timetableDescription={t("starter.actions.timetable.description")}
          timetableBadge={t("starter.actions.timetable.badge")}
        />
      ) : null}
      <section aria-labelledby="project-tools-heading" className="space-y-3">
        <div>
          <h2
            id="project-tools-heading"
            className="text-sm font-medium text-foreground"
          >
            {t("tools.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("tools.description")}
          </p>
        </div>
        <ProjectPreflightNotice
          state={preflightState}
          loadingLabel={t("tools.preflight.loading")}
          blockedLabel={
            preflightState.status === "blocked"
              ? t("tools.preflight.blocked", {
                  credits: preflightState.preflight.cost.billableCredits,
                  available: preflightState.preflight.balance.availableCredits,
                })
              : ""
          }
          confirmText={
            preflightState.status === "confirm"
              ? t("tools.preflight.confirm", {
                  credits: preflightState.preflight.cost.billableCredits,
                })
              : ""
          }
          errorLabel={t("tools.preflight.error")}
          confirmLabel={t("tools.preflight.confirmStart")}
          cancelLabel={t("tools.preflight.cancel")}
          onConfirm={confirmProjectToolPreflight}
          onCancel={() => setPreflightState({ status: "idle" })}
        />
        <div className="space-y-4">
          {toolGroups.map((group) => (
            <section key={group.category} className="space-y-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                  {t(`tools.categories.${group.category}.title`)}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(`tools.categories.${group.category}.description`)}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {group.items.map((item) => renderToolItem(item))}
              </div>
            </section>
          ))}
        </div>
      </section>
      <ProjectNotesTable
        wsSlug={wsSlug}
        projectId={projectId}
        counts={counts}
        onLoaded={(rows) => setAllNotes(rows)}
      />
    </div>
  );
}

function ProjectCommandCenter({
  title,
  description,
  inputLabel,
  placeholder,
  submitLabel,
  contextLabel,
  contextValue,
  guidedTitle,
  guidedDescription,
  guidedStarts,
  activeRunsTitle,
  activeRunsDescription,
  activeRuns,
  onSubmitPrompt,
  onGuidedStart,
}: {
  title: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  submitLabel: string;
  contextLabel: string;
  contextValue: string;
  guidedTitle: string;
  guidedDescription: string;
  guidedStarts: Array<{
    id: ProjectGuidedStartId;
    Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    title: string;
    description: string;
  }>;
  activeRunsTitle: string;
  activeRunsDescription: string;
  activeRuns: WorkflowConsoleRun[];
  onSubmitPrompt(prompt: string): void;
  onGuidedStart(id: ProjectGuidedStartId): void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    onSubmitPrompt(trimmed);
    setValue("");
  }

  function submitFromKeyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!trimmed) return;
    onSubmitPrompt(trimmed);
    setValue("");
  }

  return (
    <section
      aria-labelledby="project-command-center-heading"
      className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]"
    >
      <div className="space-y-4">
        <div>
          <h2
            id="project-command-center-heading"
            className="text-base font-semibold text-foreground"
          >
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <form
          onSubmit={submit}
          className="rounded-[var(--radius-card)] border border-border bg-background p-3 shadow-sm"
        >
          <label htmlFor="project-command-center-input" className="sr-only">
            {inputLabel}
          </label>
          <textarea
            id="project-command-center-input"
            aria-label={inputLabel}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={submitFromKeyboard}
            placeholder={placeholder}
            rows={3}
            className="min-h-24 w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="inline-flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground">
                {contextLabel}
              </span>
              <span className="truncate">{contextValue}</span>
            </div>
            <button
              type="submit"
              disabled={!trimmed}
              className="app-btn-primary inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-xs disabled:opacity-50"
            >
              <ArrowUp aria-hidden className="h-3.5 w-3.5" />
              {submitLabel}
            </button>
          </div>
        </form>
        <div className="space-y-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
              {guidedTitle}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {guidedDescription}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {guidedStarts.map((start) => {
              const Icon = start.Icon;
              return (
                <button
                  key={start.id}
                  type="button"
                  onClick={() => onGuidedStart(start.id)}
                  className="flex min-h-24 items-start gap-3 rounded-[var(--radius-control)] border border-border bg-card px-3 py-3 text-left transition hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-muted text-foreground">
                    <Icon aria-hidden className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {start.title}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {start.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {activeRuns.length > 0 ? (
        <aside className="space-y-2 rounded-[var(--radius-card)] border border-border bg-muted/20 p-3">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {activeRunsTitle}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {activeRunsDescription}
            </p>
          </div>
          <AgentRunTimeline
            runs={activeRuns}
            className="rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-2"
          />
        </aside>
      ) : null}
    </section>
  );
}

function ProjectStarterPanel({
  projectId,
  templatesHref,
  importHref,
  title,
  description,
  uploadTitle,
  uploadDescription,
  templatesTitle,
  templatesDescription,
  importTitle,
  importDescription,
  timetableTitle,
  timetableDescription,
  timetableBadge,
}: {
  projectId: string;
  templatesHref: string;
  importHref: string;
  title: string;
  description: string;
  uploadTitle: string;
  uploadDescription: string;
  templatesTitle: string;
  templatesDescription: string;
  importTitle: string;
  importDescription: string;
  timetableTitle: string;
  timetableDescription: string;
  timetableBadge: string;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-card p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <SourceUploadButton
          projectId={projectId}
          className="flex min-h-28 w-full items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40"
        >
          <StarterActionContent
            Icon={UploadCloud}
            title={uploadTitle}
            description={uploadDescription}
          />
        </SourceUploadButton>
        <Link
          href={templatesHref}
          className="flex min-h-28 items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StarterActionContent
            Icon={LayoutTemplate}
            title={templatesTitle}
            description={templatesDescription}
          />
        </Link>
        <Link
          href={importHref}
          className="flex min-h-28 items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StarterActionContent
            Icon={FilePlus}
            title={importTitle}
            description={importDescription}
          />
        </Link>
        <SourceUploadButton
          projectId={projectId}
          className="flex min-h-28 w-full items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40"
        >
          <StarterActionContent
            Icon={ImagePlus}
            title={timetableTitle}
            description={timetableDescription}
            badge={timetableBadge}
          />
        </SourceUploadButton>
      </div>
    </section>
  );
}

function StarterActionContent({
  Icon,
  title,
  description,
  badge,
}: {
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <>
      <Icon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
        {badge ? (
          <span className="mt-2 inline-flex rounded-[var(--radius-control)] border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </span>
    </>
  );
}

function GraphDiscoveryPanel({
  title,
  description,
  mapLabel,
  cardsLabel,
  mindmapLabel,
  indexLabel,
  indexStats,
  healthLabel,
  healthStatus,
  healthIssueSummary,
  healthTone,
  refreshLabel,
  refreshingLabel,
  showRefresh,
  refreshPending,
  onRefresh,
  runLibrarianLabel,
  runningLibrarianLabel,
  showRunLibrarian,
  runLibrarianPending,
  onRunLibrarian,
  mapHref,
  cardsHref,
  mindmapHref,
}: {
  title: string;
  description: string;
  mapLabel: string;
  cardsLabel: string;
  mindmapLabel: string;
  indexLabel: string;
  indexStats: string | null;
  healthLabel: string;
  healthStatus: string | null;
  healthIssueSummary: string | null;
  healthTone: ProjectWikiIndexHealthStatus | null;
  refreshLabel: string;
  refreshingLabel: string;
  showRefresh: boolean;
  refreshPending: boolean;
  onRefresh: () => void;
  runLibrarianLabel: string;
  runningLibrarianLabel: string;
  showRunLibrarian: boolean;
  runLibrarianPending: boolean;
  onRunLibrarian: () => void;
  mapHref: string;
  cardsHref: string;
  mindmapHref: string;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
          {indexStats ? (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              <span className="text-foreground">{indexLabel}</span> {indexStats}
            </p>
          ) : null}
          {healthStatus ? (
            <WikiIndexHealthBadge
              testId="project-wiki-health"
              className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-1 rounded-[var(--radius-control)] border px-2 py-1 text-xs font-medium"
              label={healthLabel}
              status={healthStatus}
              issueSummary={healthIssueSummary}
              tone={healthTone}
              refreshLabel={refreshLabel}
              refreshingLabel={refreshingLabel}
              showRefresh={showRefresh}
              refreshPending={refreshPending}
              onRefresh={onRefresh}
              runLibrarianLabel={runLibrarianLabel}
              runningLibrarianLabel={runningLibrarianLabel}
              showRunLibrarian={showRunLibrarian}
              runLibrarianPending={runLibrarianPending}
              onRunLibrarian={onRunLibrarian}
            />
          ) : null}
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <GraphDiscoveryLink href={mapHref} label={mapLabel} Icon={Network} />
          <GraphDiscoveryLink
            href={cardsHref}
            label={cardsLabel}
            Icon={Layers3}
          />
          <GraphDiscoveryLink
            href={mindmapHref}
            label={mindmapLabel}
            Icon={GitBranch}
          />
        </div>
      </div>
    </section>
  );
}

function GraphDiscoveryLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm font-medium hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}

function ToolLink({
  href,
  icon,
  title,
  description,
  emphasis = false,
  statusLabel,
}: {
  href: string;
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  emphasis?: boolean;
  statusLabel?: string | null;
}) {
  return (
    <Link href={href} className={getToolDiscoveryTileClassName({ emphasis })}>
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
        emphasis={emphasis}
      />
      {statusLabel ? (
        <span className="mt-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {statusLabel}
        </span>
      ) : null}
    </Link>
  );
}

function ToolActivityButton({
  icon,
  title,
  description,
  emphasis = false,
}: {
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  emphasis?: boolean;
}) {
  return (
    <WorkbenchActivityButton
      className={getToolDiscoveryTileClassName({ emphasis })}
    >
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
        emphasis={emphasis}
      />
    </WorkbenchActivityButton>
  );
}

function ProjectPreflightNotice({
  state,
  loadingLabel,
  blockedLabel,
  confirmText,
  errorLabel,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  state: PreflightState;
  loadingLabel: string;
  blockedLabel: string;
  confirmText: string;
  errorLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {loadingLabel}
      </p>
    );
  }
  const message =
    state.status === "confirm"
      ? confirmText
      : state.status === "blocked"
        ? blockedLabel
        : errorLabel;
  return (
    <div className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <p>{message}</p>
      {state.status === "confirm" ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-[var(--radius-control)] bg-foreground px-2 py-1 font-medium text-background"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 font-medium text-foreground"
          >
            {cancelLabel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 rounded-[var(--radius-control)] border border-border px-2 py-1 font-medium text-foreground"
        >
          {cancelLabel}
        </button>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  title,
  description,
  emphasis = false,
  unavailableLabel,
  statusLabel,
  disabled = false,
  onClick,
}: {
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  emphasis?: boolean;
  unavailableLabel?: string | null;
  statusLabel?: string | null;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={getToolDiscoveryTileClassName({ emphasis })}
    >
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
        emphasis={emphasis}
      />
      {statusLabel ? (
        <span className="mt-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {statusLabel}
        </span>
      ) : null}
      {unavailableLabel ? (
        <span className="mt-auto rounded-[var(--radius-control)] bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {unavailableLabel}
        </span>
      ) : null}
    </button>
  );
}

function ToolUploadButton({
  projectId,
  icon,
  title,
  description,
}: {
  projectId: string;
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
}) {
  return (
    <SourceUploadButton
      projectId={projectId}
      className={getToolDiscoveryTileClassName({
        className: "h-auto w-full items-start justify-start",
      })}
    >
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
      />
    </SourceUploadButton>
  );
}
