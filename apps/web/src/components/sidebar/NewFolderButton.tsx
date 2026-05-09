"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function NewFolderButton({ projectId }: { projectId: string }) {
  const t = useTranslations("sidebar");
  const tToast = useTranslations("sidebar.toasts");
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      api.createFolder({
        projectId,
        parentId: null,
        name: t("untitled_folder"),
      }),
    onSuccess: () => {
      toast.success(tToast("folder_created"));
      void qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
    },
    onError: () => toast.error(tToast("create_folder_failed")),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      className="w-full justify-start gap-2"
      data-testid="new-folder-button"
    >
      <FolderPlus className="h-4 w-4" />
      {t("new_folder")}
    </Button>
  );
}
