"use client";

import { urls } from "@/lib/urls";
import { apiClient, projectsApi } from "@/lib/api-client";
import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import {
  projectTemplates,
  type ProjectTemplateApplyRequest,
  type ProjectTemplateId,
} from "@opencairn/shared";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, BriefcaseBusiness, FlaskConical, LayoutTemplate, Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

const SOURCE_ACCEPT_ATTR = [
  "application/pdf",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".hwp",
  ".hwpx",
  "text/plain",
  "text/markdown",
  ".txt",
  ".md",
  "image/*",
  "audio/*",
  "video/*",
].join(",");

type ApplyResponse = {
  projects: Array<{ id: string; name: string; notes: Array<{ id: string; title: string }> }>;
};

export type ProjectTemplateClientLabels = {
  title: string;
  description: string;
  galleryLabel: string;
  error: string;
  quickCreate: {
    label: string;
    placeholder: string;
    button: string;
  };
  imageCreate: {
    title: string;
    description: string;
    pick: string;
    change: string;
    button: string;
  };
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
  const queryClient = useQueryClient();
  const imageInputId = useId();
  const [projectName, setProjectName] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [pendingId, setPendingId] = useState<ProjectTemplateId | null>(null);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [creatingFromImage, setCreatingFromImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { upload } = useIngestUpload();

  async function refreshProjectLists(projectId: string) {
    await queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
    await queryClient.invalidateQueries({ queryKey: ["project-meta", projectId] });
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name || creatingBlank || pendingId !== null) return;
    setCreatingBlank(true);
    setError(null);
    try {
      const project = await projectsApi.create(workspaceId, { name });
      await refreshProjectLists(project.id);
      router.push(urls.workspace.project(locale, wsSlug, project.id));
      router.refresh();
    } catch {
      setError(labels.error);
      setCreatingBlank(false);
    }
  }

  async function createProjectFromImage() {
    if (!imageFile || creatingFromImage || pendingId !== null) return;
    setCreatingFromImage(true);
    setError(null);
    try {
      const fallbackName = imageFile.name.replace(/\.[^.]+$/, "").trim() || labels.imageCreate.title;
      const project = await projectsApi.create(workspaceId, {
        name: projectName.trim() || fallbackName,
      });
      const result = await upload(imageFile, project.id);
      if (result.originalFileId) {
        openOriginalFileTab(result.originalFileId, imageFile.name);
      }
      await refreshProjectLists(project.id);
      router.push(urls.workspace.project(locale, wsSlug, project.id));
      router.refresh();
    } catch {
      setError(labels.error);
      setCreatingFromImage(false);
    }
  }

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
      await refreshProjectLists(firstProject.id);
      router.push(urls.workspace.project(locale, wsSlug, firstProject.id));
      router.refresh();
    } catch {
      setError(labels.error);
      setPendingId(null);
    }
  }

  return (
    <main
      data-testid="new-project-template-root"
      className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
    >
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-foreground">{labels.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{labels.description}</p>
      </header>
      <form
        className="grid gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 sm:grid-cols-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void createProject();
        }}
      >
        <label className="grid gap-1 text-sm font-medium text-foreground">
          {labels.quickCreate.label}
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder={labels.quickCreate.placeholder}
            maxLength={100}
            className="min-h-10 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm font-normal text-foreground outline-none transition focus:border-foreground focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="submit"
          disabled={!projectName.trim() || creatingBlank || pendingId !== null}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:self-end"
        >
          {creatingBlank ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          {labels.quickCreate.button}
        </button>
      </form>
      <section className="grid gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UploadCloud aria-hidden className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              {labels.imageCreate.title}
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {labels.imageCreate.description}
          </p>
          {imageFile ? (
            <p className="mt-2 truncate text-xs font-medium text-foreground">
              {imageFile.name}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:justify-end">
          <label
            htmlFor={imageInputId}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:border-foreground hover:bg-muted/40"
          >
            {imageFile ? labels.imageCreate.change : labels.imageCreate.pick}
          </label>
          <input
            id={imageInputId}
            type="file"
            accept={SOURCE_ACCEPT_ATTR}
            className="sr-only"
            onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={!imageFile || creatingFromImage || creatingBlank || pendingId !== null}
            onClick={() => void createProjectFromImage()}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingFromImage ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {labels.imageCreate.button}
          </button>
        </div>
      </section>
      {error ? (
        <p className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <section
        aria-label={labels.galleryLabel}
        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3"
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
              className="group flex min-h-40 flex-col justify-between rounded-[var(--radius-card)] border border-border bg-card p-4 text-left transition hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
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
