"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseCodeWorkspacePatchPreview,
  type AgentAction,
  type CodeWorkspacePatch,
} from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";

interface Props {
  projectId: string | null;
}

const listKey = (projectId: string | null) => [
  "agent-actions",
  projectId ?? "_disabled_",
  "code_project.patch",
  "draft",
];

export function CodeProjectActionReviewList({ projectId }: Props) {
  const { data } = useQuery({
    queryKey: listKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { actions: [] };
      return agentActionsApi.list(projectId, {
        kind: "code_project.patch",
        status: "draft",
        limit: 10,
      });
    },
  });

  const actions = (data?.actions ?? [])
    .map((action) => ({
      action,
      preview: parseCodeWorkspacePatchPreview(action.preview),
      patch: action.input as Partial<CodeWorkspacePatch>,
    }))
    .filter((item): item is {
      action: AgentAction;
      preview: NonNullable<ReturnType<typeof parseCodeWorkspacePatchPreview>>;
      patch: Partial<CodeWorkspacePatch>;
    } => Boolean(item.preview));

  if (!projectId || actions.length === 0) return null;

  return (
    <div className="border-b border-border bg-background/70 p-3">
      <div className="flex flex-col gap-2">
        {actions.map(({ action, preview, patch }) => (
          <CodeProjectActionReviewCard
            key={action.id}
            action={action}
            preview={preview}
            patch={patch}
          />
        ))}
      </div>
    </div>
  );
}

function CodeProjectActionReviewCard({
  action,
  preview,
  patch,
}: {
  action: AgentAction;
  preview: NonNullable<ReturnType<typeof parseCodeWorkspacePatchPreview>>;
  patch: Partial<CodeWorkspacePatch>;
}) {
  const t = useTranslations("agentPanel.codeProjectReview");
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const operations = patch.operations ?? [];
  const queryKeys = useMemo(
    () => ({
      list: listKey(action.projectId),
      action: ["agent-action", action.id],
      workspace: ["code-workspace", patch.codeWorkspaceId],
      tree: ["project-tree", action.projectId],
    }),
    [action.id, action.projectId, patch.codeWorkspaceId],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.list });
    void queryClient.invalidateQueries({ queryKey: queryKeys.action });
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tree });
  };

  const apply = useMutation({
    mutationFn: () => agentActionsApi.applyCodeProjectPatch(action.id),
    onSuccess: () => {
      setMessage(t("applied"));
      invalidate();
    },
    onError: () => setMessage(t("applyFailed")),
  });

  const reject = useMutation({
    mutationFn: () =>
      agentActionsApi.transitionStatus(action.id, { status: "cancelled" }),
    onSuccess: () => {
      setMessage(t("cancelled"));
      invalidate();
    },
    onError: () => setMessage(t("cancelFailed")),
  });

  return (
    <section
      aria-label={t("title")}
      className="rounded-[var(--radius-card)] border border-border bg-[var(--theme-surface)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("diffSummary", {
              filesChanged: preview.filesChanged,
              additions: preview.additions,
              deletions: preview.deletions,
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t("reject")}
            disabled={reject.isPending || apply.isPending}
            onClick={() => reject.mutate()}
            className="app-btn-ghost flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("apply")}
            disabled={apply.isPending || reject.isPending}
            onClick={() => apply.mutate()}
            className="app-btn-primary flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-foreground">{preview.summary}</p>
      {operations.length > 0 ? (
        <div className="mt-3 rounded-[var(--radius-card)] border border-border bg-muted/25 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
            {t("operationLabel")}
          </div>
          <ul className="grid gap-1 text-xs">
            {operations.slice(0, 5).map((operation, index) => (
              <li key={`${operation.op}:${operation.path}:${index}`} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">{operation.op}</span>
                <span className="min-w-0 truncate">{operation.path}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">{t("staleWarning")}</p>
      {message ? (
        <p className="mt-2 text-xs font-medium" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
