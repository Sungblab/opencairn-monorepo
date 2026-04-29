"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dashboardApi } from "@/lib/api-client";

// Mockup §recent-docs cards stack four lines: project label (small caps),
// title (medium), excerpt (muted), relative timestamp (xs muted). The
// excerpt comes from the new `excerpt` field on /recent-notes (slice of
// content_text); when a note has no body yet we hide the line entirely
// rather than rendering a hollow row.
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
  const format = useFormatter();
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
          className="app-hover block rounded p-4"
          style={{ border: "1.5px solid var(--theme-border)" }}
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {note.project_name}
          </div>
          <div className="mb-1.5 mt-1 truncate text-sm font-medium">
            {note.title}
          </div>
          {note.excerpt ? (
            <div className="line-clamp-2 text-xs text-muted-foreground">
              {note.excerpt}
            </div>
          ) : (
            <div className="text-xs italic text-muted-foreground">
              {t("lists.emptyExcerpt")}
            </div>
          )}
          <div className="mt-3 text-[11px] text-muted-foreground">
            {format.relativeTime(new Date(note.updated_at))}
          </div>
        </Link>
      ))}
    </div>
  );
}
