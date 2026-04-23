"use client";
import { useTranslations } from "next-intl";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

export interface TreeContextMenuItemsProps {
  onRename(): void;
  onDelete(): void;
  onDuplicate?(): void;
  onCopyLink?(): void;
}

// Items-only fragment. Callers are expected to compose the surrounding
// <ContextMenu>/<ContextMenuTrigger>/<ContextMenuContent> so they can attach
// the trigger directly to a row element (avoids an extra wrapper div that
// would break react-arborist's dragHandle ref chain). Duplicate and copy-link
// disable themselves when their handlers aren't provided.
export function TreeContextMenuItems({
  onRename,
  onDelete,
  onDuplicate,
  onCopyLink,
}: TreeContextMenuItemsProps) {
  const t = useTranslations("sidebar.tree_menu");
  return (
    <>
      <ContextMenuItem onClick={onRename}>
        <span className="flex-1">{t("rename")}</span>
        <span className="text-[10px] text-muted-foreground">
          {t("rename_shortcut")}
        </span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onDuplicate} disabled={!onDuplicate}>
        {t("duplicate")}
      </ContextMenuItem>
      <ContextMenuItem onClick={onCopyLink} disabled={!onCopyLink}>
        {t("copy_link")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <span className="flex-1">{t("delete")}</span>
        <span className="text-[10px] text-muted-foreground">
          {t("delete_shortcut")}
        </span>
      </ContextMenuItem>
    </>
  );
}
