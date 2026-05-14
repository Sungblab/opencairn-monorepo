"use client";
import type { ComponentType, ReactNode } from "react";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  FileText,
  GraduationCap,
  Home,
  MoreHorizontal,
  Network,
  Newspaper,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { useCurrentProjectContext } from "./use-current-project";
import { NewNoteButton } from "./NewNoteButton";
import { NewFolderButton } from "./NewFolderButton";
import { NewCanvasButton } from "./NewCanvasButton";
import { SourceUploadButton } from "./SourceUploadButton";
import { NewCodeWorkspaceButton } from "./NewCodeWorkspaceButton";
import { GenerateDocumentButton } from "./GenerateDocumentButton";
import { ProjectHero } from "./project-hero";
import { MoreMenu } from "./more-menu";
import { SidebarEmptyState } from "./sidebar-empty-state";
import { usePanelStore } from "@/stores/panel-store";
import { LiteratureSearchButton } from "@/components/literature/literature-search-button";
import { SidebarFavorites } from "./sidebar-favorites";
import { SidebarRecentNotes } from "./sidebar-recent-notes";
import {
  DEFAULT_QUICK_CREATE_ORDER,
  type SidebarQuickCreateActionId,
  useSidebarStore,
} from "@/stores/sidebar-store";
import { workflowConsoleApi, type WorkflowConsoleRun } from "@/lib/api-client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ShellSidebarProps {
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
}

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "reverted",
]);

// App Shell Phase 2 assembled sidebar (distinct from the legacy
// project-scoped `Sidebar` that still layouts the editor page). The sidebar
// keeps workspace navigation and project navigation as separate outline blocks.
// The testid matches what Phase 1's e2e already watches.
export function ShellSidebar({
  deepResearchEnabled,
  synthesisExportEnabled = false,
}: ShellSidebarProps) {
  const { wsSlug, projectId } = useCurrentProjectContext();
  const locale = useLocale();
  const tNav = useTranslations("sidebar.nav");
  const tSections = useTranslations("sidebar.sections");
  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);
  const setSidebarWorkspace = useSidebarStore((s) => s.setWorkspace);
  const quickCreateOrder = useSidebarStore((s) => s.quickCreateOrder);
  const recordQuickCreateUse = useSidebarStore((s) => s.recordQuickCreateUse);
  const base = wsSlug ? urls.workspace.root(locale, wsSlug) : null;
  useEffect(() => {
    if (wsSlug) {
      setSidebarWorkspace(wsSlug);
    }
  }, [setSidebarWorkspace, wsSlug]);
  const quickCreateActions: Record<SidebarQuickCreateActionId, ReactNode> =
    projectId && wsSlug
      ? {
          new_note: (
            <NewNoteButton workspaceSlug={wsSlug} projectId={projectId} />
          ),
          upload: <SourceUploadButton projectId={projectId} />,
          new_folder: <NewFolderButton projectId={projectId} />,
          new_canvas: (
            <NewCanvasButton workspaceSlug={wsSlug} projectId={projectId} />
          ),
          new_code: <NewCodeWorkspaceButton projectId={projectId} />,
          generate_document: (
            <GenerateDocumentButton wsSlug={wsSlug} projectId={projectId} />
          ),
        }
      : ({} as Record<SidebarQuickCreateActionId, ReactNode>);

  return (
    <aside
      data-testid="app-shell-sidebar"
      className="flex h-full min-h-0 flex-col border-r border-border bg-muted/10"
    >
      <div className="flex items-center gap-1 border-b border-border bg-background px-2 py-1.5">
        <div className="min-w-0 flex-1">{wsSlug ? <ProjectHero /> : null}</div>
        <button
          type="button"
          aria-label={tNav("collapse_sidebar")}
          onClick={toggleSidebar}
          className="app-btn-ghost grid h-8 w-8 shrink-0 place-items-center rounded-md"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2.5 pb-8">
        <ScopedSearch />
        {base && wsSlug ? (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-1.5">
            <SidebarNavLink
              href={
                projectId
                  ? urls.workspace.project(locale, wsSlug, projectId)
                  : base
              }
              label={
                projectId ? tNav("project_home_short") : tNav("dashboard_short")
              }
              Icon={Home}
            />
            <ProjectToolsMenu
              base={base}
              compact
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </div>
        ) : null}

        {projectId && wsSlug ? (
          <>
            <SidebarSection id="create" label={tSections("create")} Icon={Plus}>
              <div
                className="grid grid-cols-2 gap-1 py-0.5 [&_button]:min-h-8 [&_button]:rounded-md [&_button]:border-transparent [&_button]:bg-transparent [&_button]:px-2 [&_button]:text-xs [&_button]:text-foreground [&_button]:hover:bg-muted"
                data-testid="sidebar-create-actions"
              >
                {quickCreateOrder
                  .filter((id) => id in quickCreateActions)
                  .concat(
                    DEFAULT_QUICK_CREATE_ORDER.filter(
                      (id) => !quickCreateOrder.includes(id),
                    ),
                  )
                  .map((id) => (
                    <div
                      key={id}
                      onClickCapture={() => recordQuickCreateUse(id)}
                    >
                      {quickCreateActions[id]}
                    </div>
                  ))}
              </div>
            </SidebarSection>

            <SidebarActiveWorkSection
              projectId={projectId}
              onOpenActivity={() => openAgentPanelTab("activity")}
            />

            <SidebarSection
              id="files"
              label={tSections("files")}
              Icon={FileText}
            >
              <div
                className="-mx-3 min-h-36 max-h-[52vh] overflow-hidden border-y border-border/80 px-1 py-1"
                data-testid="sidebar-tree-region"
              >
                <ProjectTree projectId={projectId} workspaceSlug={wsSlug} />
              </div>
            </SidebarSection>

            <SidebarSection
              id="favorites"
              label={tSections("favorites")}
              Icon={Star}
            >
              <SidebarFavorites wsSlug={wsSlug} />
            </SidebarSection>

            <SidebarSection
              id="recent"
              label={tSections("recent")}
              Icon={Newspaper}
            >
              <SidebarRecentNotes wsSlug={wsSlug} />
            </SidebarSection>

            <SidebarSection
              id="project_tools"
              label={tSections("project_tools")}
              Icon={Network}
            >
              <div className="grid gap-1">
                <SidebarNavLink
                  href={urls.workspace.projectGraph(locale, wsSlug, projectId)}
                  label={tNav("graph")}
                  Icon={Network}
                  tone="utility"
                />
                <SidebarNavLink
                  href={urls.workspace.projectLearn(locale, wsSlug, projectId)}
                  label={tNav("learn")}
                  Icon={GraduationCap}
                  tone="utility"
                />
                <SidebarNavLink
                  href={urls.workspace.projectAgents(locale, wsSlug, projectId)}
                  label={tNav("agents")}
                  Icon={Bot}
                  tone="utility"
                />
                {deepResearchEnabled ? (
                  <SidebarNavLink
                    href={`${base}/research`}
                    label={tNav("research")}
                    Icon={Search}
                    tone="utility"
                  />
                ) : null}
                <LiteratureSearchButton wsSlug={wsSlug} />
              </div>
            </SidebarSection>
          </>
        ) : (
          <SidebarEmptyState />
        )}

        <div
          aria-hidden
          className="pointer-events-none sticky bottom-[-2rem] -mx-3 mt-2 h-10 bg-gradient-to-t from-background via-background/80 to-transparent"
        />
      </div>
      <SidebarFooter />
    </aside>
  );
}

function SidebarActiveWorkSection({
  projectId,
  onOpenActivity,
}: {
  projectId: string;
  onOpenActivity: () => void;
}) {
  const tSections = useTranslations("sidebar.sections");
  const query = useQuery({
    queryKey: ["sidebar-active-work", projectId],
    queryFn: () => workflowConsoleApi.list(projectId, 5),
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((run) => !TERMINAL_RUN_STATUSES.has(run.status))
        ? 5000
        : false;
    },
  });
  const activeRuns = (query.data?.runs ?? []).filter(
    (run) => !TERMINAL_RUN_STATUSES.has(run.status),
  );

  if (activeRuns.length === 0) return null;

  return (
    <SidebarSection
      id="active_work"
      label={tSections("active_work")}
      Icon={CircleDot}
    >
      <div className="grid gap-1">
        {activeRuns.slice(0, 3).map((run) => (
          <SidebarActiveRunRow
            key={run.runId}
            run={run}
            onOpenActivity={onOpenActivity}
          />
        ))}
      </div>
    </SidebarSection>
  );
}

function SidebarActiveRunRow({
  run,
  onOpenActivity,
}: {
  run: WorkflowConsoleRun;
  onOpenActivity: () => void;
}) {
  const progress = activeRunProgress(run);
  return (
    <button
      type="button"
      aria-label={run.title}
      onClick={onOpenActivity}
      className="rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:border-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {run.title}
        </span>
        {progress != null ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {progress}%
          </span>
        ) : null}
      </div>
      {progress != null ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </button>
  );
}

function activeRunProgress(run: WorkflowConsoleRun): number | null {
  if (!run.progress) return null;
  if (typeof run.progress.percent === "number") {
    return Math.max(0, Math.min(100, Math.round(run.progress.percent)));
  }
  if (
    typeof run.progress.current === "number" &&
    typeof run.progress.total === "number" &&
    run.progress.total > 0
  ) {
    return Math.max(
      0,
      Math.min(
        100,
        Math.round((run.progress.current / run.progress.total) * 100),
      ),
    );
  }
  return null;
}

function SidebarSection({
  id,
  label,
  Icon,
  children,
}: {
  id: string;
  label: string;
  Icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
}) {
  const isCollapsed = useSidebarStore((s) => s.isSectionCollapsed(id));
  const toggleSectionCollapsed = useSidebarStore(
    (s) => s.toggleSectionCollapsed,
  );
  return (
    <section className="mt-4 border-t border-border pt-3 first:mt-3">
      <h2 className="mb-2">
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => toggleSectionCollapsed(id)}
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs font-semibold text-foreground/85 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Icon ? (
            <Icon
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown
            aria-hidden
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${
              isCollapsed ? "-rotate-90" : ""
            }`}
          />
        </button>
      </h2>
      {isCollapsed ? null : children}
    </section>
  );
}

function SidebarNavLink({
  href,
  label,
  Icon,
  tone = "primary",
}: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "primary" | "utility" | "agent";
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tone === "agent"
          ? "border border-border/80 bg-background text-foreground shadow-sm hover:border-foreground hover:bg-muted"
          : tone === "utility"
            ? "border border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
            : "border border-border bg-background text-foreground hover:border-foreground"
      }`}
    >
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate leading-none">{label}</span>
    </Link>
  );
}

function PanelIconButton({
  label,
  Icon,
  onClick,
  active = false,
}: {
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-active={active || undefined}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:border-foreground data-[active=true]:text-foreground"
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

function ProjectToolsMenu({
  base,
  compact = false,
  synthesisExportEnabled,
}: {
  base: string;
  compact?: boolean;
  synthesisExportEnabled: boolean;
}) {
  const t = useTranslations("sidebar.nav");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("more_aria")}
        className={
          compact
            ? "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "flex min-h-8 items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
      >
        <MoreHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {compact ? null : (
          <span className="min-w-0 flex-1 truncate">{t("more_aria")}</span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] rounded-md border border-border bg-background p-2 shadow-sm ring-0"
      >
        <MoreMenu base={base} synthesisExportEnabled={synthesisExportEnabled} />
      </PopoverContent>
    </Popover>
  );
}
