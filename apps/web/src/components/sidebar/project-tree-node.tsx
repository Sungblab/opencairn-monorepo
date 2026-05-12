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
  FileAudio,
  FileVideo,
  FileSpreadsheet,
  File,
  FolderCode,
  FileArchive,
  MoreHorizontal,
  Plus,
  Star,
} from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useTabsStore } from "@/stores/tabs-store";
import { newTab } from "@/lib/tab-factory";
import { useModKeyLabel } from "@/hooks/use-mod-key-label";
import {
  treeNodeToDragPayload,
  writeProjectTreeDragPayload,
} from "@/lib/project-tree-dnd";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from "@/components/ui/context-menu";
import { TreeContextMenuItems } from "./tree-context-menu";
import { useProjectTreeCtx } from "./project-tree-context";
import { upsertSidebarFavorite } from "./sidebar-favorites-store";

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
  const modKeyLabel = useModKeyLabel();
  const deleteShortcut = `${modKeyLabel}+Del`;

  const kind = node.data.kind;
  if (kind === "empty") {
    const parentId = node.data.parent_id;
    return (
      <button
        style={style}
        type="button"
        role="treeitem"
        tabIndex={-1}
        aria-level={node.level + 1}
        data-kind={kind}
        data-id={node.data.id}
        className="group flex h-full min-h-11 w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-control)] px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        onClick={() => {
          if (parentId) ctx.onCreateNote(parentId);
        }}
      >
        <span aria-hidden className="ml-2 h-4 w-4 shrink-0" />
        <Plus
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{t("new_child_page")}</span>
          <span className="block truncate text-[11px] text-muted-foreground/80">
            {t("empty_drop_hint")}
          </span>
        </span>
      </button>
    );
  }
  const canHaveChildren = new Set([
    "folder",
    "note",
    "source_bundle",
    "artifact_group",
    "code_workspace",
  ]);
  const canExpand = canHaveChildren.has(kind);
  const canCreateChildPage = kind === "folder" || kind === "note";
  const opensOnRowClick = new Set([
    "note",
    "agent_file",
    "source_bundle",
    "code_workspace",
  ]);
  const isRenaming = ctx.renamingId === node.data.id;

  const inputRef = useRef<HTMLInputElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const rowActionsVisible = Boolean(node.isSelected || actionMenuPos);
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
    const targetId = node.data.target_id ?? node.data.id;
    if (canExpand && !opensOnRowClick.has(kind)) {
      node.toggle();
      return;
    }
    if (kind === "agent_file" || kind === "source_bundle") {
      if (!targetId) {
        node.toggle();
        return;
      }
      const tabs = useTabsStore.getState();
      const existing = tabs.findTabByTarget("agent_file", targetId);
      if (existing) {
        tabs.setActive(existing.id);
        return;
      }
      tabs.addTab(
        newTab({
          kind: "agent_file",
          targetId,
          title: node.data.label,
          mode: "agent-file",
          preview: false,
        }),
      );
      return;
    }
    if (kind === "code_workspace") {
      const tabs = useTabsStore.getState();
      const existing = tabs.findTabByTarget("code_workspace", targetId);
      if (existing) {
        tabs.setActive(existing.id);
        return;
      }
      tabs.addTab(
        newTab({
          kind: "code_workspace",
          targetId,
          title: node.data.label,
          mode: "code-workspace",
          preview: false,
        }),
      );
      return;
    }
    const tabs = useTabsStore.getState();
    const existing = tabs.findTabByTarget("note", targetId);
    if (existing) {
      if (existing.title !== node.data.label) {
        tabs.updateTab(existing.id, { title: node.data.label });
      }
      tabs.setActive(existing.id);
    }
    router.push(urls.workspace.note(locale, wsSlug, targetId));
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
    if (kind === "note") {
      return urls.workspace.note(
        locale,
        wsSlug,
        node.data.target_id ?? node.data.id,
      );
    }
    return null;
  }

  function copyLink() {
    const href = nodeHref();
    if (!href || typeof navigator === "undefined") return;
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    void navigator.clipboard?.writeText(`${origin}${href}`);
  }

  function pinFavorite() {
    const href = nodeHref();
    if (!href || !wsSlug) return;
    upsertSidebarFavorite(wsSlug, {
      id: node.data.id,
      label: node.data.label,
      href,
      kind: "note",
    });
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
    const menuWidth = 224;
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
            aria-expanded={canExpand ? node.isOpen : undefined}
            data-kind={kind}
            data-id={node.data.id}
            data-renaming={isRenaming || undefined}
            draggable={!isRenaming}
            onClick={handleRowClick}
            onDoubleClick={handleRowDoubleClick}
            onDragStart={(event) => {
              if (isRenaming) {
                event.preventDefault();
                return;
              }
              const payload = treeNodeToDragPayload(node.data);
              if (!payload) return;
              writeProjectTreeDragPayload(event.dataTransfer, payload);
            }}
            onKeyDown={handleRowKeyDown}
            title={t("row_hint")}
            className="group flex h-full min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-[var(--radius-control)] px-2.5 text-sm text-foreground transition-colors hover:bg-muted/70 focus-visible:bg-muted data-[drop-target=true]:bg-muted"
          />
        }
      >
        {canExpand ? (
          <ChevronRight
            aria-hidden
            data-testid="tree-chevron"
            className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${node.isOpen ? "rotate-90" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              node.toggle();
            }}
          />
        ) : (
          <span aria-hidden className="ml-2 h-4 w-4 shrink-0" />
        )}
        <NodeIcon node={node.data} />
        {isRenaming ? (
          <input
            ref={inputRef}
            defaultValue={node.data.label}
            className="min-w-0 flex-1 rounded bg-transparent px-0.5 text-sm text-foreground outline-none ring-1 ring-border"
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
          <>
            <span className="min-w-0 flex-1 truncate">{node.data.label}</span>
            <NodeTypeBadge node={node.data} />
          </>
        )}
        {!isRenaming ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {node.data.child_count > 0 ? (
              <span
                className={`${rowActionsVisible ? "hidden" : "px-1"} text-[10px] text-muted-foreground group-hover:hidden`}
              >
                {node.data.child_count}
              </span>
            ) : null}
            {canCreateChildPage ? (
              <button
                aria-label={t("new_child_page")}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.onCreateNote(node.data.id);
                }}
                className={`${rowActionsVisible ? "grid" : "hidden group-hover:grid focus-visible:grid"} h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              >
                <Plus aria-hidden className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              ref={actionButtonRef}
              aria-label={t("row_actions")}
              title={t("row_actions_hint")}
              data-visible-row-actions={rowActionsVisible ? "true" : undefined}
              type="button"
              onClick={toggleActionMenu}
              className={`${rowActionsVisible ? "grid" : "hidden group-hover:grid focus-visible:grid"} h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
            </button>
            {actionMenuPos && typeof document !== "undefined"
              ? createPortal(
                  <div
                    ref={actionMenuRef}
                    data-testid="tree-row-action-menu"
                    className="fixed z-50 w-56 rounded-[var(--radius-control)] border border-border bg-background p-1 text-sm text-foreground shadow-sm ring-0"
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
                      className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground"
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
                    {canCreateChildPage ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          closeActionMenu();
                          ctx.onCreateNote(node.data.id);
                        }}
                      >
                        {t("new_child_page")}
                      </button>
                    ) : null}
                    {kind === "folder" ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          closeActionMenu();
                          ctx.onCreateFolder(node.data.id);
                        }}
                      >
                        {t("new_subfolder")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                      disabled={!nodeHref()}
                      onClick={() => {
                        closeActionMenu();
                        copyLink();
                      }}
                    >
                      {t("copy_link")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                      disabled={!nodeHref()}
                      onClick={() => {
                        closeActionMenu();
                        pinFavorite();
                      }}
                    >
                      <Star
                        aria-hidden
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                      {t("favorite")}
                    </button>
                    <div className="-mx-1 my-1 h-px bg-border" />
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-destructive outline-none hover:bg-destructive/10"
                      onClick={() => {
                        closeActionMenu();
                        ctx.onDelete(
                          node.data.id,
                          kind,
                          node.data.label,
                          node.data.target_id,
                        );
                      }}
                    >
                      <span className="flex-1">{t("delete")}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {deleteShortcut}
                      </span>
                    </button>
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 rounded-[var(--radius-control)] border border-border bg-background p-1 shadow-sm ring-0">
        <TreeContextMenuItems
          kind={kind}
          deleteShortcut={deleteShortcut}
          onRename={() => ctx.onStartRename(node.data.id)}
          onCreateNote={
            canCreateChildPage
              ? () => ctx.onCreateNote(node.data.id)
              : undefined
          }
          onCreateFolder={() => ctx.onCreateFolder(node.data.id)}
          onCopyLink={copyLink}
          onFavorite={nodeHref() ? pinFavorite : undefined}
          onDelete={() =>
            ctx.onDelete(
              node.data.id,
              kind,
              node.data.label,
              node.data.target_id,
            )
          }
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NodeIcon({ node }: { node: TreeNode }) {
  if (node.kind === "folder") {
    return (
      <Folder
        aria-hidden
        className="h-4 w-4 shrink-0 text-sky-600 group-hover:text-sky-700"
      />
    );
  }
  if (node.kind === "source_bundle") {
    if (node.mime_type || node.file_kind) {
      return (
        <AgentFileIcon
          fileKind={node.file_kind}
          mimeType={node.mime_type}
          className={agentFileIconClass(node)}
        />
      );
    }
    return (
      <FileArchive
        aria-hidden
        className="h-4 w-4 shrink-0 text-emerald-600 group-hover:text-emerald-700"
      />
    );
  }
  if (node.kind === "artifact_group") {
    const role =
      typeof node.metadata?.role === "string" ? node.metadata.role : "";
    const color =
      role === "figures"
        ? "text-pink-600 group-hover:text-pink-700"
        : role === "analysis"
          ? "text-violet-600 group-hover:text-violet-700"
          : "text-cyan-600 group-hover:text-cyan-700";
    return <Folder aria-hidden className={`h-4 w-4 shrink-0 ${color}`} />;
  }
  if (node.kind === "agent_file") {
    return (
      <AgentFileIcon
        fileKind={node.file_kind}
        mimeType={node.mime_type}
        className={agentFileIconClass(node)}
      />
    );
  }
  if (node.kind === "code_workspace") {
    return (
      <FolderCode
        aria-hidden
        className="h-4 w-4 shrink-0 text-violet-600 group-hover:text-violet-700"
      />
    );
  }
  return (
    <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
  );
}

function NodeTypeBadge({ node }: { node: TreeNode }) {
  const label = badgeLabel(node);
  if (!label) return null;
  return (
    <span
      data-testid="tree-node-type-badge"
      className={`mr-0.5 shrink-0 rounded-[var(--radius-control)] border px-1.5 py-0.5 text-[10px] font-medium leading-none ${badgeClass(node)}`}
    >
      {label}
    </span>
  );
}

function badgeLabel(node: TreeNode): string | null {
  if (node.kind === "source_bundle") {
    const mime =
      typeof node.metadata?.mimeType === "string" ? node.metadata.mimeType : "";
    return fileBadgeFromMime(mime) ?? "자료";
  }
  if (node.kind === "artifact_group") {
    const role =
      typeof node.metadata?.role === "string" ? node.metadata.role : "";
    if (role === "parsed") return "추출";
    if (role === "figures") return "이미지";
    if (role === "analysis") return "분석";
    return "결과";
  }
  if (node.kind === "agent_file") {
    return (
      fileBadgeFromMime(node.mime_type ?? "") ??
      fileBadgeFromKind(node.file_kind)
    );
  }
  return null;
}

function badgeClass(node: TreeNode): string {
  const mime =
    node.kind === "source_bundle"
      ? typeof node.metadata?.mimeType === "string"
        ? node.metadata.mimeType
        : ""
      : (node.mime_type ?? "");
  if (mime === "application/pdf")
    return "border-red-200 bg-red-50 text-red-700";
  if (mime.startsWith("image/"))
    return "border-pink-200 bg-pink-50 text-pink-700";
  if (mime.startsWith("audio/"))
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (mime.startsWith("video/"))
    return "border-orange-200 bg-orange-50 text-orange-700";
  if (mime.includes("spreadsheet") || mime.includes("csv")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (node.kind === "artifact_group")
    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  return "border-border bg-muted text-muted-foreground";
}

function agentFileIconClass(node: TreeNode): string {
  const mime = node.mime_type ?? "";
  if (mime === "application/pdf") return "h-4 w-4 shrink-0 text-red-600";
  if (mime.startsWith("image/")) return "h-4 w-4 shrink-0 text-pink-600";
  if (mime.startsWith("audio/")) return "h-4 w-4 shrink-0 text-amber-600";
  if (mime.startsWith("video/")) return "h-4 w-4 shrink-0 text-orange-600";
  if (
    node.file_kind === "code" ||
    node.file_kind === "html" ||
    node.file_kind === "latex"
  ) {
    return "h-4 w-4 shrink-0 text-violet-600";
  }
  if (node.file_kind === "json" || node.file_kind === "csv") {
    return "h-4 w-4 shrink-0 text-emerald-600";
  }
  return "h-4 w-4 shrink-0 text-slate-600";
}

function fileBadgeFromMime(mime: string): string | null {
  if (mime === "application/pdf") return "PDF";
  if (mime === "text/markdown") return "MD";
  if (mime.startsWith("text/")) return "TXT";
  if (mime.startsWith("image/")) return "IMG";
  if (mime.startsWith("audio/")) return "AUD";
  if (mime.startsWith("video/")) return "VID";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "XLS";
  if (mime.includes("presentation") || mime.includes("powerpoint"))
    return "PPT";
  if (mime.includes("wordprocessing") || mime.includes("msword")) return "DOC";
  if (mime.includes("json")) return "JSON";
  return null;
}

function fileBadgeFromKind(kind?: string | null): string | null {
  if (!kind) return null;
  if (kind === "markdown") return "MD";
  if (kind === "image") return "IMG";
  if (kind === "code") return "CODE";
  if (kind === "html") return "HTML";
  if (kind === "json") return "JSON";
  if (kind === "csv") return "CSV";
  return kind.toUpperCase().slice(0, 4);
}

function AgentFileIcon({
  fileKind,
  mimeType,
  className,
}: {
  fileKind?: string | null;
  mimeType?: string | null;
  className: string;
}) {
  if (mimeType === "application/pdf") {
    return <FileText aria-hidden className={className} />;
  }
  if (mimeType?.startsWith("audio/")) {
    return <FileAudio aria-hidden className={className} />;
  }
  if (mimeType?.startsWith("video/")) {
    return <FileVideo aria-hidden className={className} />;
  }
  if (mimeType?.includes("spreadsheet") || mimeType?.includes("excel")) {
    return <FileSpreadsheet aria-hidden className={className} />;
  }
  if (fileKind === "code" || fileKind === "html" || fileKind === "latex") {
    return <FileCode aria-hidden className={className} />;
  }
  if (fileKind === "image" || mimeType?.startsWith("image/")) {
    return <FileImage aria-hidden className={className} />;
  }
  if (fileKind === "json" || fileKind === "csv" || mimeType?.includes("json")) {
    return <FileJson aria-hidden className={className} />;
  }
  if (fileKind === "markdown" || mimeType === "text/markdown") {
    return <FileText aria-hidden className={className} />;
  }
  return <File aria-hidden className={className} />;
}
