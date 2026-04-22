"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

// Fetches note metadata (title, folderId, type, timestamps...).
// Plan 2B: `content` on the returned row is a stale snapshot produced by the
// Hocuspocus `onStoreDocument` hook and MUST NOT be used to seed the editor.
// Live content flows through the Yjs + Hocuspocus channel in
// `useCollaborativeEditor`; this hook is for headers, sidebar labels, etc.
export function useNote(id: string) {
  return useQuery({
    queryKey: ["note", id],
    queryFn: () => api.getNote(id),
    enabled: Boolean(id),
  });
}
