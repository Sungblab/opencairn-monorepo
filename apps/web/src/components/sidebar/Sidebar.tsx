"use client";
import { useTranslations } from "next-intl";

// Minimal shell — FolderTree + NewNoteButton land in Task 10.
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
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card">
      <header className="p-4 border-b border-border">
        <p className="text-xs text-fg-muted uppercase tracking-wide">{workspaceSlug}</p>
        <h2 className="text-sm font-semibold text-fg mt-1">{projectName}</h2>
      </header>
      <div className="p-2 text-xs text-fg-muted" data-testid="sidebar-tree-placeholder">
        {t("loading")}
      </div>
      <input type="hidden" data-testid="sidebar-project-id" value={projectId} readOnly />
    </aside>
  );
}
