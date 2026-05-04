"use client";
import { useTranslations } from "next-intl";
import { useLegacyProjectTree } from "@/hooks/use-legacy-project-tree";
import { FolderTree } from "./FolderTree";
import { NewCanvasButton } from "./NewCanvasButton";
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
  const tree = useLegacyProjectTree(projectId);

  return (
    <aside
      data-testid="sidebar"
      data-project-id={projectId}
      className="flex max-h-[42vh] w-full shrink-0 flex-col border-b border-border bg-card lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r"
    >
      <header className="border-b border-border p-4">
        <p className="text-xs text-fg-muted uppercase tracking-wide">
          {workspaceSlug}
        </p>
        <h2 className="text-sm font-semibold text-fg mt-1 truncate">
          {projectName}
        </h2>
      </header>
      <div className="space-y-1 p-2">
        <NewNoteButton workspaceSlug={workspaceSlug} projectId={projectId} />
        <NewCanvasButton workspaceSlug={workspaceSlug} projectId={projectId} />
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
