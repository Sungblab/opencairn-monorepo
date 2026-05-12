"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { dashboardApi } from "@/lib/api-client";
import { urls } from "@/lib/urls";

export function SidebarRecentNotes({ wsSlug }: { wsSlug: string }) {
  const locale = useLocale();
  const t = useTranslations("sidebar.recent");
  const wsId = useWorkspaceId(wsSlug);
  const { data } = useQuery({
    queryKey: ["sidebar-recent-notes", wsId],
    queryFn: () => dashboardApi.recentNotes(wsId as string, 4),
    enabled: Boolean(wsId),
    staleTime: 60_000,
  });

  if (!wsId || !data) return null;

  if (data.notes.length === 0) {
    return (
      <p className="rounded-[var(--radius-control)] bg-muted/20 px-2.5 py-2 text-xs text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  return (
    <div className="grid gap-0.5">
      {data.notes.map((note) => (
        <Link
          key={note.id}
          href={urls.workspace.note(locale, wsSlug, note.id)}
          className="flex min-h-9 min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Clock aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground/90">
              {note.title}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {note.project_name}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
