"use client";

import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dashboardApi } from "@/lib/api-client";

export function RecentDocsGrid({
  wsId,
  wsSlug,
  limit = 3,
}: {
  wsId: string;
  wsSlug: string;
  limit?: number;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const { data } = useQuery({
    queryKey: ["dashboard-recent-notes", wsId, limit],
    queryFn: () => dashboardApi.recentNotes(wsId, limit),
  });

  if (!data) return null;
  if (data.notes.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("lists.noDocs")}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {data.notes.map((note) => (
        <Link
          key={note.id}
          href={`/${locale}/app/w/${wsSlug}/n/${note.id}`}
          className="rounded border border-border p-4 hover:bg-accent"
        >
          <p className="truncate text-sm font-medium">{note.title}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {note.project_name}
          </p>
        </Link>
      ))}
    </div>
  );
}
