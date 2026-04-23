"use client";
import type { NodeRendererProps } from "react-arborist";
import { ChevronRight, Folder, FileText } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useLocale } from "next-intl";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useTabsStore } from "@/stores/tabs-store";

// react-arborist's row renderer. The chevron handles expand/collapse on
// folders; a row click on a note opens (or activates) a tab, matching the
// Phase 2 spec §4.4 behavior. Deliberately doesn't `stopPropagation` on the
// chevron pointer handlers so arborist's keyboard API keeps working.
export function ProjectTreeNode({
  node,
  style,
  dragHandle,
}: NodeRendererProps<TreeNode>) {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const locale = useLocale();
  const router = useRouter();

  const kind = node.data.kind;
  const hasChildren = kind === "folder" && node.data.child_count > 0;

  function handleRowClick() {
    if (kind === "folder") {
      node.toggle();
      return;
    }
    const tabs = useTabsStore.getState();
    const existing = tabs.findTabByTarget("note", node.data.id);
    if (existing) tabs.setActive(existing.id);
    router.push(`/${locale}/app/w/${wsSlug}/n/${node.data.id}`);
  }

  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      aria-level={node.level + 1}
      aria-expanded={kind === "folder" ? node.isOpen : undefined}
      data-kind={kind}
      data-id={node.data.id}
      onClick={handleRowClick}
      className="flex cursor-pointer items-center gap-1 rounded px-1 text-sm text-foreground transition-colors hover:bg-accent"
    >
      {hasChildren ? (
        <ChevronRight
          aria-hidden
          data-testid="tree-chevron"
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${node.isOpen ? "rotate-90" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
          }}
        />
      ) : (
        <span aria-hidden className="h-3 w-3 shrink-0" />
      )}
      {kind === "folder" ? (
        <Folder
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
      ) : (
        <FileText
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
      )}
      <span className="flex-1 truncate">{node.data.label}</span>
      {hasChildren ? (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {node.data.child_count}
        </span>
      ) : null}
    </div>
  );
}
