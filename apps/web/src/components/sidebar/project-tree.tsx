"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Tree, type NodeApi, type TreeApi } from "react-arborist";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { urls } from "@/lib/urls";
import { tabToUrl } from "@/lib/tab-url";
import { useTabsStore } from "@/stores/tabs-store";
import { DownloadCloud } from "lucide-react";
import {
  treeQueryKey,
  useProjectTree,
  type TreeNode,
} from "@/hooks/use-project-tree";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useTypeAhead } from "@/hooks/use-tree-keyboard";
import { dataTransferHasFiles } from "@/lib/project-tree-dnd";
import {
  ProjectUploadDialog,
  useProjectUploadDialog,
} from "@/components/upload/project-upload-dialog";
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

async function persistMove(
  node: TreeNode,
  parentId: string | null,
  index: number,
) {
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

async function persistDelete(
  id: string,
  kind: TreeNode["kind"],
  targetId?: string | null,
) {
  const resourceId = kind === "note" ? (targetId ?? id) : id;
  const url =
    kind === "folder"
      ? `/api/folders/${id}`
      : kind === "note"
        ? `/api/notes/${resourceId}`
        : kind === "agent_file" ||
            kind === "code_workspace" ||
            kind === "source_bundle" ||
            kind === "artifact_group" ||
            kind === "artifact"
          ? `/api/tree/nodes/${id}`
          : `/api/notes/${id}`;
  const res = await fetch(url, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error(`${kind} delete ${res.status}`);
}

export function closeDeletedNoteTabs(noteId: string) {
  return useTabsStore.getState().closeTabsByTarget("note", noteId);
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
  const { roots, isLoading, isError, loadChildren } = useProjectTree({
    projectId,
  });
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const locale = useLocale();
  const expanded = useSidebarStore((s) => s.expanded);
  const qc = useQueryClient();
  const tSidebar = useTranslations("sidebar");
  const tToast = useTranslations("sidebar.toasts");
  const tUpload = useTranslations("sidebar.upload");
  const upload = useProjectUploadDialog({ projectId });
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
  const [fileDropActive, setFileDropActive] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileDropDepthRef = useRef(0);
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
    (
      id: string,
      kind: TreeNode["kind"],
      _label: string,
      targetId?: string | null,
    ) => {
      void (async () => {
        try {
          await persistDelete(id, kind, targetId);
          const deletedNoteId = kind === "note" ? (targetId ?? id) : null;
          if (deletedNoteId) {
            const { closedActive, nextActive } =
              closeDeletedNoteTabs(deletedNoteId);
            const viewingDeletedNote = pathname.includes(
              `/note/${deletedNoteId}`,
            );
            if (closedActive || viewingDeletedNote) {
              router.push(
                nextActive
                  ? tabToUrl(workspaceSlug, nextActive, locale)
                  : urls.workspace.project(locale, workspaceSlug, projectId),
              );
            }
          }
          toast.success(tToast("deleted"));
        } catch (err) {
          console.error("project tree delete failed", err);
          toast.error(tToast("delete_failed"));
          qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
        }
      })();
    },
    [locale, pathname, projectId, qc, router, tToast, workspaceSlug],
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
          const note = await persistCreateNote(projectId, parentId, "");
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
    [projectId, workspaceSlug, locale, router, qc, loadChildren, tToast],
  );

  const handleOpenAnalysisGroup = useCallback(
    (parentId: string, label: string) => {
      void (async () => {
        try {
          if (!useSidebarStore.getState().isExpanded(parentId)) {
            useSidebarStore.getState().toggleExpanded(parentId);
          }
          const children = await loadChildren(parentId);
          setTreeRefresh((v) => v + 1);
          const note = children.find((child) => child.kind === "note");
          if (!note) return;
          const targetId = note.target_id ?? note.id;
          const title = note.label?.trim() || label;
          const tabs = useTabsStore.getState();
          const existing = tabs.findTabByTarget("note", targetId);
          if (existing) {
            if (existing.title !== title)
              tabs.updateTab(existing.id, { title });
            tabs.setActive(existing.id);
          }
          router.push(urls.workspace.note(locale, workspaceSlug, targetId));
        } catch (err) {
          console.error("project tree analysis open failed", err);
          toast.error(tToast("create_note_failed"));
        }
      })();
    },
    [loadChildren, locale, router, tToast, workspaceSlug],
  );

  const ctxValue: ProjectTreeCtxValue = useMemo(
    () => ({
      renamingId,
      onStartRename: handleStartRename,
      onCommitRename: handleCommitRename,
      onCreateFolder: handleCreateFolder,
      onCreateNote: handleCreateNote,
      onOpenAnalysisGroup: handleOpenAnalysisGroup,
      onDelete: handleDelete,
    }),
    [
      renamingId,
      handleStartRename,
      handleCommitRename,
      handleCreateFolder,
      handleCreateNote,
      handleOpenAnalysisGroup,
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
    handleDelete(
      focused.data.id,
      focused.data.kind,
      focused.data.label,
      focused.data.target_id,
    );
  });

  return (
    <ProjectTreeContext.Provider value={ctxValue}>
      <div
        ref={containerRef}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-hidden outline-none"
        data-testid="project-tree"
        data-project-id={projectId}
        onDragEnter={(event) => {
          if (!dataTransferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          fileDropDepthRef.current += 1;
          setFileDropActive(true);
        }}
        onDragOver={(event) => {
          if (!dataTransferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!dataTransferHasFiles(event.dataTransfer)) return;
          fileDropDepthRef.current = Math.max(0, fileDropDepthRef.current - 1);
          if (fileDropDepthRef.current === 0) setFileDropActive(false);
        }}
        onDrop={(event) => {
          if (!dataTransferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          fileDropDepthRef.current = 0;
          setFileDropActive(false);
          setPendingUploadFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {fileDropActive ? (
          <div
            data-testid="project-tree-drop-overlay"
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center border-2 border-dashed border-foreground bg-background/85 text-sm font-medium text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <DownloadCloud aria-hidden className="h-4 w-4" />
              {tUpload("drop")}
            </span>
          </div>
        ) : null}
        {isError ? (
          <ProjectTreeStatus>{tSidebar("tree.error")}</ProjectTreeStatus>
        ) : isLoading ? (
          <ProjectTreeStatus>{tSidebar("loading")}</ProjectTreeStatus>
        ) : roots.length === 0 ? (
          <ProjectTreeStatus>{tSidebar("tree.empty_project")}</ProjectTreeStatus>
        ) : (
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
        )}
      </div>
      <ProjectUploadDialog
        projectId={projectId}
        open={pendingUploadFiles.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingUploadFiles([]);
        }}
        files={pendingUploadFiles}
        uploading={upload.isUploading}
        error={upload.hasUploadError}
        onFilesChange={setPendingUploadFiles}
        onStart={(intent) => {
          void upload.startUpload(pendingUploadFiles, intent).then((result) => {
            if (result?.ok) setPendingUploadFiles([]);
          });
        }}
      />
    </ProjectTreeContext.Provider>
  );
}

function ProjectTreeStatus({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-28 items-center justify-center px-3 text-center text-xs leading-5 text-muted-foreground">
      {children}
    </div>
  );
}
