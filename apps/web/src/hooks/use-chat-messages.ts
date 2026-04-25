"use client";

// Read-only message log for a single thread. Mutations land via SSE in a
// later task, so this hook only owns the initial fetch + cache slot. The
// queryKey is namespaced by threadId — when the panel switches threads the
// previous list is parked in cache and the new one fetches fresh.

import { useQuery } from "@tanstack/react-query";

import { chatApi, type ChatMessage } from "@/lib/api-client";

export type { ChatMessage };

export function useChatMessages(threadId: string | null) {
  return useQuery({
    queryKey: threadId
      ? ["chat-messages", threadId]
      : ["chat-messages", "_disabled_"],
    enabled: Boolean(threadId),
    queryFn: async () => {
      if (!threadId) return [];
      const res = await chatApi.listMessages(threadId);
      return res.messages;
    },
  });
}
