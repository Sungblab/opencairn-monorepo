"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Code2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { newTab } from "@/lib/tab-factory";
import { urls } from "@/lib/urls";
import { useTabsStore } from "@/stores/tabs-store";

interface CodeWorkspaceCreateResponse {
  workspace: {
    id: string;
    name: string;
  };
}

export function NewCodeWorkspaceButton({
  projectId,
}: {
  projectId: string;
}) {
  const t = useTranslations("codeWorkspaces.create");
  const locale = useLocale();
  const router = useRouter();
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const qc = useQueryClient();
  const tabs = useTabsStore();
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/code-workspaces`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: t("defaultName"),
          manifest: {
            entries: [],
          },
        }),
      });
      if (!res.ok) throw new Error(`code-workspace ${res.status}`);
      return (await res.json()) as CodeWorkspaceCreateResponse;
    },
    onSuccess: ({ workspace }) => {
      const existing = tabs.findTabByTarget("code_workspace", workspace.id);
      if (existing) {
        tabs.setActive(existing.id);
      } else {
        tabs.addTab(
          newTab({
            kind: "code_workspace",
            targetId: workspace.id,
            title: workspace.name,
            mode: "code-workspace",
            preview: false,
          }),
        );
      }
      if (wsSlug) {
        router.push(urls.workspace.codeWorkspace(locale, wsSlug, workspace.id));
      }
      void qc.invalidateQueries({ queryKey: ["project-tree", projectId] });
    },
    onError: () => toast.error(t("failed")),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="w-full justify-start gap-2 rounded-[var(--radius-control)]"
      data-testid="new-code-workspace-button"
    >
      <Code2 className="h-4 w-4" />
      {t("button")}
    </Button>
  );
}
