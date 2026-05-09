"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type TreeApi } from "react-arborist";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { urls } from "@/lib/urls";
import {
  treeQueryKey,
  useProjectTree,
  type TreeNode,
} from "@/hooks/use-project-tree";
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
  workspaceSlug: string;
  height?: number;
  width?: number | string;
}

// Massages the `{roots}` payload from useProjectTree into the nested shape
// react-arborist expects via its default `childrenAccessor: "children"`. Two
// quirks worth naming:
//
// 1. We want the chevron on every container-like row, including empty notes,
//    because pages/files can become parents in the unified project tree. Arborist
//    treats `children: []` as "expandable but no rows loaded"; `undefined`
//    means "leaf". So an empty array is the sentinel for expandable rows.
// 2. Once expanded, we attach cached children for that parent and recurse.
//    Deeper levels are loaded on demand via handleToggle → loadChildren.
// 3. If the expanded container is really empty, synthesize a muted placeholder
//    row so the user doesn't see a confusing blank space under the chevron.
function deriveData(
  roots: TreeNode[],
  expanded: Set<string>,
  getCachedChildren: (parentId: string) => TreeNode[] | undefined,
): TreeNode[] {
  const containers = new Set([
    "folder",
    "note",
    "source_bundle",
    "artifact_group",
    "code_workspace",
  ]);
  function mark(n: TreeNode): TreeNode {
    if (!containers.has(n.kind)) return n;
    if (!expanded.has(n.id)) {
      return {
        ...n,
        children: n.children && n.children.length > 0 ? n.children : [],
      };
    }
    const children = getCachedChildren(n.id) ?? n.children ?? [];
    return {
      ...n,
      children:
        children.length > 0
          ? children.map(mark)
          : [
              {
                kind: "empty",
                id: `${n.id}:empty`,
                parent_id: n.id,
                label: "",
                child_count: 0,
              },
            ],
    };
  }
  return roots.map(mark);
}

function isSyntheticTreeNode(node: TreeNode) {
  return node.kind === "empty";
}

async function persistMove(node: TreeNode, parentId: string | null, index: number) {
  const res = await fetch(`/api/tree/nodes/${node.id}/move`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ parentId, position: index }),
  });
  if (!res.ok) throw new Error(`tree move ${res.status}`);
}

async function persistRename(
  id: string,
  _kind: TreeNode["kind"],
  label: string,
) {
  const res = await fetch(`/api/tree/nodes/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(`tree rename ${res.status}`);
}

async function persistDelete(id: string, kind: TreeNode["kind"]) {
  const url =
    kind === "folder"
      ? `/api/folders/${id}`
      : kind === "agent_file"
        ? `/api/agent-files/${id}`
        : kind === "code_workspace"
          ? `/api/code-workspaces/${id}`
        : `/api/notes/${id}`;
  const res = await fetch(url, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error(`${kind} delete ${res.status}`);
}

async function persistCreateFolder(
  projectId: string,
  parentId: string | null,
  name: string,
) {
  const res = await fetch("/api/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ projectId, parentId, name }),
  });
  if (!res.ok) throw new Error(`folder create ${res.status}`);
}

async function persistCreateNote(
  projectId: string,
  parentTreeNodeId: string | null,
  title: string,
): Promise<{ id: string }> {
  const res = await fetch("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ projectId, parentTreeNodeId, title }),
  });
  if (!res.ok) throw new Error(`note create ${res.status}`);
  return (await res.json()) as { id: string };
}

export function ProjectTree({
  projectId,
  workspaceSlug,
  height,
  width = "100%",
}: ProjectTreeProps) {
  const { roots, loadChildren } = useProjectTree({ projectId });
  const router = useRouter();
  const locale = useLocale();
  const expanded = useSidebarStore((s) => s.expanded);
  const qc = useQueryClient();
  const t = useTranslations("sidebar.tree_menu");
  const tSidebar = useTranslations("sidebar");
  const tToast = useTranslations("sidebar.toasts");
  const [treeRefresh, setTreeRefresh] = useState(0);
  const data = useMemo(
    () =>
      deriveData(roots, expanded, (parentId) =>
        qc.getQueryData<TreeNode[]>(treeQueryKey(projectId, parentId)),
      ),
    [roots, expanded, qc, projectId, treeRefresh],
  );
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
      await loadChildren(id)
        .then(() => setTreeRefresh((v) => v + 1))
        .catch(() => {
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
        if (isSyntheticTreeNode(dn.data)) continue;
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
        } catch {
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

  const handleCreateFolder = useCallback(
    (parentId: string | null) => {
      void (async () => {
        try {
          await persistCreateFolder(
            projectId,
            parentId,
            tSidebar("untitled_folder"),
          );
          if (parentId && !useSidebarStore.getState().isExpanded(parentId)) {
            useSidebarStore.getState().toggleExpanded(parentId);
          }
          await qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
          if (parentId) {
            await loadChildren(parentId);
          }
          setTreeRefresh((v) => v + 1);
        } catch (err) {
          console.error("project tree folder create failed", err);
          toast.error(tToast("create_folder_failed"));
        }
      })();
    },
    [projectId, qc, loadChildren, tSidebar, tToast],
  );

  const handleCreateNote = useCallback(
    (parentId: string | null) => {
      void (async () => {
        try {
          const note = await persistCreateNote(
            projectId,
            parentId,
            tSidebar("untitled"),
          );
          if (parentId && !useSidebarStore.getState().isExpanded(parentId)) {
            useSidebarStore.getState().toggleExpanded(parentId);
          }
          await qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
          if (parentId) {
            await loadChildren(parentId);
          }
          setTreeRefresh((v) => v + 1);
          router.push(urls.workspace.note(locale, workspaceSlug, note.id));
        } catch {
          toast.error(tToast("create_note_failed"));
        }
      })();
    },
    [projectId, workspaceSlug, locale, router, qc, loadChildren, tSidebar, tToast],
  );

  const ctxValue: ProjectTreeCtxValue = useMemo(
    () => ({
      renamingId,
      onStartRename: handleStartRename,
      onCommitRename: handleCommitRename,
      onCreateFolder: handleCreateFolder,
      onCreateNote: handleCreateNote,
      onDelete: handleDelete,
    }),
    [
      renamingId,
      handleStartRename,
      handleCommitRename,
      handleCreateFolder,
      handleCreateNote,
      handleDelete,
    ],
  );

  // ⌘/Ctrl+Delete removes the currently focused row after a confirm. Bound
  // globally because arborist owns focus, but the handler bails out when
  // an editable element is focused so Backspace/Delete inside the rename
  // input keeps its normal behavior.
  useKeyboardShortcut("mod+delete", () => {
    const focused = treeRef.current?.focusedNode;
    if (!focused) return;
    if (isSyntheticTreeNode(focused.data)) return;
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
          rowHeight={34}
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
