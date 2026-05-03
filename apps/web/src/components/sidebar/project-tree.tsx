"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type TreeApi } from "react-arborist";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useProjectTree, type TreeNode } from "@/hooks/use-project-tree";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useTypeAhead } from "@/hooks/use-tree-keyboard";
import { ProjectTreeNode } from "./project-tree-node";
import {
  ProjectTreeContext,
  type ProjectTreeCtxValue,
} from "./project-tree-context";

export interface ProjectTreeProps {
  projectId: string;
  height?: number;
  width?: number | string;
}

// Massages the `{roots}` payload from useProjectTree into the nested shape
// react-arborist expects via its default `childrenAccessor: "children"`. Two
// quirks worth naming:
//
// 1. We want the chevron on a *collapsed* folder that reports `child_count>0`
//    even before its children are prefetched. Arborist treats `children: []`
//    as "has children but none loaded", which renders the chevron; `undefined`
//    means "leaf". So an empty array is the sentinel for unloaded folders.
// 2. Once expanded, we recurse so prefetched-one-level children are displayed.
//    Deeper levels are loaded on demand via handleToggle → loadChildren.
function deriveData(roots: TreeNode[], expanded: Set<string>): TreeNode[] {
  function mark(n: TreeNode): TreeNode {
    if (n.kind !== "folder") return n;
    if (n.child_count === 0) return { ...n, children: undefined };
    if (!expanded.has(n.id)) {
      return {
        ...n,
        children: n.children && n.children.length > 0 ? n.children : [],
      };
    }
    return { ...n, children: (n.children ?? []).map(mark) };
  }
  return roots.map(mark);
}

async function persistMove(node: TreeNode, parentId: string | null, index: number) {
  if (node.kind === "folder") {
    const res = await fetch(`/api/folders/${node.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ parentId, position: index }),
    });
    if (!res.ok) throw new Error(`folders PATCH ${res.status}`);
    return;
  }
  if (node.kind === "agent_file") {
    const res = await fetch(`/api/agent-files/${node.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ folderId: parentId }),
    });
    if (!res.ok) throw new Error(`agent file move ${res.status}`);
    return;
  }
  // notes: position isn't tracked server-side — only parent (folder) matters.
  const res = await fetch(`/api/notes/${node.id}/move`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ folderId: parentId }),
  });
  if (!res.ok) throw new Error(`notes move ${res.status}`);
}

async function persistRename(
  id: string,
  kind: TreeNode["kind"],
  label: string,
) {
  const url =
    kind === "folder"
      ? `/api/folders/${id}`
      : kind === "agent_file"
        ? `/api/agent-files/${id}`
        : `/api/notes/${id}`;
  const body =
    kind === "folder"
      ? { name: label }
      : kind === "agent_file"
        ? { title: label, filename: label }
        : { title: label };
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${kind} rename ${res.status}`);
}

async function persistDelete(id: string, kind: TreeNode["kind"]) {
  const url =
    kind === "folder"
      ? `/api/folders/${id}`
      : kind === "agent_file"
        ? `/api/agent-files/${id}`
        : `/api/notes/${id}`;
  const res = await fetch(url, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error(`${kind} delete ${res.status}`);
}

export function ProjectTree({
  projectId,
  height,
  width = "100%",
}: ProjectTreeProps) {
  const { roots, loadChildren } = useProjectTree({ projectId });
  const expanded = useSidebarStore((s) => s.expanded);
  const qc = useQueryClient();
  const t = useTranslations("sidebar.tree_menu");
  const tToast = useTranslations("sidebar.toasts");
  const data = useMemo(() => deriveData(roots, expanded), [roots, expanded]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [typeAheadBuf, setTypeAheadBuf] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<TreeApi<TreeNode> | null>(null);

  // react-arborist's virtualization needs a concrete pixel height. When the
  // caller doesn't pin one we observe the container and forward its
  // clientHeight so the tree fills whatever the sidebar layout gives it.
  const [observedHeight, setObservedHeight] = useState<number>(height ?? 400);
  useEffect(() => {
    if (height !== undefined) {
      setObservedHeight(height);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const apply = () => setObservedHeight(el.clientHeight || 400);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  useTypeAhead(containerRef, setTypeAheadBuf);

  async function handleToggle(id: string) {
    const { isExpanded, toggleExpanded } = useSidebarStore.getState();
    const wasExpanded = isExpanded(id);
    toggleExpanded(id);
    if (!wasExpanded) {
      // Fire-and-forget: the tree re-renders once the query cache fills in.
      await loadChildren(id).catch(() => {
        /* useProjectTree owns error UX via its SSE re-sync */
      });
    }
  }

  // react-arborist reorders its in-memory model synchronously; we mirror that
  // to the server one node at a time. On failure we invalidate the whole
  // project tree so the UI re-syncs from truth instead of staying in a
  // half-moved state. SSE `tree.*_moved` events will re-invalidate on success
  // — so the happy path costs nothing extra here.
  async function handleMove(args: {
    dragIds: string[];
    dragNodes: NodeApi<TreeNode>[];
    parentId: string | null;
    index: number;
  }) {
    try {
      for (const [i, dn] of args.dragNodes.entries()) {
        await persistMove(dn.data, args.parentId, args.index + i);
      }
    } catch (err) {
      console.error("project tree move failed", err);
      toast.error(tToast("move_failed"));
      qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
    }
  }

  const handleStartRename = useCallback((id: string) => {
    setRenamingId(id);
  }, []);

  const handleCommitRename = useCallback(
    (id: string, kind: TreeNode["kind"], newLabel: string | null) => {
      setRenamingId((curr) => (curr === id ? null : curr));
      if (newLabel === null || newLabel.length === 0) return;
      void (async () => {
        try {
          await persistRename(id, kind, newLabel);
        } catch (err) {
          console.error("project tree rename failed", err);
          toast.error(tToast("rename_failed"));
          qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
        }
      })();
    },
    [projectId, qc, tToast],
  );

  const handleDelete = useCallback(
    (id: string, kind: TreeNode["kind"], label: string) => {
      if (typeof window === "undefined") return;
      const confirmed = window.confirm(t("confirm_delete", { label }));
      if (!confirmed) return;
      void (async () => {
        try {
          await persistDelete(id, kind);
        } catch (err) {
          console.error("project tree delete failed", err);
          toast.error(tToast("delete_failed"));
          qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
        }
      })();
    },
    [projectId, qc, t, tToast],
  );

  const ctxValue: ProjectTreeCtxValue = useMemo(
    () => ({
      renamingId,
      onStartRename: handleStartRename,
      onCommitRename: handleCommitRename,
      onDelete: handleDelete,
    }),
    [renamingId, handleStartRename, handleCommitRename, handleDelete],
  );

  // ⌘/Ctrl+Delete removes the currently focused row after a confirm. Bound
  // globally because arborist owns focus, but the handler bails out when
  // an editable element is focused so Backspace/Delete inside the rename
  // input keeps its normal behavior.
  useKeyboardShortcut("mod+delete", () => {
    const focused = treeRef.current?.focusedNode;
    if (!focused) return;
    if (typeof document !== "undefined") {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest("input, textarea, [contenteditable]")) return;
    }
    handleDelete(focused.data.id, focused.data.kind, focused.data.label);
  });

  return (
    <ProjectTreeContext.Provider value={ctxValue}>
      <div
        ref={containerRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-hidden outline-none"
        data-testid="project-tree"
        data-project-id={projectId}
      >
        <Tree<TreeNode>
          ref={treeRef}
          data={data}
          width={width}
          height={observedHeight}
          rowHeight={28}
          openByDefault={false}
          searchTerm={typeAheadBuf || undefined}
          onToggle={handleToggle}
          onMove={handleMove}
        >
          {ProjectTreeNode}
        </Tree>
      </div>
    </ProjectTreeContext.Provider>
  );
}
