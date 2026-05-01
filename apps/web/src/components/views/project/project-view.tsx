"use client";

import { urls } from "@/lib/urls";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { projectsApi, type ProjectNoteRow } from "@/lib/api-client";
import { IngestUploadButton } from "@/components/ingest/ingest-upload-button";
import { ProjectMetaRow } from "./project-meta-row";
import { ProjectNotesTable } from "./project-notes-table";

export function ProjectView({
  wsSlug,
  projectId,
}: {
  wsSlug: string;
  projectId: string;
}) {
  const locale = useLocale();
  const t = useTranslations("project");
  const { data: meta } = useQuery({
    queryKey: ["project-meta", projectId],
    queryFn: () => projectsApi.get(projectId),
  });
  // Page count + last activity are derived from the unfiltered notes list to
  // avoid a third endpoint just for two scalars. The notes table publishes
  // its `filter=all` payload back here when it fires; counts also feed the
  // chip labels in the table header so the two surfaces stay in sync.
  const [allNotes, setAllNotes] = useState<ProjectNoteRow[] | null>(null);
  const counts = useMemo(() => {
    const acc = { all: 0, imported: 0, research: 0, manual: 0 };
    for (const row of allNotes ?? []) {
      acc.all += 1;
      acc[row.kind] += 1;
    }
    return acc;
  }, [allNotes]);
  const lastActivityIso = allNotes && allNotes.length > 0
    ? allNotes[0].updated_at
    : null;

  return (
    <div data-testid="route-project" className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <header className="flex items-end justify-between gap-4">
        <ProjectMetaRow
          name={meta?.name ?? ""}
          pageCount={counts.all}
          lastActivityIso={lastActivityIso}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`${urls.workspace.research(locale, wsSlug)}?project=${projectId}`}
            className="app-hover rounded-[var(--radius-control)] border-[1.5px] border-border px-3 py-1.5 text-sm"
          >
            {t("actions.research")}
          </Link>
          <Link
            href={`${urls.workspace.import(locale, wsSlug)}?project=${projectId}`}
            className="app-hover rounded-[var(--radius-control)] border-[1.5px] border-border px-3 py-1.5 text-sm"
          >
            {t("actions.import")}
          </Link>
          <IngestUploadButton projectId={projectId} />
          <Link
            href={urls.workspace.projectAgents(locale, wsSlug, projectId)}
            className="app-hover rounded-[var(--radius-control)] border-[1.5px] border-border px-3 py-1.5 text-sm"
          >
            {t("actions.agents")}
          </Link>
          <button
            type="button"
            className="app-btn-primary rounded-[var(--radius-control)] px-3 py-1.5 text-sm"
          >
            {t("actions.newDoc")}
          </button>
        </div>
      </header>
      <ProjectNotesTable
        wsSlug={wsSlug}
        projectId={projectId}
        counts={counts}
        onLoaded={(rows) => setAllNotes(rows)}
      />
    </div>
  );
}
