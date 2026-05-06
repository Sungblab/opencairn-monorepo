"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseCodeWorkspaceInstallRequest,
  parseCodeWorkspacePatchPreview,
  parseCodeWorkspacePreviewRequest,
  parseCodeWorkspacePreviewResult,
  type AgentAction,
  type CodeWorkspacePatch,
} from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";

interface Props {
  projectId: string | null;
}

const listKey = (
  projectId: string | null,
  kind: "code_project.patch" | "code_project.preview" | "code_project.install",
  status: "draft" | "approval_required" | "completed",
) => [
  "agent-actions",
  projectId ?? "_disabled_",
  kind,
  status,
];

export function CodeProjectActionReviewList({ projectId }: Props) {
  const patchQuery = useQuery({
    queryKey: listKey(projectId, "code_project.patch", "draft"),
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
  const pendingPreviewQuery = useQuery({
    queryKey: listKey(projectId, "code_project.preview", "approval_required"),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { actions: [] };
      return agentActionsApi.list(projectId, {
        kind: "code_project.preview",
        status: "approval_required",
        limit: 10,
      });
    },
  });
  const pendingInstallQuery = useQuery({
    queryKey: listKey(projectId, "code_project.install", "approval_required"),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { actions: [] };
      return agentActionsApi.list(projectId, {
        kind: "code_project.install",
        status: "approval_required",
        limit: 10,
      });
    },
  });
  const completedPreviewQuery = useQuery({
    queryKey: listKey(projectId, "code_project.preview", "completed"),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { actions: [] };
      return agentActionsApi.list(projectId, {
        kind: "code_project.preview",
        status: "completed",
        limit: 5,
      });
    },
  });

  const actions = (patchQuery.data?.actions ?? [])
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

  const pendingPreviews = (pendingPreviewQuery.data?.actions ?? [])
    .map((action) => ({
      action,
      request: parseCodeWorkspacePreviewRequest(action.input),
    }))
    .filter((item): item is {
      action: AgentAction;
      request: NonNullable<ReturnType<typeof parseCodeWorkspacePreviewRequest>>;
    } => Boolean(item.request));

  const pendingInstalls = (pendingInstallQuery.data?.actions ?? [])
    .map((action) => ({
      action,
      request: parseCodeWorkspaceInstallRequest(action.input),
    }))
    .filter((item): item is {
      action: AgentAction;
      request: NonNullable<ReturnType<typeof parseCodeWorkspaceInstallRequest>>;
    } => Boolean(item.request));

  const completedPreviews = (completedPreviewQuery.data?.actions ?? [])
    .map((action) => ({
      action,
      result: parseCodeWorkspacePreviewResult(action.result),
    }))
    .filter((item): item is {
      action: AgentAction;
      result: NonNullable<ReturnType<typeof parseCodeWorkspacePreviewResult>>;
    } => Boolean(item.result));

  if (
    !projectId ||
    (
      actions.length === 0 &&
      pendingPreviews.length === 0 &&
      pendingInstalls.length === 0 &&
      completedPreviews.length === 0
    )
  ) {
    return null;
  }

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
        {pendingPreviews.map(({ action, request }) => (
          <CodeProjectPreviewReviewCard
            key={action.id}
            action={action}
            request={request}
          />
        ))}
        {pendingInstalls.map(({ action, request }) => (
          <CodeProjectInstallReviewCard
            key={action.id}
            action={action}
            request={request}
          />
        ))}
        {completedPreviews.map(({ action, result }) => (
          <CodeProjectPreviewResultCard
            key={action.id}
            result={result}
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
      list: listKey(action.projectId, "code_project.patch", "draft"),
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

function CodeProjectInstallReviewCard({
  action,
  request,
}: {
  action: AgentAction;
  request: NonNullable<ReturnType<typeof parseCodeWorkspaceInstallRequest>>;
}) {
  const t = useTranslations("agentPanel.codeInstallReview");
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const packages = request.packages
    .map((pkg) => (pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name))
    .join(", ");
  const queryKeys = useMemo(
    () => ({
      pending: listKey(action.projectId, "code_project.install", "approval_required"),
      action: ["agent-action", action.id],
    }),
    [action.id, action.projectId],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pending });
    void queryClient.invalidateQueries({ queryKey: queryKeys.action });
  };

  const apply = useMutation({
    mutationFn: () => agentActionsApi.applyCodeProjectInstall(action.id),
    onSuccess: () => {
      setMessage(t("installApplied"));
      invalidate();
    },
    onError: () => setMessage(t("installApplyFailed")),
  });

  const reject = useMutation({
    mutationFn: () =>
      agentActionsApi.transitionStatus(action.id, { status: "cancelled" }),
    onSuccess: () => {
      setMessage(t("installCancelled"));
      invalidate();
    },
    onError: () => setMessage(t("installCancelFailed")),
  });

  return (
    <section
      aria-label={t("installTitle")}
      className="rounded-[var(--radius-card)] border border-border bg-[var(--theme-surface)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("installTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("installPackageManager", { packageManager: request.packageManager })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t("installReject")}
            disabled={reject.isPending || apply.isPending}
            onClick={() => reject.mutate()}
            className="app-btn-ghost flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("installApply")}
            disabled={apply.isPending || reject.isPending}
            onClick={() => apply.mutate()}
            className="app-btn-primary flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="mt-3 truncate text-xs text-foreground">{packages}</p>
      {request.reason ? (
        <p className="mt-2 text-xs text-muted-foreground">{request.reason}</p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">{t("installNetworkWarning")}</p>
      {message ? (
        <p className="mt-2 text-xs font-medium" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function CodeProjectPreviewReviewCard({
  action,
  request,
}: {
  action: AgentAction;
  request: NonNullable<ReturnType<typeof parseCodeWorkspacePreviewRequest>>;
}) {
  const t = useTranslations("agentPanel.codePreviewReview");
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const queryKeys = useMemo(
    () => ({
      pending: listKey(action.projectId, "code_project.preview", "approval_required"),
      completed: listKey(action.projectId, "code_project.preview", "completed"),
      action: ["agent-action", action.id],
    }),
    [action.id, action.projectId],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pending });
    void queryClient.invalidateQueries({ queryKey: queryKeys.completed });
    void queryClient.invalidateQueries({ queryKey: queryKeys.action });
  };

  const apply = useMutation({
    mutationFn: () => agentActionsApi.applyCodeProjectPreview(action.id),
    onSuccess: () => {
      setMessage(t("previewApplied"));
      invalidate();
    },
    onError: () => setMessage(t("previewApplyFailed")),
  });

  const reject = useMutation({
    mutationFn: () =>
      agentActionsApi.transitionStatus(action.id, { status: "cancelled" }),
    onSuccess: () => {
      setMessage(t("previewCancelled"));
      invalidate();
    },
    onError: () => setMessage(t("previewCancelFailed")),
  });

  return (
    <section
      aria-label={t("previewTitle")}
      className="rounded-[var(--radius-card)] border border-border bg-[var(--theme-surface)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("previewTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("previewEntry", { entryPath: request.entryPath })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t("previewReject")}
            disabled={reject.isPending || apply.isPending}
            onClick={() => reject.mutate()}
            className="app-btn-ghost flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("previewApply")}
            disabled={apply.isPending || reject.isPending}
            onClick={() => apply.mutate()}
            className="app-btn-primary flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </div>

      {request.reason ? (
        <p className="mt-3 text-xs text-foreground">{request.reason}</p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">{t("previewWarning")}</p>
      {message ? (
        <p className="mt-2 text-xs font-medium" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function CodeProjectPreviewResultCard({
  result,
}: {
  result: NonNullable<ReturnType<typeof parseCodeWorkspacePreviewResult>>;
}) {
  const t = useTranslations("agentPanel.codePreviewReview");
  const previewHref = result.publicPreviewUrl ?? result.previewUrl;
  return (
    <section
      aria-label={t("resultTitle")}
      className="rounded-[var(--radius-card)] border border-border bg-[var(--theme-surface)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("resultTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("previewEntry", { entryPath: result.entryPath })}
          </p>
        </div>
        <a
          href={previewHref}
          target="_blank"
          rel="noreferrer"
          className="app-btn-secondary flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
          aria-label={t("openPreview")}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("resultWarning")}</p>
    </section>
  );
}
