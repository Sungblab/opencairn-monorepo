"use client";

import { urls } from "@/lib/urls";
import { apiClient } from "@/lib/api-client";
import {
  projectTemplates,
  type ProjectTemplateApplyRequest,
  type ProjectTemplateId,
} from "@opencairn/shared";
import { BookOpen, BriefcaseBusiness, FlaskConical, LayoutTemplate, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ApplyResponse = {
  projects: Array<{ id: string; name: string; notes: Array<{ id: string; title: string }> }>;
};

export type ProjectTemplateClientLabels = {
  title: string;
  description: string;
  galleryLabel: string;
  error: string;
  templates: Record<
    ProjectTemplateId,
    { title: string; description: string; projectCount: string }
  >;
};

const categoryIcons = {
  blank: LayoutTemplate,
  study: BookOpen,
  research: FlaskConical,
  work: BriefcaseBusiness,
  personal: BookOpen,
};

export function NewProjectTemplateClient({
  locale,
  wsSlug,
  workspaceId,
  labels,
}: {
  locale: string;
  wsSlug: string;
  workspaceId: string;
  labels: ProjectTemplateClientLabels;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<ProjectTemplateId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function applyTemplate(templateId: ProjectTemplateId) {
    setPendingId(templateId);
    setError(null);
    try {
      const response = await apiClient<ApplyResponse>(
        `/workspaces/${workspaceId}/project-templates/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            templateId,
          } satisfies ProjectTemplateApplyRequest),
        },
      );
      const firstProject = response.projects[0];
      if (!firstProject) throw new Error("template_created_no_project");
      router.push(urls.workspace.project(locale, wsSlug, firstProject.id));
    } catch {
      setError(labels.error);
      setPendingId(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-foreground">{labels.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{labels.description}</p>
      </header>
      {error ? (
        <p className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <section
        aria-label={labels.galleryLabel}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {projectTemplates.map((template) => {
          const Icon = categoryIcons[template.category];
          const pending = pendingId === template.id;
          const templateLabels = labels.templates[template.id];
          return (
            <button
              key={template.id}
              type="button"
              disabled={pendingId !== null}
              onClick={() => applyTemplate(template.id)}
              className="group flex min-h-40 flex-col justify-between rounded-[var(--radius-card)] border border-border bg-card p-4 text-left transition hover:border-foreground hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
            >
              <span>
                <span className="mb-3 inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-border bg-background text-muted-foreground">
                  {pending ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Icon aria-hidden className="size-4" />
                  )}
                </span>
                <span className="block text-sm font-semibold text-foreground">
                  {templateLabels.title}
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  {templateLabels.description}
                </span>
              </span>
              <span className="mt-4 text-xs font-medium text-muted-foreground">
                {templateLabels.projectCount}
              </span>
            </button>
          );
        })}
      </section>
    </main>
  );
}
