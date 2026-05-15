"use client";

import { urls } from "@/lib/urls";
import {
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
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
  FileText,
  GitBranch,
  ImagePlus,
  Layers3,
  LayoutTemplate,
  Link2,
  Lightbulb,
  Mic2,
  Network,
  PenLine,
  Search,
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
import { NewNoteButton } from "@/components/sidebar/NewNoteButton";
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
type GuidedWorkflowOutput =
  | "analysis"
  | "outline"
  | "draft"
  | "review"
  | "studyPack";
type GuidedEvidenceMode = "strict" | "balanced" | "exploratory";
type GuidedDetailLevel = "brief" | "standard" | "deep";
type GuidedWorkflowDraft = {
  topic: string;
  output: GuidedWorkflowOutput;
  evidenceMode: GuidedEvidenceMode;
  detailLevel: GuidedDetailLevel;
};

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
const GUIDED_OUTPUT_OPTIONS: GuidedWorkflowOutput[] = [
  "analysis",
  "outline",
  "draft",
  "review",
  "studyPack",
];
const GUIDED_EVIDENCE_OPTIONS: GuidedEvidenceMode[] = [
  "strict",
  "balanced",
  "exploratory",
];
const GUIDED_DETAIL_OPTIONS: GuidedDetailLevel[] = [
  "brief",
  "standard",
  "deep",
];
const PROJECT_HOME_ACTION_IDS = [
  "import",
  "recording",
  "summarize",
  "pdf_report_fast",
  "pptx_deck",
  "xlsx_table",
  "source_figure",
  "study_artifact_generator",
  "research",
  "runs",
  "review_inbox",
] as const;

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
  const agentToolGroups = useMemo(
    () => getToolDiscoveryGroups("agent_tools"),
    [],
  );
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
  const { data: projectNotes } = useQuery({
    queryKey: ["project-notes", projectId, "all"],
    queryFn: () => projectsApi.notes(projectId, "all").then((r) => r.notes),
  });
  const allNotes = projectNotes ?? null;
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
    for (const group of [...toolGroups, ...agentToolGroups]) {
      for (const item of group.items) byId.set(item.id, item);
    }
    return byId;
  }, [agentToolGroups, toolGroups]);
  const recommendedProjectActions = useMemo(
    () =>
      PROJECT_HOME_ACTION_IDS.map((id) => projectCommandTools.get(id)).filter(
        (item): item is ToolDiscoveryItem => Boolean(item),
      ),
    [projectCommandTools],
  );

  function queueProjectPrompt(prompt: string) {
    requestWorkflow({
      kind: "agent_prompt",
      toolId: "project_command_center",
      i18nKey: "commandCenter",
      prompt,
    });
    openAgentPanelTab("chat");
  }

  function guidedPrompt(id: ProjectGuidedStartId, draft: GuidedWorkflowDraft) {
    return [
      t(`commandCenter.guided.${id}.prompt`),
      t("commandCenter.guidedWizard.promptBlock", {
        topic:
          draft.topic.trim() || t("commandCenter.guidedWizard.topicFallback"),
        output: t(`commandCenter.guidedWizard.output.${draft.output}`),
        evidence: t(
          `commandCenter.guidedWizard.evidence.${draft.evidenceMode}`,
        ),
        detail: t(`commandCenter.guidedWizard.detail.${draft.detailLevel}`),
      }),
    ].join("\n\n");
  }

  function runGuidedStart(
    id: ProjectGuidedStartId,
    draft?: GuidedWorkflowDraft,
  ) {
    const prompt = draft
      ? guidedPrompt(id, draft)
      : t(`commandCenter.guided.${id}.prompt`);
    if (id === "paperAnalysis") {
      const item = projectCommandTools.get("pdf_report_fast");
      if (item && draft) {
        requestWorkflow({ ...workflowForToolItem(item), prompt });
        openAgentPanelTab("chat");
      } else if (item) {
        void runProjectToolWithPreflight(item);
      }
      return;
    }
    if (id === "report") {
      const item = projectCommandTools.get("pdf_report_fast");
      if (item && draft) {
        requestWorkflow({ ...workflowForToolItem(item), prompt });
        openAgentPanelTab("chat");
      } else if (item) {
        void runProjectToolWithPreflight(item);
      }
      return;
    }
    queueProjectPrompt(prompt);
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

  const loadedProject = allNotes !== null;
  const loadedEmptyProject = loadedProject && counts.all === 0;

  return (
    <div
      data-testid="route-project"
      className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
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
      {loadedProject ? (
        <EmptyProjectWorkspace
          projectId={projectId}
          workspaceSlug={wsSlug}
          templatesHref={urls.workspace.newProject(locale, wsSlug)}
          webImportHref={`${urls.workspace.import(locale, wsSlug)}?projectId=${encodeURIComponent(projectId)}&source=web`}
          title={
            loadedEmptyProject ? t("empty.title") : t("sourceIntake.title")
          }
          description={
            loadedEmptyProject
              ? t("empty.description")
              : t("sourceIntake.description")
          }
          uploadTitle={t("empty.actions.upload.title")}
          uploadDescription={t("empty.actions.upload.description")}
          recordingTitle={t("empty.actions.recording.title")}
          recordingDescription={t("empty.actions.recording.description")}
          noteTitle={t("empty.actions.note.title")}
          noteDescription={t("empty.actions.note.description")}
          webTitle={t("empty.actions.web.title")}
          webDescription={t("empty.actions.web.description")}
          templatesHeading={t("empty.templates.heading")}
          templatesIntro={t("empty.templates.description")}
          templatesTitle={t("starter.actions.templates.title")}
          templatesActionDescription={t(
            "starter.actions.templates.description",
          )}
          literatureTitle={t("empty.templates.literature.title")}
          literatureDescription={t("empty.templates.literature.description")}
          timetableTitle={t("starter.actions.timetable.title")}
          timetableDescription={t("starter.actions.timetable.description")}
          timetableBadge={t("starter.actions.timetable.badge")}
          showTemplates={loadedEmptyProject}
          onLiterature={() => {
            const item = projectCommandTools.get("literature");
            if (item) executeProjectTool(item);
          }}
        />
      ) : null}
      <>
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
        <ProjectActionStrip
          title={t("nextActions.title")}
          description={t("nextActions.description")}
          allToolsLabel={t("nextActions.allTools")}
          items={recommendedProjectActions}
          renderItem={renderToolItem}
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
            (kind, count) =>
              t(`graphDiscovery.health.issues.${kind}`, { count }),
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
        {!loadedEmptyProject ? (
          <ProjectNotesTable
            wsSlug={wsSlug}
            projectId={projectId}
            counts={counts}
          />
        ) : null}
      </>
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
  onGuidedStart(id: ProjectGuidedStartId, draft?: GuidedWorkflowDraft): void;
}) {
  const t = useTranslations("project.commandCenter.guidedWizard");
  const [value, setValue] = useState("");
  const [activeStart, setActiveStart] = useState<ProjectGuidedStartId | null>(
    null,
  );
  const [topic, setTopic] = useState("");
  const [output, setOutput] = useState<GuidedWorkflowOutput>("analysis");
  const [evidenceMode, setEvidenceMode] =
    useState<GuidedEvidenceMode>("strict");
  const [detailLevel, setDetailLevel] = useState<GuidedDetailLevel>("standard");
  const trimmed = value.trim();
  const activeGuidedStart = guidedStarts.find(
    (start) => start.id === activeStart,
  );

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

  function submitGuidedWizard(event: FormEvent) {
    event.preventDefault();
    if (!activeStart) return;
    onGuidedStart(activeStart, {
      topic,
      output,
      evidenceMode,
      detailLevel,
    });
    setTopic("");
    setOutput("analysis");
    setEvidenceMode("strict");
    setDetailLevel("standard");
    setActiveStart(null);
  }

  return (
    <section
      aria-labelledby="project-command-center-heading"
      className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.75fr)]"
    >
      <div className="min-w-0 space-y-4">
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
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2">
            {guidedStarts.map((start) => {
              const Icon = start.Icon;
              return (
                <button
                  key={start.id}
                  type="button"
                  onClick={() => {
                    setActiveStart(start.id);
                    setOutput(defaultGuidedOutput(start.id));
                  }}
                  className="flex min-h-24 items-start gap-3 rounded-[var(--radius-control)] border border-border bg-card px-3 py-3 text-left transition hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-muted text-foreground">
                    <Icon aria-hidden className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block break-words text-sm font-medium text-foreground">
                      {start.title}
                    </span>
                    <span className="mt-1 block break-words text-xs leading-5 text-muted-foreground">
                      {start.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {activeGuidedStart ? (
            <form
              onSubmit={submitGuidedWizard}
              className="space-y-3 rounded-[var(--radius-card)] border border-border bg-background p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-medium text-foreground">
                    {t("title", { goal: activeGuidedStart.title })}
                  </h4>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {t("description")}
                  </p>
                </div>
                <button
                  type="button"
                  className="app-btn-ghost h-7 rounded-[var(--radius-control)] border border-border px-2 text-xs"
                  onClick={() => setActiveStart(null)}
                >
                  {t("cancel")}
                </button>
              </div>
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span>{t("topicLabel")}</span>
                <textarea
                  aria-label={t("topicLabel")}
                  value={topic}
                  onChange={(event) => setTopic(event.currentTarget.value)}
                  rows={2}
                  placeholder={t("topicPlaceholder")}
                  className="min-h-16 w-full resize-none rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-foreground"
                />
              </label>
              <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
                <GuidedSelect
                  label={t("outputLabel")}
                  value={output}
                  options={GUIDED_OUTPUT_OPTIONS}
                  optionLabel={(option) => t(`output.${option}`)}
                  onChange={(next) => setOutput(next as GuidedWorkflowOutput)}
                />
                <GuidedSelect
                  label={t("evidenceLabel")}
                  value={evidenceMode}
                  options={GUIDED_EVIDENCE_OPTIONS}
                  optionLabel={(option) => t(`evidence.${option}`)}
                  onChange={(next) =>
                    setEvidenceMode(next as GuidedEvidenceMode)
                  }
                />
                <GuidedSelect
                  label={t("detailLabel")}
                  value={detailLevel}
                  options={GUIDED_DETAIL_OPTIONS}
                  optionLabel={(option) => t(`detail.${option}`)}
                  onChange={(next) => setDetailLevel(next as GuidedDetailLevel)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <span className="rounded-[var(--radius-control)] bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                  {contextValue}
                </span>
                <button
                  type="submit"
                  className="app-btn-primary inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-xs"
                >
                  <ArrowUp aria-hidden className="h-3.5 w-3.5" />
                  {t("submit")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
      {activeRuns.length > 0 ? (
        <aside className="min-w-0 space-y-2 rounded-[var(--radius-card)] border border-border bg-muted/20 p-3">
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

function defaultGuidedOutput(id: ProjectGuidedStartId): GuidedWorkflowOutput {
  if (id === "paperDraft") return "draft";
  if (id === "review") return "review";
  if (id === "studyPrep") return "studyPack";
  if (id === "ideation") return "outline";
  return "analysis";
}

function GuidedSelect({
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  optionLabel(option: string): string;
  onChange(value: string): void;
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-8 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-foreground"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyProjectWorkspace({
  projectId,
  workspaceSlug,
  templatesHref,
  webImportHref,
  title,
  description,
  uploadTitle,
  uploadDescription,
  recordingTitle,
  recordingDescription,
  noteTitle,
  noteDescription,
  webTitle,
  webDescription,
  templatesHeading,
  templatesIntro,
  templatesTitle,
  templatesActionDescription,
  literatureTitle,
  literatureDescription,
  timetableTitle,
  timetableDescription,
  timetableBadge,
  showTemplates,
  onLiterature,
}: {
  projectId: string;
  workspaceSlug: string;
  templatesHref: string;
  webImportHref: string;
  title: string;
  description: string;
  uploadTitle: string;
  uploadDescription: string;
  recordingTitle: string;
  recordingDescription: string;
  noteTitle: string;
  noteDescription: string;
  webTitle: string;
  webDescription: string;
  templatesHeading: string;
  templatesIntro: string;
  templatesTitle: string;
  templatesActionDescription: string;
  literatureTitle: string;
  literatureDescription: string;
  timetableTitle: string;
  timetableDescription: string;
  timetableBadge: string;
  showTemplates: boolean;
  onLiterature: () => void;
}) {
  return (
    <section
      data-testid="project-empty-workspace"
      className="grid gap-5 rounded-[var(--radius-card)] border border-border bg-card p-5"
    >
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <div
        data-testid="project-empty-primary-actions"
        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-2"
      >
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
        <SourceUploadButton
          projectId={projectId}
          className="flex min-h-28 w-full items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40"
        >
          <StarterActionContent
            Icon={Mic2}
            title={recordingTitle}
            description={recordingDescription}
          />
        </SourceUploadButton>
        <NewNoteButton
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          className="flex min-h-28 w-full items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40"
        >
          <StarterActionContent
            Icon={FileText}
            title={noteTitle}
            description={noteDescription}
          />
        </NewNoteButton>
        <Link
          href={webImportHref}
          className="flex min-h-28 items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StarterActionContent
            Icon={Link2}
            title={webTitle}
            description={webDescription}
          />
        </Link>
      </div>
      {showTemplates ? (
      <div className="border-t border-border pt-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">
            {templatesHeading}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {templatesIntro}
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2">
          <Link
            href={templatesHref}
            className="flex min-h-24 items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StarterActionContent
              Icon={LayoutTemplate}
              title={templatesTitle}
              description={templatesActionDescription}
            />
          </Link>
          <button
            type="button"
            onClick={onLiterature}
            className="flex min-h-24 items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StarterActionContent
              Icon={Search}
              title={literatureTitle}
              description={literatureDescription}
            />
          </button>
          <SourceUploadButton
            projectId={projectId}
            className="flex min-h-24 w-full items-start gap-3 rounded-[var(--radius-control)] border border-border bg-background p-3 text-left hover:border-foreground hover:bg-muted/40"
          >
            <StarterActionContent
              Icon={ImagePlus}
              title={timetableTitle}
              description={timetableDescription}
              badge={timetableBadge}
            />
          </SourceUploadButton>
        </div>
      </div>
      ) : null}
    </section>
  );
}

function ProjectActionStrip({
  title,
  description,
  allToolsLabel,
  items,
  renderItem,
}: {
  title: string;
  description: string;
  allToolsLabel: string;
  items: ToolDiscoveryItem[];
  renderItem: (item: ToolDiscoveryItem) => ReactNode;
}) {
  return (
    <section aria-labelledby="project-next-actions" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="project-next-actions"
            className="text-sm font-semibold text-foreground"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => usePanelStore.getState().openAgentPanelTab("tools")}
          className="app-btn-secondary h-9 rounded-[var(--radius-control)] px-3 text-sm"
        >
          {allToolsLabel}
        </button>
      </div>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2">
        {items.map((item) => renderItem(item))}
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
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block break-words text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-1 block break-words text-xs leading-5 text-muted-foreground">
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
        <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 md:w-auto">
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
