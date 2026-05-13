"use client";
import { urls } from "@/lib/urls";
import { projectsApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
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
  const queryClient = useQueryClient();
  const t = useTranslations("sidebar.project");
  const { projectId: currentProjectId } = useCurrentProjectContext();
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

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

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      projectsApi.update(id, { name }),
    onSuccess: async (_project, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project", variables.id] }),
        queryClient.invalidateQueries({ queryKey: ["project-meta", variables.id] }),
      ]);
      setEditingProjectId(null);
      setDraftName("");
      router.refresh();
    },
  });

  const goto = (projectId: string) => () => {
    router.push(urls.workspace.project(locale, wsSlug, projectId));
  };
  const gotoNew = () => {
    router.push(urls.workspace.newProject(locale, wsSlug));
  };

  function startRename(project: Project) {
    setEditingProjectId(project.id);
    setDraftName(project.name);
  }

  function saveRename(project: Project) {
    const name = draftName.trim();
    if (!name || name === project.name || renameMutation.isPending) {
      setEditingProjectId(null);
      setDraftName("");
      return;
    }
    renameMutation.mutate({ id: project.id, name });
  }

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
        {projects?.map((p) => {
          const active = p.id === currentProjectId;
          const editing = p.id === editingProjectId;
          return (
            <div
              key={p.id}
              role="option"
              aria-selected={active}
              className={`flex min-h-9 items-center gap-1 rounded px-2 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-muted text-foreground"
                  : "hover:bg-muted focus-within:bg-muted"
              }`}
            >
              {editing ? (
                <>
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveRename(p);
                      if (event.key === "Escape") {
                        setEditingProjectId(null);
                        setDraftName("");
                      }
                    }}
                    autoFocus
                    maxLength={100}
                    aria-label={t("rename_input")}
                    className="min-h-7 min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => saveRename(p)}
                    disabled={!draftName.trim() || renameMutation.isPending}
                    aria-label={t("rename_save")}
                    className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check aria-hidden className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProjectId(null);
                      setDraftName("");
                    }}
                    aria-label={t("rename_cancel")}
                    className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={goto(p.id)}
                    className="min-w-0 flex-1 truncate py-0.5 text-left focus-visible:outline-none"
                  >
                    {p.name}
                  </button>
                  {active ? (
                    <Check className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      startRename(p);
                    }}
                    aria-label={t("rename")}
                    className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground opacity-80 hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
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
