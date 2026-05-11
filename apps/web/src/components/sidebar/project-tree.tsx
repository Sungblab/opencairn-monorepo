"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type TreeApi } from "react-arborist";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { urls } from "@/lib/urls";
import { tabToUrl } from "@/lib/tab-url";
import { useTabsStore } from "@/stores/tabs-store";
import { Button } from "@/components/ui/button";
import { DownloadCloud, UploadCloud } from "lucide-react";
import { openIngestTab } from "@/components/ingest/open-ingest-tab";
import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  treeQueryKey,
  useProjectTree,
  type TreeNode,
} from "@/hooks/use-project-tree";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useTypeAhead } from "@/hooks/use-tree-keyboard";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import { dataTransferHasFiles } from "@/lib/project-tree-dnd";
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
  const tabsStore = useTabsStore.getState();
  const deletedTabs = tabsStore.tabs.filter(
    (tab) => tab.kind === "note" && tab.targetId === noteId,
  );
  const closedActive = deletedTabs.some((tab) => tab.id === tabsStore.activeId);
  for (const tab of deletedTabs) {
    useTabsStore.getState().closeTab(tab.id);
  }
  const nextStore = useTabsStore.getState();
  const nextActive =
    nextStore.tabs.find((tab) => tab.id === nextStore.activeId) ?? null;
  return { closedActive, closedCount: deletedTabs.length, nextActive };
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
  const pathname = usePathname() ?? "";
  const locale = useLocale();
  const expanded = useSidebarStore((s) => s.expanded);
  const qc = useQueryClient();
  const t = useTranslations("sidebar.tree_menu");
  const tSidebar = useTranslations("sidebar");
  const tToast = useTranslations("sidebar.toasts");
  const tCommon = useTranslations("common.actions");
  const tUpload = useTranslations("sidebar.upload");
  const { upload } = useIngestUpload();
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    kind: TreeNode["kind"];
    label: string;
    targetId?: string | null;
  } | null>(null);
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
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState(false);
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
      label: string,
      targetId?: string | null,
    ) => {
      setPendingDelete({ id, kind, label, targetId });
    },
    [],
  );

  const confirmDelete = useCallback(() => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    void (async () => {
      try {
        await persistDelete(target.id, target.kind, target.targetId);
        const deletedNoteId =
          target.kind === "note" ? (target.targetId ?? target.id) : null;
        if (deletedNoteId) {
          const { closedActive, nextActive } =
            closeDeletedNoteTabs(deletedNoteId);
          const viewingDeletedNote = pathname.includes(`/note/${deletedNoteId}`);
          if (closedActive || viewingDeletedNote) {
            router.push(
              nextActive
                ? tabToUrl(workspaceSlug, nextActive, locale)
                : urls.workspace.project(locale, workspaceSlug, projectId),
            );
          }
        }
      } catch (err) {
        console.error("project tree delete failed", err);
        toast.error(tToast("delete_failed"));
        qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
      }
    })();
  }, [pendingDelete, projectId, qc, tToast]);

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
            "",
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
    [projectId, workspaceSlug, locale, router, qc, loadChildren, tToast],
  );

  const startUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setUploadError(false);
      try {
        const result = await upload(file, projectId);
        openIngestTab(result.workflowId, file.name);
        if (result.originalFileId) {
          openOriginalFileTab(result.originalFileId, file.name);
        }
        await qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
        setPendingUploadFile(null);
      } catch (err) {
        console.error("project tree file drop upload failed", err);
        setUploadError(true);
        toast.error(tUpload("error"));
      }
    },
    [projectId, qc, tUpload, upload],
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
          setUploadError(false);
          setPendingUploadFile(Array.from(event.dataTransfer.files)[0] ?? null);
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
      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("confirm_delete_title")}</DialogTitle>
            <DialogDescription>
              {t("confirm_delete_body", {
                label: pendingDelete?.label ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDelete}>
              {tCommon("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pendingUploadFile)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingUploadFile(null);
            setUploadError(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tUpload("title")}</DialogTitle>
            <DialogDescription>{tUpload("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border bg-muted/20 px-4 text-center text-sm">
              <UploadCloud aria-hidden className="h-7 w-7 text-muted-foreground" />
              <span className="font-medium">
                {pendingUploadFile
                  ? tUpload("selected", { name: pendingUploadFile.name })
                  : tUpload("drop")}
              </span>
              <span className="max-w-sm text-xs leading-5 text-muted-foreground">
                {tUpload("hint")}
              </span>
            </div>
            {uploadError ? (
              <p role="alert" className="text-sm text-destructive">
                {tUpload("error")}
              </p>
            ) : null}
            <button
              type="button"
              disabled={!pendingUploadFile}
              onClick={() => void startUpload(pendingUploadFile)}
              className="inline-flex min-h-10 w-full items-center justify-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tUpload("start")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </ProjectTreeContext.Provider>
  );
}
