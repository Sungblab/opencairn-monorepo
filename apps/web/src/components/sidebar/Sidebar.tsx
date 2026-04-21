"use client";
import { useTranslations } from "next-intl";
import { useProjectTree } from "@/hooks/use-project-tree";
import { FolderTree } from "./FolderTree";
import { NewNoteButton } from "./NewNoteButton";

export function Sidebar({
  workspaceSlug,
  projectId,
  projectName,
}: {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations("sidebar");
  const tree = useProjectTree(projectId);

  return (
    <aside
      data-testid="sidebar"
      data-project-id={projectId}
      className="w-64 shrink-0 border-r border-border bg-card flex flex-col"
    >
      <header className="p-4 border-b border-border">
        <p className="text-xs text-fg-muted uppercase tracking-wide">
          {workspaceSlug}
        </p>
        <h2 className="text-sm font-semibold text-fg mt-1 truncate">
          {projectName}
        </h2>
      </header>
      <div className="p-2">
        <NewNoteButton workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tree.isLoading ? (
          <p className="text-xs text-fg-muted">{t("loading")}</p>
        ) : tree.notes.length === 0 && tree.folders.length === 0 ? (
          <p className="text-xs text-fg-muted">{t("empty_project")}</p>
        ) : (
          <FolderTree
            folders={tree.folders}
            notes={tree.notes}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
          />
        )}
      </div>
    </aside>
  );
}
