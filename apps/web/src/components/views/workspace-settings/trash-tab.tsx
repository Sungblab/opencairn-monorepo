"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";

interface TrashNote {
  id: string;
  title: string;
  projectName: string;
  deletedAt: string | null;
}

export function TrashTab({ wsId }: { wsId: string }) {
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
      <h2 className="mb-3 text-lg font-semibold">{t("heading")}</h2>
      {isLoading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("loadFailed")}</p>}
      {!isLoading && !isError && notes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {notes.length > 0 && (
        <ul className="divide-y rounded border border-border">
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
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => restore.mutate(note.id)}
                  disabled={restore.isPending || destroy.isPending}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {t("restore")}
                </button>
                <button
                  type="button"
                  onClick={() => destroy.mutate(note.id)}
                  disabled={restore.isPending || destroy.isPending}
                  className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
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
