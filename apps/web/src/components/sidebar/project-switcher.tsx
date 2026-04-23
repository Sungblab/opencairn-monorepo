"use client";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";

interface WorkspaceByslug {
  id: string;
  slug: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  lastActivityAt?: string | null;
}

// Popover body for switching projects inside the current workspace.
// Resolves wsSlug → wsId via /api/workspaces/by-slug/:slug (cached by
// react-query) and then lists projects under that workspace.
export function ProjectSwitcher() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("sidebar.project");

  const { data: workspace } = useQuery({
    queryKey: ["workspace-by-slug", wsSlug],
    enabled: Boolean(wsSlug),
    staleTime: 60_000,
    queryFn: async (): Promise<WorkspaceByslug> => {
      const res = await fetch(
        `/api/workspaces/by-slug/${encodeURIComponent(wsSlug)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`by-slug/${wsSlug} ${res.status}`);
      return (await res.json()) as WorkspaceByslug;
    },
  });

  const workspaceId = workspace?.id ?? null;

  const { data: projects } = useQuery({
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

  const goto = (projectId: string) => () => {
    router.push(`/${locale}/app/w/${wsSlug}/p/${projectId}`);
  };
  const gotoNew = () => {
    router.push(`/${locale}/app/w/${wsSlug}/new-project`);
  };

  return (
    <div
      role="listbox"
      aria-label={t("switch_aria")}
      className="flex max-h-80 flex-col overflow-auto p-1"
    >
      {projects?.map((p) => (
        <button
          key={p.id}
          type="button"
          role="option"
          aria-selected={false}
          onClick={goto(p.id)}
          className="truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          {p.name}
        </button>
      ))}
      <button
        type="button"
        onClick={gotoNew}
        className="mt-1 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        + {t("new")}
      </button>
    </div>
  );
}
