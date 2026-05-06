"use client";

import { urls } from "@/lib/urls";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useCurrentProjectContext } from "./use-current-project";

interface WorkspaceBySlug {
  id: string;
}

interface Project {
  id: string;
  name: string;
}

export function ProjectListSection() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("sidebar.project");
  const { projectId, routeProjectId } = useCurrentProjectContext();

  const { data: workspace, isLoading: isWorkspaceLoading } = useQuery({
    queryKey: ["workspace-by-slug", wsSlug],
    enabled: Boolean(wsSlug),
    staleTime: 60_000,
    queryFn: async (): Promise<WorkspaceBySlug> => {
      const res = await fetch(
        `/api/workspaces/by-slug/${encodeURIComponent(wsSlug)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`by-slug/${wsSlug} ${res.status}`);
      return (await res.json()) as WorkspaceBySlug;
    },
  });

  const workspaceId = workspace?.id ?? null;

  const { data: projects, isLoading: isProjectsLoading } = useQuery({
    queryKey: ["projects", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`projects ${res.status}`);
      return (await res.json()) as Project[];
    },
  });

  const isLoading = isWorkspaceLoading || isProjectsLoading;

  const goNewProject = () => {
    router.push(urls.workspace.newProject(locale, wsSlug));
  };

  return (
    <section className="mx-3 mt-3 border-y border-border py-2">
      <div className="mb-1 flex min-h-7 items-center justify-between gap-2 px-1">
        <p className="text-[10px] font-bold uppercase text-muted-foreground">
          {t("list_label")}
        </p>
        <button
          type="button"
          onClick={goNewProject}
          aria-label={t("new")}
          className="grid h-6 w-6 place-items-center border border-border bg-background text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-0.5">
        {projects?.length ? (
          projects.map((project) => {
            const active = project.id === projectId;

            return (
              <button
                key={project.id}
                type="button"
                aria-current={active ? "page" : undefined}
                data-route-current={
                  project.id === routeProjectId ? "true" : undefined
                }
                onClick={() =>
                  router.push(
                    urls.workspace.project(locale, wsSlug, project.id),
                  )
                }
                className={[
                  "min-h-8 truncate border-l-2 bg-background px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-foreground font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                ].join(" ")}
              >
                {project.name}
              </button>
            );
          })
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {isLoading ? t("loading") : t("empty")}
          </p>
        )}
      </div>
    </section>
  );
}
