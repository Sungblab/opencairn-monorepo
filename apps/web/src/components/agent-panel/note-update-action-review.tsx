"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseNoteUpdatePreview,
  type AgentAction,
  type NoteUpdatePreview,
} from "@opencairn/shared";

import { ApiError, agentActionsApi } from "@/lib/api-client";

interface Props {
  projectId: string | null;
}

const listKey = (projectId: string | null) => [
  "agent-actions",
  projectId ?? "_disabled_",
  "note.update",
  "draft",
];

export function NoteUpdateActionReviewList({ projectId }: Props) {
  const { data } = useQuery({
    queryKey: listKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { actions: [] };
      return agentActionsApi.list(projectId, {
        kind: "note.update",
        status: "draft",
        limit: 10,
      });
    },
  });

  const actions = (data?.actions ?? [])
    .map((action) => ({ action, preview: parseNoteUpdatePreview(action.preview) }))
    .filter((item): item is { action: AgentAction; preview: NoteUpdatePreview } =>
      Boolean(item.preview),
    );

  if (!projectId || actions.length === 0) return null;

  return (
    <div className="border-b border-border bg-background/70 p-3">
      <div className="flex flex-col gap-2">
        {actions.map(({ action, preview }) => (
          <NoteUpdateActionReviewCard
            key={action.id}
            action={action}
            preview={preview}
          />
        ))}
      </div>
    </div>
  );
}

function NoteUpdateActionReviewCard({
  action,
  preview,
}: {
  action: AgentAction;
  preview: NoteUpdatePreview;
}) {
  const t = useTranslations("agentPanel.noteUpdateReview");
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const summary = preview.diff.summary;
  const stateVector = preview.current.yjsStateVectorBase64;
  const queryKeys = useMemo(
    () => ({
      list: listKey(action.projectId),
      action: ["agent-action", action.id],
      note: ["note", preview.noteId],
      versions: ["note-versions", preview.noteId],
    }),
    [action.id, action.projectId, preview.noteId],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.list });
    void queryClient.invalidateQueries({ queryKey: queryKeys.action });
    void queryClient.invalidateQueries({ queryKey: queryKeys.note });
    void queryClient.invalidateQueries({ queryKey: queryKeys.versions });
  };

  const apply = useMutation({
    mutationFn: () => {
      if (!stateVector) {
        throw new ApiError(409, "note_update_stale_preview");
      }
      return agentActionsApi.applyNoteUpdate(action.id, {
        yjsStateVectorBase64: stateVector,
      });
    },
    onSuccess: () => {
      setMessage(t("applied"));
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.message === "note_update_stale_preview") {
        setMessage(t("staleError"));
        invalidate();
        return;
      }
      setMessage(t("applyFailed"));
    },
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
              changedBlocks: summary.changedBlocks,
              addedWords: summary.addedWords,
              removedWords: summary.removedWords,
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
            disabled={!stateVector || apply.isPending || reject.isPending}
            onClick={() => apply.mutate()}
            className="app-btn-primary flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs">
        <PreviewText label={t("currentLabel")} text={preview.current.contentText} />
        <PreviewText label={t("draftLabel")} text={preview.draft.contentText} />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t("staleWarning")}</p>
      {message ? (
        <p className="mt-2 text-xs font-medium" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function PreviewText({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-muted/25 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-foreground">{text}</p>
    </div>
  );
}
