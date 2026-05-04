"use client";
import { urls } from "@/lib/urls";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";

interface WorkspaceBySlug {
  id: string;
}

interface Project {
  id: string;
  name: string;
}

// Shown inside the sidebar when the current route has no projectId. Dashboard
// and settings routes still belong to a workspace, so list existing projects
// instead of implying the user needs to create one from scratch.
export function SidebarEmptyState() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("sidebar.project");

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

  if (projects?.length) {
    return (
      <div className="flex flex-1 flex-col gap-2 overflow-auto px-3 py-2">
        <p className="px-1 text-[11px] font-medium uppercase text-muted-foreground">
          {t("list_label")}
        </p>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() =>
              router.push(urls.workspace.project(locale, wsSlug, project.id))
            }
            className="min-h-7 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            {project.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => router.push(urls.workspace.newProject(locale, wsSlug))}
          className="mt-1 min-h-7 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          + {t("new")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {isLoading ? t("loading") : t("empty")}
      </p>
      <button
        type="button"
        onClick={() =>
          router.push(urls.workspace.newProject(locale, wsSlug))
        }
        className="min-h-7 rounded border border-border px-3 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        {t("create_cta")}
      </button>
    </div>
  );
}
