"use client";

import { urls } from "@/lib/urls";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  BookText,
  Bot,
  CheckSquare,
  DownloadCloud,
  FileText,
  FlaskConical,
  GraduationCap,
  Network,
  type LucideIcon,
} from "lucide-react";
import { projectsApi, type ProjectNoteRow } from "@/lib/api-client";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { LiteratureSearchModal } from "@/components/literature/literature-search-modal";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
} from "@/components/agent-panel/workbench-trigger-button";
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
  const workspaceId = useWorkspaceId(wsSlug);
  const [literatureOpen, setLiteratureOpen] = useState(false);
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
  const lastActivityIso =
    allNotes && allNotes.length > 0 ? allNotes[0].updated_at : null;

  return (
    <div
      data-testid="route-project"
      className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8"
    >
      <header>
        <ProjectMetaRow
          name={meta?.name ?? ""}
          pageCount={counts.all}
          lastActivityIso={lastActivityIso}
        />
      </header>
      <section aria-labelledby="project-tools-heading" className="space-y-3">
        <div>
          <h2
            id="project-tools-heading"
            className="text-sm font-medium text-foreground"
          >
            {t("tools.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("tools.description")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <ToolCommandButton
            commandId="research"
            icon={FlaskConical}
            title={t("tools.research.title")}
            description={t("tools.research.description")}
          />
          <ToolLink
            href={`${urls.workspace.import(locale, wsSlug)}?project=${projectId}`}
            icon={DownloadCloud}
            title={t("tools.import.title")}
            description={t("tools.import.description")}
          />
          <ToolButton
            icon={BookText}
            title={t("tools.literature.title")}
            description={t("tools.literature.description")}
            onClick={() => setLiteratureOpen(true)}
          />
          <ToolLink
            href={urls.workspace.projectGraph(locale, wsSlug, projectId)}
            icon={Network}
            title={t("tools.graph.title")}
            description={t("tools.graph.description")}
          />
          <ToolLink
            href={urls.workspace.projectAgents(locale, wsSlug, projectId)}
            icon={Bot}
            title={t("tools.agents.title")}
            description={t("tools.agents.description")}
          />
          <ToolActivityButton
            icon={Activity}
            title={t("tools.runs.title")}
            description={t("tools.runs.description")}
          />
          <ToolLink
            href={urls.workspace.projectLearn(locale, wsSlug, projectId)}
            icon={GraduationCap}
            title={t("tools.learn.title")}
            description={t("tools.learn.description")}
          />
          <ToolActivityButton
            icon={FileText}
            title={t("tools.generateDocument.title")}
            description={t("tools.generateDocument.description")}
            emphasis
          />
          <ToolActivityButton
            icon={CheckSquare}
            title={t("tools.reviewInbox.title")}
            description={t("tools.reviewInbox.description")}
          />
        </div>
      </section>
      <ProjectNotesTable
        wsSlug={wsSlug}
        projectId={projectId}
        counts={counts}
        onLoaded={(rows) => setAllNotes(rows)}
      />
      <LiteratureSearchModal
        open={literatureOpen}
        onOpenChange={setLiteratureOpen}
        workspaceId={workspaceId}
        defaultProjectId={projectId}
      />
    </div>
  );
}

function ToolLink({
  href,
  icon: Icon,
  title,
  description,
  emphasis = false,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        emphasis
          ? "group flex min-h-24 flex-col gap-2 rounded-[var(--radius-control)] border border-primary/40 bg-primary px-3 py-3 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "group flex min-h-24 flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-3 text-foreground transition-colors hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      <Icon
        aria-hidden
        className={
          emphasis
            ? "h-4 w-4 text-primary-foreground/80"
            : "h-4 w-4 text-muted-foreground group-hover:text-foreground"
        }
      />
      <span className="text-sm font-medium">{title}</span>
      <span
        className={
          emphasis
            ? "line-clamp-2 text-xs text-primary-foreground/75"
            : "line-clamp-2 text-xs text-muted-foreground"
        }
      >
        {description}
      </span>
    </Link>
  );
}

function ToolCommandButton({
  commandId,
  icon: Icon,
  title,
  description,
  emphasis = false,
}: {
  commandId: Parameters<typeof WorkbenchCommandButton>[0]["commandId"];
  icon: LucideIcon;
  title: string;
  description: string;
  emphasis?: boolean;
}) {
  return (
    <WorkbenchCommandButton
      commandId={commandId}
      className={
        emphasis
          ? "group flex min-h-24 flex-col gap-2 rounded-[var(--radius-control)] border border-primary/40 bg-primary px-3 py-3 text-left text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "group flex min-h-24 flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-3 text-left text-foreground transition-colors hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      <Icon
        aria-hidden
        className={
          emphasis
            ? "h-4 w-4 text-primary-foreground/80"
            : "h-4 w-4 text-muted-foreground group-hover:text-foreground"
        }
      />
      <span className="text-sm font-medium">{title}</span>
      <span
        className={
          emphasis
            ? "line-clamp-2 text-xs text-primary-foreground/75"
            : "line-clamp-2 text-xs text-muted-foreground"
        }
      >
        {description}
      </span>
    </WorkbenchCommandButton>
  );
}

function ToolActivityButton({
  icon: Icon,
  title,
  description,
  emphasis = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  emphasis?: boolean;
}) {
  return (
    <WorkbenchActivityButton
      className={
        emphasis
          ? "group flex min-h-24 flex-col gap-2 rounded-[var(--radius-control)] border border-primary/40 bg-primary px-3 py-3 text-left text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "group flex min-h-24 flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-3 text-left text-foreground transition-colors hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      <Icon
        aria-hidden
        className={
          emphasis
            ? "h-4 w-4 text-primary-foreground/80"
            : "h-4 w-4 text-muted-foreground group-hover:text-foreground"
        }
      />
      <span className="text-sm font-medium">{title}</span>
      <span
        className={
          emphasis
            ? "line-clamp-2 text-xs text-primary-foreground/75"
            : "line-clamp-2 text-xs text-muted-foreground"
        }
      >
        {description}
      </span>
    </WorkbenchActivityButton>
  );
}

function ToolButton({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-24 flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-3 text-left text-foreground transition-colors hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon
        aria-hidden
        className="h-4 w-4 text-muted-foreground group-hover:text-foreground"
      />
      <span className="text-sm font-medium">{title}</span>
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
