"use client";
import { urls } from "@/lib/urls";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function NewNoteButton({
  workspaceSlug,
  projectId,
  children,
  className = "w-full justify-start gap-2",
}: {
  workspaceSlug: string;
  projectId: string;
  children?: ReactNode;
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("sidebar");
  const router = useRouter();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.createNote({ projectId }),
    onSuccess: (note) => {
      router.push(urls.workspace.note(locale, workspaceSlug, note.id));
      queueMicrotask(() => {
        void qc.invalidateQueries({
          queryKey: ["notes-by-project", projectId],
        });
        void qc.invalidateQueries({
          queryKey: ["project-tree", projectId],
        });
      });
    },
  });
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      className={className}
      data-testid="new-note-button"
    >
      {children ?? (
        <>
          {m.isPending ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Plus aria-hidden className="h-4 w-4" />
          )}
          <span className="truncate">
            {m.isPending ? t("creating_note") : t("new_note")}
          </span>
        </>
      )}
    </Button>
  );
}
