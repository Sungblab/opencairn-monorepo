"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationsApi,
  type NotificationKind,
  type NotificationRow,
} from "@/lib/api-client";

const SSE_KINDS: NotificationKind[] = [
  "mention",
  "comment_reply",
  "research_complete",
  "share_invite",
  "system",
];

// React Query holds the canonical list; the SSE channel only exists to
// invalidate that cache on push (so the drawer doesn't have to poll).
// `enabled` lets the caller defer the fetch + the EventSource until the
// drawer actually opens.
export function useNotifications(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(),
    enabled,
  });

  useEffect(() => {
    if (!enabled) return;
    const src = new EventSource("/api/stream/notifications");
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: ["notifications"] });
    SSE_KINDS.forEach((kind) => src.addEventListener(kind, invalidate));
    return () => src.close();
  }, [enabled, qc]);

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const items: NotificationRow[] = list.data?.notifications ?? [];
  return { items, markRead };
}
