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
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useChatThreads } from "@/hooks/use-chat-threads";
import { useHydratedNow } from "@/hooks/use-hydrated-now";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { useThreadsStore } from "@/stores/threads-store";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";

export function ThreadList() {
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const workspaceId = useWorkspaceId(wsSlug);
  const { projectId } = useCurrentProjectContext();
  const { threads, isLoading, archive } = useChatThreads(workspaceId, projectId);
  const activeThreadId = useThreadsStore((s) => s.activeThreadId);
  const setActive = useThreadsStore((s) => s.setActiveThread);
  const t = useTranslations("agentPanel.thread_list");
  const format = useFormatter();
  const now = useHydratedNow();

  async function deleteThread(threadId: string) {
    try {
      await archive.mutateAsync(threadId);
      if (activeThreadId === threadId) {
        setActive(null);
      }
    } catch (err) {
      console.error("chat thread archive failed", err);
      toast.error(t("delete_failed"));
    }
  }

  if (isLoading) {
    return <p className="p-2 text-xs text-muted-foreground">{t("loading")}</p>;
  }
  if (threads.length === 0) {
    return <p className="p-2 text-xs text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="w-full">
      <div className="border-b border-neutral-200 px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          {t("title")}
        </p>
      </div>
      <div className="app-scrollbar-thin grid max-h-64 gap-1 overflow-auto p-2">
        {threads.map((thread) => {
          const isDeleting = archive.isPending;
          const title = thread.title || t("untitled");
          const active = activeThreadId === thread.id;

          return (
            <div
              key={thread.id}
              className={`group flex min-h-11 items-center gap-2 rounded px-2.5 py-2 transition-colors ${
                active
                  ? "bg-neutral-100 text-neutral-950"
                  : "text-neutral-950 hover:bg-neutral-100 focus-within:bg-neutral-100"
              }`}
            >
              <button
                type="button"
                onClick={() => setActive(thread.id)}
                className="min-w-0 flex-1 text-left outline-none"
              >
                <span className="block truncate text-[13px] font-medium leading-4 text-neutral-950">
                  {title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-3 text-neutral-500">
                  {now
                    ? format.relativeTime(new Date(thread.updated_at), now)
                    : null}
                </span>
              </button>
              {active ? (
                <Check
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-neutral-600"
                />
              ) : null}
              <button
                type="button"
                aria-label={t("delete_aria", { title })}
                title={t("delete")}
                disabled={isDeleting}
                onClick={() => void deleteThread(thread.id)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-neutral-500 opacity-50 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
