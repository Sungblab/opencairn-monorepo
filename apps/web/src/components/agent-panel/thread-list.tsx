"use client";

// Body of the panel header's "···" dropdown. Reads the chat thread list for
// the currently routed workspace and lets the user activate one. We resolve
// the workspace UUID via useWorkspaceId(slug) because useChatThreads is
// keyed on the UUID — the slug appears in the URL but the API and React
// Query cache speak in IDs. Relative timestamps come from next-intl's
// useFormatter so "2 minutes ago" / "2분 전" picks up the active locale
// without us pulling in date-fns just for this widget.

import { useParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { useChatThreads } from "@/hooks/use-chat-threads";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { useThreadsStore } from "@/stores/threads-store";

export function ThreadList() {
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const workspaceId = useWorkspaceId(wsSlug ?? "");
  const { threads, isLoading } = useChatThreads(workspaceId);
  const setActive = useThreadsStore((s) => s.setActiveThread);
  const t = useTranslations("agentPanel.threadList");
  const format = useFormatter();

  if (isLoading) {
    return <p className="p-2 text-xs text-muted-foreground">{t("loading")}</p>;
  }
  if (threads.length === 0) {
    return <p className="p-2 text-xs text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <ul className="max-h-80 overflow-auto p-1">
      {threads.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            onClick={() => setActive(thread.id)}
            className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-accent"
          >
            <span className="truncate text-sm">
              {thread.title || t("untitled")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {format.relativeTime(new Date(thread.updated_at))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
