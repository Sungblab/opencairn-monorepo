"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";

interface TrashNote {
  id: string;
  title: string;
  projectName: string;
  deletedAt: string | null;
  expiresAt: string | null;
}

export function TrashTab({
  wsId,
  showHeader = true,
}: {
  wsId: string;
  showHeader?: boolean;
}) {
  const t = useTranslations("workspaceSettings.trash");
  const qc = useQueryClient();
  const queryKey = ["workspace-trash", wsId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () =>
      apiClient<{ notes: TrashNote[] }>(`/notes/trash?workspaceId=${wsId}`),
  });
  const restore = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/notes/${id}/restore`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const destroy = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/notes/${id}/permanent`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const notes = data?.notes ?? [];

  return (
    <section>
      {showHeader ? (
        <>
          <h2 className="mb-3 text-lg font-semibold">{t("heading")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("retention")}
          </p>
        </>
      ) : null}
      {isLoading && <TrashTabSkeleton />}
      {isError && <p className="text-sm text-destructive">{t("loadFailed")}</p>}
      {!isLoading && !isError && notes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {notes.length > 0 && (
        <ul className="divide-y rounded-[var(--radius-card)] border border-border">
          {notes.map((note) => (
            <li
              key={note.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{note.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t("meta", {
                    project: note.projectName,
                    date: note.deletedAt
                      ? new Date(note.deletedAt).toLocaleString()
                      : "-",
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("expires", {
                    date: note.expiresAt
                      ? new Date(note.expiresAt).toLocaleDateString()
                      : "-",
                  })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => restore.mutate(note.id)}
                  disabled={restore.isPending || destroy.isPending}
                  className="app-btn-ghost rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs disabled:opacity-50"
                >
                  {t("restore")}
                </button>
                <button
                  type="button"
                  onClick={() => destroy.mutate(note.id)}
                  disabled={restore.isPending || destroy.isPending}
                  className="rounded-[var(--radius-control)] border border-destructive/40 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  {t("deleteForever")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TrashTabSkeleton() {
  return (
    <div
      data-testid="trash-tab-skeleton"
      className="divide-y rounded-[var(--radius-card)] border border-border"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-3 p-3"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
            <div className="h-3 w-56 max-w-full animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
            <div className="h-3 w-32 animate-pulse rounded-[var(--radius-control)] bg-muted/60" />
          </div>
          <div className="flex shrink-0 gap-2">
            <div className="h-7 w-14 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
            <div className="h-7 w-16 animate-pulse rounded-[var(--radius-control)] bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
