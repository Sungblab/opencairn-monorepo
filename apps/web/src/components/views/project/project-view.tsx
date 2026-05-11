"use client";

import { urls } from "@/lib/urls";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { projectsApi, type ProjectNoteRow } from "@/lib/api-client";
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

  function openDocumentPreset(presetId: DocumentGenerationPresetId) {
    requestDocumentGenerationPreset(presetId);
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
