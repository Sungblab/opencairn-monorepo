"use client";

// Hooks for the agent panel's per-project thread list. List/create/rename/
// archive share one queryKey shape so mutations invalidate the same cached
// list the panel header dropdown reads. Thread CRUD is namespaced by workspace
// and current project — switching projects gets a fresh cache entry instead
// of reusing the previous project's chat history.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { chatApi, type ChatThread } from "@/lib/api-client";

export type { ChatThread };

function threadsKey(workspaceId: string, projectId: string | null) {
  return ["chat-threads", workspaceId, projectId ?? "_workspace_"] as const;
}

export function useChatThreads(
  workspaceId: string | null,
  projectId: string | null = null,
) {
  const qc = useQueryClient();
  const enabled = Boolean(workspaceId);

  // When workspaceId is null we still need a stable key so React Query can
  // cache the disabled state — using the workspaceId in the key directly
  // would change every render and trigger refetch storms once it resolves.
  const query = useQuery({
    queryKey: workspaceId
      ? threadsKey(workspaceId, projectId)
      : ["chat-threads", "_disabled_"],
    enabled,
    queryFn: async () => {
      if (!workspaceId) return [];
      const res = await chatApi.listThreads(workspaceId, projectId);
      return res.threads;
    },
  });

  const create = useMutation({
    mutationFn: async (input: { title?: string }) => {
      if (!workspaceId) throw new Error("workspace not selected");
      return chatApi.createThread(workspaceId, input.title, projectId);
    },
    onSuccess: () => {
      if (workspaceId)
        qc.invalidateQueries({ queryKey: threadsKey(workspaceId, projectId) });
    },
  });

  const rename = useMutation({
    mutationFn: async (input: { id: string; title: string }) =>
      chatApi.renameThread(input.id, input.title),
    onSuccess: () => {
      if (workspaceId)
        qc.invalidateQueries({ queryKey: threadsKey(workspaceId, projectId) });
    },
  });

  const archive = useMutation({
    mutationFn: async (id: string) => chatApi.archiveThread(id),
    onSuccess: () => {
      if (workspaceId)
        qc.invalidateQueries({ queryKey: threadsKey(workspaceId, projectId) });
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
