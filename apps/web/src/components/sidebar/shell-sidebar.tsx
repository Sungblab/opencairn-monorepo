"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  ChevronLeft,
  DownloadCloud,
  FlaskConical,
  Home,
  MoreHorizontal,
} from "lucide-react";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { useCurrentProjectContext } from "./use-current-project";
import { ProjectGraphLink } from "./project-graph-link";
import { ProjectAgentsLink } from "./project-agents-link";
import { ProjectLearnLink } from "./project-learn-link";
import { NewNoteButton } from "./NewNoteButton";
import { NewCanvasButton } from "./NewCanvasButton";
import { NewCodeWorkspaceButton } from "./NewCodeWorkspaceButton";
import { GenerateDocumentButton } from "./GenerateDocumentButton";
import { ProjectHero } from "./project-hero";
import { MoreMenu } from "./more-menu";
import { SidebarEmptyState } from "./sidebar-empty-state";
import { LiteratureSearchButton } from "@/components/literature/literature-search-button";
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
  deepResearchEnabled,
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
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
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
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <SidebarToolLink href={base} label={tNav("dashboard")} Icon={Home} />
            {deepResearchEnabled ? (
              <SidebarToolLink
                href={urls.workspace.research(locale, wsSlug)}
                label={tNav("research")}
                Icon={FlaskConical}
              />
            ) : null}
            <SidebarToolLink
              href={urls.workspace.import(locale, wsSlug)}
              label={tNav("import")}
              Icon={DownloadCloud}
            />
            <LiteratureSearchButton wsSlug={wsSlug} />
            {projectId ? (
              <>
                <ProjectGraphLink />
                <ProjectAgentsLink />
                <SidebarToolLink
                  href={`${urls.workspace.projectAgents(locale, wsSlug, projectId)}?view=runs#workflow-console`}
                  label={tNav("runs")}
                  Icon={Activity}
                />
                <ProjectLearnLink />
              </>
            ) : null}
            <ProjectToolsMenu
              base={base}
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </div>
        ) : null}
      </div>
      {projectId && wsSlug ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 px-3 py-2">
            <NewNoteButton workspaceSlug={wsSlug} projectId={projectId} />
            <NewCanvasButton workspaceSlug={wsSlug} projectId={projectId} />
            <NewCodeWorkspaceButton projectId={projectId} />
            <GenerateDocumentButton wsSlug={wsSlug} projectId={projectId} />
          </div>
          <ProjectTree projectId={projectId} />
        </>
      ) : (
        <SidebarEmptyState />
      )}
      <SidebarFooter />
    </aside>
  );
}

function SidebarToolLink({
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
      className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}

function ProjectToolsMenu({
  base,
  synthesisExportEnabled,
}: {
  base: string;
  synthesisExportEnabled: boolean;
}) {
  const t = useTranslations("sidebar.nav");

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("more_aria")}
        className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("more_aria")}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] rounded-[var(--radius-control)] border border-border bg-background p-2 shadow-sm ring-0"
      >
        <MoreMenu
          base={base}
          synthesisExportEnabled={synthesisExportEnabled}
        />
      </PopoverContent>
    </Popover>
  );
}
