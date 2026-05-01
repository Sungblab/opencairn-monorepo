"use client";

import { urls } from "@/lib/urls";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  projectsApi,
  type ProjectNoteKind,
  type ProjectNoteRow,
} from "@/lib/api-client";

type Filter = "all" | ProjectNoteKind;
const TABS: readonly Filter[] = ["all", "imported", "research", "manual"];

export interface ProjectNoteCounts {
  all: number;
  imported: number;
  research: number;
  manual: number;
}

export function ProjectNotesTable({
  wsSlug,
  projectId,
  counts,
  onLoaded,
}: {
  wsSlug: string;
  projectId: string;
  /**
   * Filter chip counts derived by the parent from the unfiltered list. Passed
   * down so the chips stay numeric while the active query may be a slice.
   * `undefined` while the unfiltered query is still in flight.
   */
  counts?: ProjectNoteCounts;
  /**
   * Bubble the unfiltered list back to the parent so the meta row can derive
   * page_count + last_activity_at without a second fetch. Only fires for
   * `filter=all` queries — partial views don't represent project totals.
   */
  onLoaded?: (rows: ProjectNoteRow[]) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("project");
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>("all");
  const { data } = useQuery({
    queryKey: ["project-notes", projectId, filter],
    queryFn: () => projectsApi.notes(projectId, filter).then((r) => r.notes),
  });

  // Side effect must live outside queryFn — queryFn is skipped on cache hits,
  // which would leave the parent meta row stale on revisit. Ref keeps the
  // effect deps stable when callers pass an inline arrow.
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });
  useEffect(() => {
    if (data && filter === "all") onLoadedRef.current?.(data);
  }, [data, filter]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {TABS.map((id) => {
          const isActive = filter === id;
          const count = counts?.[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={
                isActive
                  ? "rounded-[var(--radius-chip)] border-[1.5px] border-foreground bg-foreground px-3 py-1 text-background"
                  : "app-hover rounded-[var(--radius-chip)] border-[1.5px] border-border px-3 py-1 text-foreground"
              }
            >
              <span>{t(`tabs.${id}`)}</span>
              {count !== undefined ? (
                <span
                  className={
                    isActive
                      ? "ml-1.5 text-background/80"
                      : "ml-1.5 text-muted-foreground"
                  }
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {data && data.length === 0 ? (
        <div
          className="rounded-[var(--radius-card)] px-4 py-12 text-center text-xs text-muted-foreground"
          style={{ border: "1.5px solid var(--theme-border)" }}
        >
          {t("table.empty")}
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-[var(--radius-card)]"
          style={{ border: "1.5px solid var(--theme-border)" }}
        >
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">
                  {t("table.headerTitle")}
                </th>
                <th className="w-32 px-4 py-2 text-left font-medium">
                  {t("table.headerKind")}
                </th>
                <th className="w-28 px-4 py-2 text-left font-medium">
                  {t("table.headerUpdated")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((n) => (
                <tr
                  key={n.id}
                  className="app-hover border-t border-border"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={urls.workspace.note(locale, wsSlug, n.id)}
                      className="block truncate font-medium"
                    >
                      {n.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="rounded-[var(--radius-chip)] border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {t(`table.kindLabels.${n.kind}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {format.relativeTime(new Date(n.updated_at))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
