"use client";
import { urls } from "@/lib/urls";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function NewCanvasButton({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectId: string;
}) {
  const locale = useLocale();
  const t = useTranslations("canvas");
  const router = useRouter();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      api.createNote({
        projectId,
        title: t("tab.untitled"),
        sourceType: "canvas",
        canvasLanguage: "python",
        contentText: "",
    }),
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
      className="w-full justify-start gap-2"
      data-testid="new-canvas-button"
    >
      <Plus className="h-4 w-4" />
      {t("sidebar.newCanvas")}
    </Button>
  );
}
