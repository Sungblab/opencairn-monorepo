"use client";
import type { ComponentType, ReactNode } from "react";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  ExternalLink,
  FileText,
  GraduationCap,
  HelpCircle,
  Home,
  MessageSquare,
  MoreHorizontal,
  Network,
  Newspaper,
  Plus,
  Search,
  Settings,
  Share2,
  Star,
  Trash2,
  Wrench,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TrashTab,
  TrashTabSkeleton,
} from "@/components/views/workspace-settings/trash-tab";

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
  const tTrash = useTranslations("workspaceSettings.trash");
  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);
  const setSidebarWorkspace = useSidebarStore((s) => s.setWorkspace);
  const quickCreateOrder = useSidebarStore((s) => s.quickCreateOrder);
  const recordQuickCreateUse = useSidebarStore((s) => s.recordQuickCreateUse);
  const base = wsSlug ? urls.workspace.root(locale, wsSlug) : null;
  const [trashOpen, setTrashOpen] = useState(false);
  const workspaces = useQuery({
    queryKey: ["workspaces", "me"],
    enabled: Boolean(wsSlug),
    queryFn: async (): Promise<{
      workspaces: { id: string; slug: string; name: string }[];
    }> => {
      const res = await fetch("/api/workspaces/me", { credentials: "include" });
      if (!res.ok) throw new Error(`workspaces/me ${res.status}`);
      return (await res.json()) as {
        workspaces: { id: string; slug: string; name: string }[];
      };
    },
    staleTime: 30_000,
  });
  const workspaceId = useMemo(
    () => workspaces.data?.workspaces.find((w) => w.slug === wsSlug)?.id ?? null,
    [workspaces.data?.workspaces, wsSlug],
  );
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
      <div className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <ScopedSearch />
        {base && wsSlug ? (
          <div className="mt-2 grid grid-cols-[minmax(0,1.2fr)_repeat(4,2rem)] items-center gap-1.5">
            <SidebarNavLink
              href={
                projectId
                  ? urls.workspace.project(locale, wsSlug, projectId)
                  : base
              }
              label={
                projectId
                  ? tNav("project_home_short")
                  : tNav("dashboard_short")
              }
              Icon={Home}
            />
            <PanelIconButton
              label={tNav("chat")}
              Icon={MessageSquare}
              onClick={() => openAgentPanelTab("chat")}
            />
            <PanelIconButton
              label={tNav("tools")}
              Icon={Wrench}
              onClick={() => openAgentPanelTab("tools")}
            />
            <PanelIconButton
              label={tNav("notifications")}
              Icon={Bell}
              onClick={() => openAgentPanelTab("notifications")}
            />
            <ProjectToolsMenu
              base={base}
              compact
              synthesisExportEnabled={synthesisExportEnabled}
              onOpenTrash={() => setTrashOpen(true)}
            />
          </div>
        ) : null}

        {projectId && wsSlug ? (
          <>
            <SidebarSection id="create" label={tSections("create")} Icon={Plus}>
              <div
                className="grid grid-cols-2 gap-1 rounded-md border border-border/70 bg-background p-1 shadow-none [&_button]:min-h-8 [&_button]:rounded-md [&_button]:border-transparent [&_button]:bg-transparent [&_button]:px-2 [&_button]:text-xs [&_button]:hover:bg-muted"
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
              id="favorites"
              label={tSections("favorites")}
              Icon={Star}
            >
              <SidebarFavorites wsSlug={wsSlug} />
            </SidebarSection>

            <SidebarSection id="files" label={tSections("files")} Icon={FileText}>
              <div
                className="h-[52vh] min-h-80 max-h-[680px] overflow-hidden rounded-md border border-border bg-background shadow-none"
                data-testid="sidebar-tree-region"
              >
                <ProjectTree projectId={projectId} workspaceSlug={wsSlug} />
              </div>
            </SidebarSection>

            <SidebarSection
              id="recent"
              label={tSections("recent")}
              Icon={Newspaper}
            >
              <SidebarRecentNotes wsSlug={wsSlug} />
            </SidebarSection>

            <SidebarSection
              id="service_agent"
              label={tSections("service_agent")}
              Icon={Bot}
            >
              <div className="grid gap-1">
                <SidebarNavLink
                  href={urls.workspace.projectAgents(locale, wsSlug, projectId)}
                  label={tNav("agents")}
                  Icon={Bot}
                  tone="agent"
                />
                {deepResearchEnabled ? (
                  <SidebarNavLink
                    href={`${base}/research`}
                    label={tNav("research")}
                    Icon={Search}
                    tone="agent"
                  />
                ) : null}
                <LiteratureSearchButton wsSlug={wsSlug} />
              </div>
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
              </div>
            </SidebarSection>
          </>
        ) : (
          <SidebarEmptyState />
        )}

        {base && wsSlug ? (
          <>
            <SidebarSection id="publish" label={tSections("publish")} Icon={Share2}>
              <div className="grid gap-1">
                <SidebarNavLink
                  href={`${base}/settings/shared-links`}
                  label={tNav("public_pages")}
                  Icon={Share2}
                  tone="utility"
                />
                <SidebarNavLink
                  href={`${base}/settings/shared-links`}
                  label={tNav("shared_links")}
                  Icon={Share2}
                  tone="utility"
                />
                {synthesisExportEnabled ? (
                  <SidebarNavLink
                    href={`${base}/synthesis-export`}
                    label={tNav("synthesis_export")}
                    Icon={ExternalLink}
                    tone="utility"
                  />
                ) : null}
              </div>
            </SidebarSection>

            <SidebarSection
              id="workspace_tools"
              label={tSections("workspace_tools")}
              Icon={Wrench}
            >
              <div className="grid gap-1">
                <SidebarNavLink
                  href={`${base}/atlas`}
                  label={tNav("atlas")}
                  Icon={Network}
                  tone="utility"
                />
                <SidebarNavLink
                  href={`${base}/settings`}
                  label={tNav("settings")}
                  Icon={Settings}
                  tone="utility"
                />
                <SidebarNavButton
                  onClick={() => setTrashOpen(true)}
                  label={tNav("trash")}
                  Icon={Trash2}
                  tone="utility"
                />
              </div>
            </SidebarSection>

            <SidebarSection id="help" label={tSections("help")} Icon={HelpCircle}>
              <div className="grid gap-1">
                <SidebarNavLink
                  href={urls.workspace.help(locale, wsSlug)}
                  label={tNav("help")}
                  Icon={HelpCircle}
                  tone="utility"
                />
                <SidebarNavLink
                  href={urls.workspace.report(locale, wsSlug)}
                  label={tNav("feedback")}
                  Icon={MessageSquare}
                  tone="utility"
                />
                <SidebarExternalLink
                  href="/changelog"
                  label={tNav("changelog")}
                  Icon={Newspaper}
                />
              </div>
            </SidebarSection>
          </>
        ) : null}
      </div>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tTrash("heading")}</DialogTitle>
            <DialogDescription>{tTrash("retention")}</DialogDescription>
          </DialogHeader>
          {workspaceId ? (
            <TrashTab wsId={workspaceId} showHeader={false} />
          ) : !workspaces.isError ? (
            <TrashTabSkeleton />
          ) : (
            <p className="text-sm text-destructive">{tTrash("loadFailed")}</p>
          )}
        </DialogContent>
      </Dialog>
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
      Math.min(100, Math.round((run.progress.current / run.progress.total) * 100)),
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
    <section className="mt-4 border-t border-border/70 pt-3">
      <h2 className="mb-2">
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => toggleSectionCollapsed(id)}
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Icon ? <Icon aria-hidden className="h-3.5 w-3.5" /> : null}
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

function SidebarNavButton({
  onClick,
  label,
  Icon,
  tone = "primary",
}: {
  onClick: () => void;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "primary" | "utility";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tone === "utility"
          ? "border border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
          : "border border-border bg-background text-foreground hover:border-foreground"
      }`}
    >
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function SidebarExternalLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ExternalLink
        aria-hidden
        className="h-3 w-3 shrink-0 text-muted-foreground/70"
      />
    </a>
  );
}

function PanelIconButton({
  label,
  Icon,
  onClick,
}: {
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

function ProjectToolsMenu({
  base,
  compact = false,
  synthesisExportEnabled,
  onOpenTrash,
}: {
  base: string;
  compact?: boolean;
  synthesisExportEnabled: boolean;
  onOpenTrash: () => void;
}) {
  const t = useTranslations("sidebar.nav");
  const [open, setOpen] = useState(false);
  const openTrash = () => {
    setOpen(false);
    onOpenTrash();
  };

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
        <MoreMenu
          base={base}
          synthesisExportEnabled={synthesisExportEnabled}
          onOpenTrash={openTrash}
        />
      </PopoverContent>
    </Popover>
  );
}
