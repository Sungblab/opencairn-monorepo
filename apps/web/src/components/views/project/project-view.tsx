"use client";

import { useState } from "react";
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
  // its `filter=all` payload back here when it fires.
  const [allNotes, setAllNotes] = useState<ProjectNoteRow[] | null>(null);
  const pageCount = allNotes?.length ?? 0;
  const lastActivityIso = allNotes && allNotes.length > 0
    ? allNotes[0].updated_at
    : null;

  return (
    <div data-testid="route-project" className="flex flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <ProjectMetaRow
          name={meta?.name ?? ""}
          pageCount={pageCount}
          lastActivityIso={lastActivityIso}
        />
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/${locale}/app/w/${wsSlug}/research?project=${projectId}`}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t("actions.research")}
          </Link>
          <Link
            href={`/${locale}/app/w/${wsSlug}/import?project=${projectId}`}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t("actions.import")}
          </Link>
          <IngestUploadButton projectId={projectId} />
          <Link
            href={`/${locale}/app/w/${wsSlug}/p/${projectId}/agents`}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t("actions.agents")}
          </Link>
          <button
            type="button"
            className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
          >
            {t("actions.newDoc")}
          </button>
        </div>
      </header>
      <ProjectNotesTable
        wsSlug={wsSlug}
        projectId={projectId}
        onLoaded={(rows) => setAllNotes(rows)}
      />
    </div>
  );
}
