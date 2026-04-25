"use client";

// Hooks for the agent panel's per-workspace thread list. List/create/rename/
// archive share one queryKey shape so mutations invalidate the same cached
// list the panel header dropdown reads. Thread CRUD is per-workspace, so the
// key is namespaced by workspaceId — switching workspaces gets a fresh cache
// entry instead of stale cross-tenant data leaking across navigations.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { chatApi, type ChatThread } from "@/lib/api-client";

export type { ChatThread };

function threadsKey(workspaceId: string) {
  return ["chat-threads", workspaceId] as const;
}

export function useChatThreads(workspaceId: string | null) {
  const qc = useQueryClient();
  const enabled = Boolean(workspaceId);

  // When workspaceId is null we still need a stable key so React Query can
  // cache the disabled state — using the workspaceId in the key directly
  // would change every render and trigger refetch storms once it resolves.
  const query = useQuery({
    queryKey: workspaceId
      ? threadsKey(workspaceId)
      : ["chat-threads", "_disabled_"],
    enabled,
    queryFn: async () => {
      if (!workspaceId) return [];
      const res = await chatApi.listThreads(workspaceId);
      return res.threads;
    },
  });

  const create = useMutation({
    mutationFn: async (input: { title?: string }) => {
      if (!workspaceId) throw new Error("workspace not selected");
      return chatApi.createThread(workspaceId, input.title);
    },
    onSuccess: () => {
      if (workspaceId)
        qc.invalidateQueries({ queryKey: threadsKey(workspaceId) });
    },
  });

  const rename = useMutation({
    mutationFn: async (input: { id: string; title: string }) =>
      chatApi.renameThread(input.id, input.title),
    onSuccess: () => {
      if (workspaceId)
        qc.invalidateQueries({ queryKey: threadsKey(workspaceId) });
    },
  });

  const archive = useMutation({
    mutationFn: async (id: string) => chatApi.archiveThread(id),
    onSuccess: () => {
      if (workspaceId)
        qc.invalidateQueries({ queryKey: threadsKey(workspaceId) });
    },
  });

  return {
    threads: query.data ?? [],
    isLoading: query.isLoading,
    create,
    rename,
    archive,
  };
}
