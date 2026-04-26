"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  projectsApi,
  type ProjectNoteKind,
  type ProjectNoteRow,
} from "@/lib/api-client";

type Filter = "all" | ProjectNoteKind;
const TABS: readonly Filter[] = ["all", "imported", "research", "manual"];

export function ProjectNotesTable({
  wsSlug,
  projectId,
  onLoaded,
}: {
  wsSlug: string;
  projectId: string;
  /**
   * Bubble the unfiltered list back to the parent so the meta row can derive
   * page_count + last_activity_at without a second fetch. Only fires for
   * `filter=all` queries — partial views don't represent project totals.
   */
  onLoaded?: (rows: ProjectNoteRow[]) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("project");
  const [filter, setFilter] = useState<Filter>("all");
  const { data } = useQuery({
    queryKey: ["project-notes", projectId, filter],
    queryFn: async () => {
      const r = await projectsApi.notes(projectId, filter);
      if (filter === "all") onLoaded?.(r.notes);
      return r.notes;
    },
  });

  return (
    <div>
      <div className="mb-3 flex gap-1 text-xs">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded border px-2 py-1 ${
              filter === id ? "border-foreground" : "border-border"
            }`}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>
      {data && data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("table.empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("table.headerTitle")}</th>
              <th className="pb-2 text-left">{t("table.headerKind")}</th>
              <th className="pb-2 text-left">{t("table.headerUpdated")}</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((n) => (
              <tr key={n.id} className="border-t border-border">
                <td className="py-2">
                  <Link
                    href={`/${locale}/app/w/${wsSlug}/n/${n.id}`}
                    className="hover:underline"
                  >
                    {n.title}
                  </Link>
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {t(`table.kindLabels.${n.kind}`)}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {new Date(n.updated_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
