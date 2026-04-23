"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// Mirrors the TreeRow response from GET /api/projects/:id/tree (spec §11.3).
// `kind` is a stable discriminator so the sidebar component can switch on
// rendering + drag-drop behavior without inspecting other fields.
export interface TreeNode {
  kind: "folder" | "note";
  id: string;
  parent_id: string | null; // folder.parent_id OR note.folder_id
  label: string;            // folder.name OR note.title
  child_count: number;      // 0 for notes
  children?: TreeNode[];    // folders only, prefetched one level deep
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

    const src = new EventSource(
      `/api/stream/projects/${opts.projectId}/tree`,
      { withCredentials: true },
    );

    const invalidateParent = (raw: MessageEvent<string>) => {
      let evt: TreeSseEvent | null = null;
      try {
        evt = JSON.parse(raw.data) as TreeSseEvent;
      } catch {
        /* malformed — fall through to full invalidation */
      }
      if (evt) {
        qc.invalidateQueries({
          queryKey: treeQueryKey(opts.projectId, evt.parentId ?? null),
        });
      } else {
        qc.invalidateQueries({ queryKey: ["project-tree", opts.projectId] });
      }
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
    ];
    const projectScoped: string[] = [
      "tree.folder_moved",
      "tree.note_moved",
    ];

    for (const kind of parentScoped) {
      src.addEventListener(kind, invalidateParent as EventListener);
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
