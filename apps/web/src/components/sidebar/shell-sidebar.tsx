"use client";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { GlobalNav } from "./global-nav";
import { ProjectHero } from "./project-hero";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarEmptyState } from "./sidebar-empty-state";
import { useCurrentProjectContext } from "./use-current-project";
import { ProjectGraphLink } from "./project-graph-link";
import { ProjectAgentsLink } from "./project-agents-link";
import { ProjectLearnLink } from "./project-learn-link";

export interface ShellSidebarProps {
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
}

// App Shell Phase 2 assembled sidebar (distinct from the legacy
// project-scoped `Sidebar` that still layouts the editor page). Stacks the
// six Phase 2 subcomponents in spec order; the tree slot renders either
// <ProjectTree> or the empty-state CTA depending on whether the URL has an
// active projectId. The testid matches what Phase 1's e2e already watches.
export function ShellSidebar({
  deepResearchEnabled,
  synthesisExportEnabled = false,
}: ShellSidebarProps) {
  const { wsSlug, projectId } = useCurrentProjectContext();

  return (
    <aside
      data-testid="app-shell-sidebar"
      className="flex h-full min-h-0 flex-col border-r border-border bg-[var(--theme-surface)]"
    >
      <WorkspaceSwitcher />
      {wsSlug ? (
        <GlobalNav
          wsSlug={wsSlug}
          deepResearchEnabled={deepResearchEnabled}
          synthesisExportEnabled={synthesisExportEnabled}
        />
      ) : null}
      <ProjectHero />
      <ScopedSearch />
      <ProjectGraphLink />
      <ProjectAgentsLink />
      <ProjectLearnLink />
      {projectId ? (
        <ProjectTree projectId={projectId} />
      ) : (
        <SidebarEmptyState />
      )}
      <SidebarFooter />
    </aside>
  );
}
