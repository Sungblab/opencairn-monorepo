"use client";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { GlobalNav } from "./global-nav";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { useCurrentProjectContext } from "./use-current-project";
import { ProjectGraphLink } from "./project-graph-link";
import { ProjectAgentsLink } from "./project-agents-link";
import { ProjectLearnLink } from "./project-learn-link";
import { NewNoteButton } from "./NewNoteButton";
import { ProjectListSection } from "./project-list-section";

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
}: ShellSidebarProps) {
  const { wsSlug, projectId } = useCurrentProjectContext();

  return (
    <aside
      data-testid="app-shell-sidebar"
      className="flex h-full min-h-0 flex-col border-r border-border bg-background"
    >
      <WorkspaceSwitcher />
      {wsSlug ? (
        <GlobalNav
          wsSlug={wsSlug}
          deepResearchEnabled={deepResearchEnabled}
        />
      ) : null}
      {wsSlug ? <ProjectListSection /> : null}
      <ScopedSearch />
      {projectId && wsSlug ? (
        <div className="mx-3 mb-3 border-y border-border py-1.5">
          <ProjectGraphLink />
          <ProjectAgentsLink />
          <ProjectLearnLink />
        </div>
      ) : null}
      {projectId && wsSlug ? (
        <>
          <div className="px-3 pb-2">
            <NewNoteButton workspaceSlug={wsSlug} projectId={projectId} />
          </div>
          <ProjectTree projectId={projectId} />
        </>
      ) : (
        <div className="min-h-0 flex-1" />
      )}
      <SidebarFooter />
    </aside>
  );
}
