"use client";
import { useMemo } from "react";
import { Tree, type NodeApi } from "react-arborist";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectTree, type TreeNode } from "@/hooks/use-project-tree";
import { useSidebarStore } from "@/stores/sidebar-store";
import { ProjectTreeNode } from "./project-tree-node";

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
    if (n.kind === "note") return n;
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
  // notes: position isn't tracked server-side — only parent (folder) matters.
  const res = await fetch(`/api/notes/${node.id}/move`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ folderId: parentId }),
  });
  if (!res.ok) throw new Error(`notes move ${res.status}`);
}

export function ProjectTree({
  projectId,
  height = 600,
  width = "100%",
}: ProjectTreeProps) {
  const { roots, loadChildren } = useProjectTree({ projectId });
  const expanded = useSidebarStore((s) => s.expanded);
  const qc = useQueryClient();
  const data = useMemo(() => deriveData(roots, expanded), [roots, expanded]);

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
      qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
    }
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-hidden"
      data-testid="project-tree"
      data-project-id={projectId}
    >
      <Tree<TreeNode>
        data={data}
        width={width}
        height={height}
        rowHeight={28}
        openByDefault={false}
        onToggle={handleToggle}
        onMove={handleMove}
      >
        {ProjectTreeNode}
      </Tree>
    </div>
  );
}
