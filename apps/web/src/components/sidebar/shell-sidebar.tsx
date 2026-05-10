"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, Home, MoreHorizontal } from "lucide-react";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { useCurrentProjectContext } from "./use-current-project";
import { NewNoteButton } from "./NewNoteButton";
import { NewFolderButton } from "./NewFolderButton";
import { NewCanvasButton } from "./NewCanvasButton";
import { NewCodeWorkspaceButton } from "./NewCodeWorkspaceButton";
import { ProjectHero } from "./project-hero";
import { MoreMenu } from "./more-menu";
import { SidebarEmptyState } from "./sidebar-empty-state";
import { usePanelStore } from "@/stores/panel-store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ShellSidebarProps {
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
}

// App Shell Phase 2 assembled sidebar (distinct from the legacy
// project-scoped `Sidebar` that still layouts the editor page). The sidebar
// keeps workspace navigation and project navigation as separate outline blocks.
// The testid matches what Phase 1's e2e already watches.
export function ShellSidebar({
  synthesisExportEnabled = false,
}: ShellSidebarProps) {
  const { wsSlug, projectId } = useCurrentProjectContext();
  const locale = useLocale();
  const tNav = useTranslations("sidebar.nav");
  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const base = wsSlug ? urls.workspace.root(locale, wsSlug) : null;

  return (
    <aside
      data-testid="app-shell-sidebar"
      className="flex h-full min-h-0 flex-col border-r border-border bg-background"
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="min-w-0 flex-1">{wsSlug ? <ProjectHero /> : null}</div>
        <button
          type="button"
          aria-label={tNav("collapse_sidebar")}
          onClick={toggleSidebar}
          className="app-btn-ghost grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)]"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-border px-3 py-2">
        <ScopedSearch />
        {base && wsSlug ? (
          <div className="mt-2 flex items-center gap-1.5">
            <SidebarNavLink
              href={
                projectId
                  ? urls.workspace.project(locale, wsSlug, projectId)
                  : base
              }
              label={projectId ? tNav("project_home") : tNav("dashboard")}
              Icon={Home}
            />
            <ProjectToolsMenu
              base={base}
              compact
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </div>
        ) : null}
      </div>
      {projectId && wsSlug ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 px-3 py-2">
            <NewNoteButton workspaceSlug={wsSlug} projectId={projectId} />
            <NewFolderButton projectId={projectId} />
            <NewCanvasButton workspaceSlug={wsSlug} projectId={projectId} />
            <NewCodeWorkspaceButton projectId={projectId} />
          </div>
          <ProjectTree projectId={projectId} workspaceSlug={wsSlug} />
        </>
      ) : (
        <SidebarEmptyState />
      )}
      <SidebarFooter />
    </aside>
  );
}

function SidebarNavLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-xs text-foreground transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
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

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("more_aria")}
        className={
          compact
            ? "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border bg-background text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        className="w-[260px] rounded-[var(--radius-control)] border border-border bg-background p-2 shadow-sm ring-0"
      >
        <MoreMenu base={base} synthesisExportEnabled={synthesisExportEnabled} />
      </PopoverContent>
    </Popover>
  );
}
