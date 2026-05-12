"use client";

import { urls } from "@/lib/urls";
import { useMemo, useState, type ComponentType } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarDays, FilePlus, GitBranch, Layers3, LayoutTemplate, Network, UploadCloud } from "lucide-react";
import {
  projectsApi,
  type ProjectNoteRow,
  type ProjectWikiIndex,
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
    labels: { pages: string; links: string; latest?: string },
  ) {
    if (!index) return null;
    return [labels.pages, labels.links, labels.latest].filter(Boolean).join(" · ");
  }

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
        <button
          type="button"
          disabled
          className="flex min-h-28 items-start gap-3 rounded-[var(--radius-control)] border border-dashed border-border bg-muted/30 p-3 text-left text-muted-foreground"
        >
          <StarterActionContent
            Icon={CalendarDays}
            title={timetableTitle}
            description={timetableDescription}
            badge={timetableBadge}
          />
        </button>
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
