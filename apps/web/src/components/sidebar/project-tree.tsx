"use client";
import { useMemo } from "react";
import { Tree } from "react-arborist";
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

export function ProjectTree({
  projectId,
  height = 600,
  width = "100%",
}: ProjectTreeProps) {
  const { roots, loadChildren } = useProjectTree({ projectId });
  const expanded = useSidebarStore((s) => s.expanded);
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
      >
        {ProjectTreeNode}
      </Tree>
    </div>
  );
}
