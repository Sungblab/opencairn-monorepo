"use client";
import { urls } from "@/lib/urls";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NodeRendererProps } from "react-arborist";
import {
  ChevronRight,
  Folder,
  FileText,
  FileCode,
  FileImage,
  FileJson,
  FolderCode,
  MoreHorizontal,
} from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
  const t = useTranslations("sidebar.tree_menu");
  const router = useRouter();
  const ctx = useProjectTreeCtx();

  const kind = node.data.kind;
  const hasChildren = kind === "folder" && node.data.child_count > 0;
  const isRenaming = ctx.renamingId === node.data.id;

  const inputRef = useRef<HTMLInputElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
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

  useEffect(() => {
    if (!actionMenuPos) return;
    function closeOnPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (
        target &&
        (actionMenuRef.current?.contains(target) ||
          actionButtonRef.current?.contains(target))
      ) {
        return;
      }
      setActionMenuPos(null);
    }
    function closeOnKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActionMenuPos(null);
    }
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("resize", closeActionMenu);
    window.addEventListener("scroll", closeActionMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("resize", closeActionMenu);
      window.removeEventListener("scroll", closeActionMenu, true);
    };
  }, [actionMenuPos]);

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

  function nodeHref() {
    if (kind === "note") return urls.workspace.note(locale, wsSlug, node.data.id);
    return null;
  }

  function copyLink() {
    const href = nodeHref();
    if (!href || typeof navigator === "undefined") return;
    const origin =
      typeof window === "undefined" ? "" : window.location.origin;
    void navigator.clipboard?.writeText(`${origin}${href}`);
  }

  function closeActionMenu() {
    setActionMenuPos(null);
  }

  function toggleActionMenu(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (actionMenuPos) {
      closeActionMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 208;
    const menuHeight = 156;
    const gap = 6;
    const left = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
    );
    const top =
      rect.bottom + menuHeight + gap <= window.innerHeight
        ? rect.bottom + gap
        : Math.max(8, rect.top - menuHeight - gap);
    setActionMenuPos({ top, left });
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
            className="group flex h-full min-h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-sm text-foreground transition-colors hover:bg-muted/70 focus-visible:bg-muted data-[drop-target=true]:bg-muted"
          />
        }
      >
        {hasChildren ? (
          <ChevronRight
            aria-hidden
            data-testid="tree-chevron"
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${node.isOpen ? "rotate-90" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              node.toggle();
            }}
          />
        ) : (
          <span aria-hidden className="h-3.5 w-3.5 shrink-0" />
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
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground group-hover:hidden">
            {node.data.child_count}
          </span>
        ) : null}
        {!isRenaming ? (
          <>
            <button
              ref={actionButtonRef}
              aria-label={t("row_actions")}
              type="button"
              onClick={toggleActionMenu}
              className="ml-auto hidden h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-background hover:text-foreground group-hover:grid focus-visible:grid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
            </button>
            {actionMenuPos && typeof document !== "undefined"
              ? createPortal(
                  <div
                    ref={actionMenuRef}
                    data-testid="tree-row-action-menu"
                    className="fixed z-50 w-52 rounded-[var(--radius-control)] bg-popover p-1.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
                    style={{
                      top: actionMenuPos.top,
                      left: actionMenuPos.left,
                    }}
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-9 w-full items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-left outline-none hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        closeActionMenu();
                        ctx.onStartRename(node.data.id);
                      }}
                    >
                      <span className="flex-1">{t("rename")}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {t("rename_shortcut")}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-9 w-full items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-left outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                      disabled={!nodeHref()}
                      onClick={() => {
                        closeActionMenu();
                        copyLink();
                      }}
                    >
                      {t("copy_link")}
                    </button>
                    <div className="-mx-1.5 my-1 h-px bg-border" />
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-9 w-full items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-left text-destructive outline-none hover:bg-destructive/10"
                      onClick={() => {
                        closeActionMenu();
                        ctx.onDelete(node.data.id, kind, node.data.label);
                      }}
                    >
                      <span className="flex-1">{t("delete")}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {t("delete_shortcut")}
                      </span>
                    </button>
                  </div>,
                  document.body,
                )
              : null}
          </>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52 rounded-[var(--radius-control)] p-1.5 shadow-lg">
        <TreeContextMenuItems
          onRename={() => ctx.onStartRename(node.data.id)}
          onCopyLink={copyLink}
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
