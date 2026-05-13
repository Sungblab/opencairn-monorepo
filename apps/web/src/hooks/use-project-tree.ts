"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTabsStore } from "@/stores/tabs-store";

// Mirrors the TreeRow response from GET /api/projects/:id/tree (spec §11.3).
// `kind` is a stable discriminator so the sidebar component can switch on
// rendering + drag-drop behavior without inspecting other fields.
export interface TreeNode {
  kind:
    | "folder"
    | "note"
    | "agent_file"
    | "code_workspace"
    | "source_bundle"
    | "artifact_group"
    | "artifact"
    | "empty";
  id: string;
  parent_id: string | null;
  label: string;
  child_count: number;
  target_table?: "folders" | "notes" | "agent_files" | "code_workspaces" | null;
  target_id?: string | null;
  icon?: string | null;
  metadata?: Record<string, unknown>;
  file_kind?: string | null;
  mime_type?: string | null;
  children?: TreeNode[];
}

interface TreeResponse {
  nodes: TreeNode[];
}

export const treeQueryKey = (projectId: string, parentId: string | null) =>
  ["project-tree", projectId, parentId ?? "root"] as const;

async function fetchTree(
  projectId: string,
  parentId: string | null,
): Promise<TreeNode[]> {
  const url = parentId
    ? `/api/projects/${projectId}/tree?parent_id=${parentId}`
    : `/api/projects/${projectId}/tree`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`tree ${res.status}`);
  const body = (await res.json()) as TreeResponse;
  return body.nodes;
}

// SSE event payload shape emitted by the Hono stream route. Matches
// `TreeEvent` on the server (apps/api/src/lib/tree-events.ts). Client
// only needs `parentId` for targeted invalidation.
interface TreeSseEvent {
  kind: string;
  projectId: string;
  id: string;
  parentId: string | null;
  targetId?: string | null;
  label?: string;
  at: string;
}

/**
 * Sidebar tree hook: fetches root nodes on mount, exposes a `loadChildren`
 * helper for lazy folder expansion, and subscribes to the project's SSE
 * channel to keep the React Query cache fresh in response to remote
 * folder/note mutations.
 *
 * Invalidation strategy (spec §4.10 "landmine: React Query invalidate
 * 폭주"): created/renamed/deleted events carry `parentId`, so we invalidate
 * just that parent's cached child list. Moves touch both the old and new
 * parents; since events don't carry the old parent, we fall back to a
 * project-wide invalidation for `*_moved`. Restored notes are treated as
 * creations under their `parentId`.
 */
export function useProjectTree(opts: { projectId: string }) {
  const qc = useQueryClient();

  const rootQuery = useQuery({
    queryKey: treeQueryKey(opts.projectId, null),
    queryFn: () => fetchTree(opts.projectId, null),
    enabled: Boolean(opts.projectId),
  });

  useEffect(() => {
    if (!opts.projectId) return;
    // jsdom does not implement EventSource — bail out in test environments
    // that haven't shimmed it. Unit tests for this hook mock fetch only.
    if (typeof EventSource === "undefined") return;

    const src = new EventSource(`/api/stream/projects/${opts.projectId}/tree`, {
      withCredentials: true,
    });

    const readTreeEvent = (raw: MessageEvent<string>): TreeSseEvent | null => {
      let evt: TreeSseEvent | null = null;
      try {
        evt = JSON.parse(raw.data) as TreeSseEvent;
      } catch {
        return null;
      }
      return evt;
    };

    const invalidateParent = (raw: MessageEvent<string>) => {
      const evt = readTreeEvent(raw);
      if (evt) {
        qc.invalidateQueries({
          queryKey: treeQueryKey(opts.projectId, evt.parentId ?? null),
        });
      } else {
        qc.invalidateQueries({ queryKey: ["project-tree", opts.projectId] });
      }
    };

    const closeDeletedTabsAndInvalidateParent = (raw: MessageEvent<string>) => {
      const evt = readTreeEvent(raw);
      if (evt) {
        const targetId = evt.targetId ?? evt.id;
        if (evt.kind === "tree.note_deleted") {
          useTabsStore.getState().closeTabsByTarget("note", targetId);
        } else if (evt.kind === "tree.agent_file_deleted") {
          useTabsStore.getState().closeTabsByTarget("agent_file", targetId);
        } else if (evt.kind === "tree.code_workspace_deleted") {
          useTabsStore.getState().closeTabsByTarget("code_workspace", targetId);
        }
      }
      invalidateParent(raw);
    };

    const invalidateAll = () =>
      qc.invalidateQueries({ queryKey: ["project-tree", opts.projectId] });

    const parentScoped: string[] = [
      "tree.folder_created",
      "tree.folder_renamed",
      "tree.folder_reordered",
      "tree.folder_deleted",
      "tree.note_created",
      "tree.note_renamed",
      "tree.note_deleted",
      "tree.note_restored",
      "tree.agent_file_created",
      "tree.agent_file_renamed",
      "tree.agent_file_deleted",
      "tree.code_workspace_created",
      "tree.code_workspace_renamed",
      "tree.code_workspace_deleted",
      "tree.node_created",
      "tree.node_renamed",
      "tree.node_deleted",
      "tree.node_restored",
    ];
    const projectScoped: string[] = [
      "tree.folder_moved",
      "tree.note_moved",
      "tree.agent_file_moved",
      "tree.node_moved",
      "tree.node_reordered",
    ];

    for (const kind of parentScoped) {
      const listener = kind.endsWith("_deleted")
        ? closeDeletedTabsAndInvalidateParent
        : invalidateParent;
      src.addEventListener(kind, listener as EventListener);
    }
    for (const kind of projectScoped) {
      src.addEventListener(kind, invalidateAll as EventListener);
    }

    return () => {
      src.close();
    };
  }, [opts.projectId, qc]);

  async function loadChildren(parentId: string): Promise<TreeNode[]> {
    return qc.fetchQuery({
      queryKey: treeQueryKey(opts.projectId, parentId),
      queryFn: () => fetchTree(opts.projectId, parentId),
    });
  }

  return {
    roots: rootQuery.data ?? [],
    isLoading: rootQuery.isLoading,
    isError: rootQuery.isError,
    loadChildren,
  };
}
