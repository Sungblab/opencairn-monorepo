"use client";

import { urls } from "@/lib/urls";
import { useMemo, useState, type ComponentType } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FilePlus, GitBranch, ImagePlus, Layers3, LayoutTemplate, Network, UploadCloud } from "lucide-react";
import {
  plan8AgentsApi,
  projectsApi,
  type ProjectNoteRow,
  type ProjectWikiIndex,
  type ProjectWikiIndexHealthIssueKind,
  type ProjectWikiIndexHealthStatus,
} from "@/lib/api-client";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { LiteratureSearchModal } from "@/components/literature/literature-search-modal";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
} from "@/components/agent-panel/workbench-trigger-button";
import { SourceUploadButton } from "@/components/sidebar/SourceUploadButton";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import {
  getToolDiscoveryGroups,
  type DocumentGenerationPresetId,
  type ToolDiscoveryItem,
} from "@/components/agent-panel/tool-discovery-catalog";
import {
  getToolDiscoveryTileClassName,
  ToolDiscoveryTileContent,
} from "@/components/agent-panel/tool-discovery-tile";
import { ProjectMetaRow } from "./project-meta-row";
import { ProjectNotesTable } from "./project-notes-table";

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
  const requestDocumentGenerationPreset = useAgentWorkbenchStore(
    (s) => s.requestDocumentGenerationPreset,
  );
  const [literatureOpen, setLiteratureOpen] = useState(false);
  const toolGroups = useMemo(() => getToolDiscoveryGroups("project_home"), []);
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
        queryClient.invalidateQueries({ queryKey: ["project-meta", projectId] }),
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
    },
  });
  const runLibrarianMutation = useMutation({
    mutationFn: () => plan8AgentsApi.runLibrarian({ projectId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["plan8-agents", projectId],
      });
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

  function projectRouteHref(route: "project_graph" | "project_agents" | "project_learn") {
    if (route === "project_graph") {
      return urls.workspace.projectGraph(locale, wsSlug, projectId);
    }
    if (route === "project_agents") {
      return urls.workspace.projectAgents(locale, wsSlug, projectId);
    }
    return urls.workspace.projectLearn(locale, wsSlug, projectId);
  }

  function projectGraphHref(view?: "cards" | "mindmap") {
    const base = urls.workspace.projectGraph(locale, wsSlug, projectId);
    return view ? `${base}?view=${view}` : base;
  }

  function openDocumentPreset(presetId: DocumentGenerationPresetId) {
    requestDocumentGenerationPreset(presetId);
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

  function formatWikiHealthIssueSummary(index: ProjectWikiIndex | undefined) {
    if (!index || index.health.issues.length === 0) return null;
    return index.health.issues
      .slice(0, 2)
      .map((issue) =>
        t(`graphDiscovery.health.issues.${issue.kind}`, {
          count: issue.count,
        }),
      )
      .join(" · ");
  }

  const canRefreshWikiIndex =
    projectPermissions?.role === "owner" ||
    projectPermissions?.role === "admin" ||
    projectPermissions?.role === "editor";
  const canRunLibrarian = canRefreshWikiIndex;
  const shouldOfferLibrarian =
    Boolean(wikiIndex) &&
    canRunLibrarian &&
    hasLibrarianRepairIssue(wikiIndex);

  function renderToolItem(item: ToolDiscoveryItem) {
    const title = t(`tools.items.${item.i18nKey}.title`);
    const description = t(`tools.items.${item.i18nKey}.description`);

    switch (item.action.type) {
      case "route":
        return (
          <ToolLink
            key={item.id}
            href={projectRouteHref(item.action.route)}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
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
            onClick={() => setLiteratureOpen(true)}
          />
        );
      case "workbench_command":
        return (
          <ToolCommandButton
            key={item.id}
            commandId={item.action.commandId}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
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
        const presetId = item.action.presetId;
        return (
          <ToolPresetButton
            key={item.id}
            icon={item.icon}
            title={title}
            description={description}
            emphasis={item.emphasis}
            onOpen={() => openDocumentPreset(presetId)}
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
        healthIssueSummary={formatWikiHealthIssueSummary(wikiIndex)}
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
      <LiteratureSearchModal
        open={literatureOpen}
        onOpenChange={setLiteratureOpen}
        workspaceId={workspaceId}
        defaultProjectId={projectId}
      />
    </div>
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
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
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
              <span className="text-foreground">{indexLabel}</span>{" "}
              {indexStats}
            </p>
          ) : null}
          {healthStatus ? (
            <div
              data-testid="project-wiki-health"
              className={`mt-2 inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-1 rounded-[var(--radius-control)] border px-2 py-1 text-xs font-medium ${getWikiHealthClassName(
                healthTone,
              )}`}
            >
              <span>
                {healthLabel} {healthStatus}
              </span>
              {healthIssueSummary ? (
                <span className="min-w-0 truncate text-current/80">
                  · {healthIssueSummary}
                </span>
              ) : null}
              {showRefresh ? (
                <button
                  type="button"
                  disabled={refreshPending}
                  onClick={onRefresh}
                  className="ml-1 rounded-[var(--radius-control)] border border-current/25 bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-current hover:bg-background disabled:opacity-60"
                >
                  {refreshPending ? refreshingLabel : refreshLabel}
                </button>
              ) : null}
              {showRunLibrarian ? (
                <button
                  type="button"
                  disabled={runLibrarianPending}
                  onClick={onRunLibrarian}
                  className="ml-1 rounded-[var(--radius-control)] border border-current/25 bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-current hover:bg-background disabled:opacity-60"
                >
                  {runLibrarianPending ? runningLibrarianLabel : runLibrarianLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <GraphDiscoveryLink href={mapHref} label={mapLabel} Icon={Network} />
          <GraphDiscoveryLink href={cardsHref} label={cardsLabel} Icon={Layers3} />
          <GraphDiscoveryLink href={mindmapHref} label={mindmapLabel} Icon={GitBranch} />
        </div>
      </div>
    </section>
  );
}

const LIBRARIAN_REPAIR_ISSUES = new Set<ProjectWikiIndexHealthIssueKind>([
  "unresolved_missing",
  "unresolved_ambiguous",
  "orphan_pages",
]);

function hasLibrarianRepairIssue(
  index: ProjectWikiIndex | undefined,
): boolean {
  return Boolean(
    index?.health.issues.some((issue) =>
      LIBRARIAN_REPAIR_ISSUES.has(issue.kind),
    ),
  );
}

function getWikiHealthClassName(
  status: ProjectWikiIndexHealthStatus | null,
): string {
  switch (status) {
    case "blocked":
      return "border-destructive/30 bg-destructive/5 text-destructive";
    case "needs_attention":
      return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200";
    case "updating":
      return "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200";
    case "healthy":
      return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-200";
    default:
      return "border-border bg-background text-muted-foreground";
  }
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
}: {
  href: string;
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className={getToolDiscoveryTileClassName({ emphasis })}
    >
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
        emphasis={emphasis}
      />
    </Link>
  );
}

function ToolCommandButton({
  commandId,
  icon,
  title,
  description,
  emphasis = false,
}: {
  commandId: Parameters<typeof WorkbenchCommandButton>[0]["commandId"];
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  emphasis?: boolean;
}) {
  return (
    <WorkbenchCommandButton
      commandId={commandId}
      className={getToolDiscoveryTileClassName({ emphasis })}
    >
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
        emphasis={emphasis}
      />
    </WorkbenchCommandButton>
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

function ToolPresetButton({
  icon,
  title,
  description,
  emphasis = false,
  onOpen,
}: {
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  emphasis?: boolean;
  onOpen: () => void;
}) {
  return (
    <WorkbenchActivityButton
      onClick={onOpen}
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

function ToolButton({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={getToolDiscoveryTileClassName({})}
    >
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
      />
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
