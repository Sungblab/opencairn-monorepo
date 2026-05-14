"use client";
import { useTranslations } from "next-intl";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { TreeNode } from "@/hooks/use-project-tree";

export interface TreeContextMenuItemsProps {
  kind: TreeNode["kind"];
  deleteShortcut: string;
  onRename(): void;
  onDelete(): void;
  onCreateNote?(): void;
  onCreateFolder?(): void;
  onDuplicate?(): void;
  onOpenToRight?(): void;
  onPaperAnalysis?(): void;
  onCopyLink?(): void;
  onFavorite?(): void;
}

// Items-only fragment. Callers are expected to compose the surrounding
// <ContextMenu>/<ContextMenuTrigger>/<ContextMenuContent> so they can attach
// the trigger directly to a row element (avoids an extra wrapper div that
// would break react-arborist's dragHandle ref chain). Duplicate and copy-link
// disable themselves when their handlers aren't provided.
export function TreeContextMenuItems({
  kind,
  deleteShortcut,
  onRename,
  onDelete,
  onCreateNote,
  onCreateFolder,
  onDuplicate,
  onOpenToRight,
  onPaperAnalysis,
  onCopyLink,
  onFavorite,
}: TreeContextMenuItemsProps) {
  const t = useTranslations("sidebar.tree_menu");
  return (
    <>
      <ContextMenuItem
        className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
        onClick={onRename}
      >
        <span className="flex-1">{t("rename")}</span>
        <span className="text-[10px] text-muted-foreground">
          {t("rename_shortcut")}
        </span>
      </ContextMenuItem>
      <ContextMenuItem
        className="min-h-9 rounded-[var(--radius-control)] px-3"
        onClick={onDuplicate}
        disabled={!onDuplicate}
      >
        {t("duplicate")}
      </ContextMenuItem>
      {onCreateNote ? (
        <ContextMenuItem
          className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
          onClick={onCreateNote}
        >
          {t("new_child_page")}
        </ContextMenuItem>
      ) : null}
      {kind === "folder" ? (
        <ContextMenuItem
          className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
          onClick={onCreateFolder}
        >
          {t("new_subfolder")}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
        onClick={onOpenToRight}
        disabled={!onOpenToRight}
      >
        {t("open_to_right")}
      </ContextMenuItem>
      {onPaperAnalysis ? (
        <ContextMenuItem
          className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
          onClick={onPaperAnalysis}
        >
          {t("paper_analysis")}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
        onClick={onCopyLink}
        disabled={!onCopyLink}
      >
        {t("copy_link")}
      </ContextMenuItem>
      <ContextMenuItem
        className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
        onClick={onFavorite}
        disabled={!onFavorite}
      >
        {t("favorite")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5"
        variant="destructive"
        onClick={onDelete}
      >
        <span className="flex-1">{t("delete")}</span>
        <span className="text-[10px] text-muted-foreground">
          {deleteShortcut}
        </span>
      </ContextMenuItem>
    </>
  );
}
