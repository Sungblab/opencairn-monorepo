"use client";
import { urls } from "@/lib/urls";
import { useEffect, useRef } from "react";
import type { NodeRendererProps } from "react-arborist";
import { ChevronRight, Folder, FileText, FileCode, FileImage, FileJson, FolderCode } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useLocale } from "next-intl";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useTabsStore } from "@/stores/tabs-store";
import { newTab } from "@/lib/tab-factory";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from "@/components/ui/context-menu";
import { TreeContextMenuItems } from "./tree-context-menu";
import { useProjectTreeCtx } from "./project-tree-context";

// react-arborist's row renderer. Combines:
// - expand/collapse on folders (chevron + row click)
// - open-in-tab on notes (router.push, tabs store activation)
// - inline rename via a controlled <input> when this row is the "renaming"
//   target (Enter commits, Escape cancels, blur commits)
// - right-click context menu wrapping the whole row element
//
// Deliberately doesn't `stopPropagation` on chevron handlers so arborist's
// keyboard API keeps working for expand/collapse.
export function ProjectTreeNode({
  node,
  style,
  dragHandle,
}: NodeRendererProps<TreeNode>) {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const locale = useLocale();
  const router = useRouter();
  const ctx = useProjectTreeCtx();

  const kind = node.data.kind;
  const hasChildren = kind === "folder" && node.data.child_count > 0;
  const isRenaming = ctx.renamingId === node.data.id;

  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a stray onBlur re-commit after the user pressed Escape:
  // Escape flips the flag, onCommitRename(null) unmounts the input, and any
  // racing blur event from the same tick sees `skipBlur` and bails.
  const skipBlurRef = useRef(false);
  useEffect(() => {
    if (isRenaming) {
      skipBlurRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  function handleRowClick() {
    if (isRenaming) return;
    if (kind === "folder") {
      node.toggle();
      return;
    }
    if (kind === "agent_file") {
      const tabs = useTabsStore.getState();
      const existing = tabs.findTabByTarget("agent_file", node.data.id);
      if (existing) {
        tabs.setActive(existing.id);
        return;
      }
      tabs.addTab(
        newTab({
          kind: "agent_file",
          targetId: node.data.id,
          title: node.data.label,
          mode: "agent-file",
          preview: false,
        }),
      );
      return;
    }
    if (kind === "code_workspace") {
      const tabs = useTabsStore.getState();
      const existing = tabs.findTabByTarget("code_workspace", node.data.id);
      if (existing) {
        tabs.setActive(existing.id);
        return;
      }
      tabs.addTab(
        newTab({
          kind: "code_workspace",
          targetId: node.data.id,
          title: node.data.label,
          mode: "code-workspace",
          preview: false,
        }),
      );
      return;
    }
    const tabs = useTabsStore.getState();
    const existing = tabs.findTabByTarget("note", node.data.id);
    if (existing) tabs.setActive(existing.id);
    router.push(urls.workspace.note(locale, wsSlug, node.data.id));
  }

  function handleRowDoubleClick() {
    ctx.onStartRename(node.data.id);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "F2") {
      e.preventDefault();
      ctx.onStartRename(node.data.id);
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={dragHandle}
            style={style}
            role="treeitem"
            tabIndex={-1}
            aria-level={node.level + 1}
            aria-expanded={kind === "folder" ? node.isOpen : undefined}
            data-kind={kind}
            data-id={node.data.id}
            data-renaming={isRenaming || undefined}
            onClick={handleRowClick}
            onDoubleClick={handleRowDoubleClick}
            onKeyDown={handleRowKeyDown}
            className="group flex cursor-pointer items-center gap-1 rounded px-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted"
          />
        }
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
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
          />
        ) : kind === "agent_file" ? (
          <AgentFileIcon
            fileKind={node.data.file_kind}
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        ) : kind === "code_workspace" ? (
          <FolderCode
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        ) : (
          <FileText
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        )}
        {isRenaming ? (
          <input
            ref={inputRef}
            defaultValue={node.data.label}
            className="flex-1 rounded bg-transparent px-0.5 text-sm text-foreground outline-none ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                skipBlurRef.current = true;
                ctx.onCommitRename(
                  node.data.id,
                  kind,
                  e.currentTarget.value.trim(),
                );
              } else if (e.key === "Escape") {
                e.preventDefault();
                skipBlurRef.current = true;
                ctx.onCommitRename(node.data.id, kind, null);
              }
            }}
            onBlur={(e) => {
              if (skipBlurRef.current) return;
              ctx.onCommitRename(
                node.data.id,
                kind,
                e.currentTarget.value.trim(),
              );
            }}
          />
        ) : (
          <span className="flex-1 truncate">{node.data.label}</span>
        )}
        {hasChildren && !isRenaming ? (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {node.data.child_count}
          </span>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <TreeContextMenuItems
          onRename={() => ctx.onStartRename(node.data.id)}
          onDelete={() =>
            ctx.onDelete(node.data.id, kind, node.data.label)
          }
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AgentFileIcon({
  fileKind,
  className,
}: {
  fileKind?: string | null;
  className: string;
}) {
  if (fileKind === "code" || fileKind === "html" || fileKind === "latex") {
    return <FileCode aria-hidden className={className} />;
  }
  if (fileKind === "image") return <FileImage aria-hidden className={className} />;
  if (fileKind === "json" || fileKind === "csv") {
    return <FileJson aria-hidden className={className} />;
  }
  return <FileText aria-hidden className={className} />;
}
