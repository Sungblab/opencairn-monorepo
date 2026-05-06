"use client";
import { urls } from "@/lib/urls";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { useCurrentProjectContext } from "./use-current-project";

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
  const { projectId: currentProjectId } = useCurrentProjectContext();

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
    router.push(urls.workspace.project(locale, wsSlug, projectId));
  };
  const gotoNew = () => {
    router.push(urls.workspace.newProject(locale, wsSlug));
  };

  return (
    <div
      role="listbox"
      aria-label={t("switch_aria")}
      className="flex max-h-80 flex-col overflow-auto"
    >
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("list_label")}
        </p>
        <p className="mt-1 truncate text-sm font-semibold">
          {workspace?.name ?? t("select")}
        </p>
      </div>
      <div className="grid gap-1 p-2">
        {projects?.map((p) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={p.id === currentProjectId}
            onClick={goto(p.id)}
            className={`flex min-h-9 items-center gap-2 rounded px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none ${
              p.id === currentProjectId
                ? "bg-muted text-foreground"
                : "hover:bg-muted focus-visible:bg-muted"
            }`}
          >
            <span className="flex-1 truncate">{p.name}</span>
            {p.id === currentProjectId ? (
              <Check className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={gotoNew}
          className="mt-1 flex min-h-9 items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{t("new")}</span>
        </button>
      </div>
    </div>
  );
}
