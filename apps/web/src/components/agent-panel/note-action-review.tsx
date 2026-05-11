"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AgentAction } from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";

const REVIEWABLE_NOTE_ACTIONS = new Set([
  "note.create",
  "note.rename",
  "note.move",
  "note.delete",
  "note.restore",
]);

export function NoteActionReviewList({ projectId }: { projectId: string | null }) {
  const t = useTranslations("agentPanel.noteActionReview");
  const queryKey = ["agent-actions", projectId, "note-actions", "approval_required"];
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey,
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { actions: [] as AgentAction[] };
      const result = await agentActionsApi.list(projectId, {
        status: "approval_required",
        limit: 50,
      });
      return {
        actions: result.actions.filter((action) =>
          REVIEWABLE_NOTE_ACTIONS.has(action.kind),
        ),
      };
    },
  });
  const actions = data?.actions ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey });
  const apply = useMutation({
    mutationFn: (id: string) => agentActionsApi.apply(id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) =>
      agentActionsApi.transitionStatus(id, { status: "cancelled" }),
    onSuccess: invalidate,
  });

  if (actions.length === 0) return null;

  return (
    <section className="border-b border-border p-2" aria-label="note action review">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("title")}
      </div>
      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <NoteActionReviewCard
            key={action.id}
            action={action}
            applying={apply.isPending}
            rejecting={reject.isPending}
            onApply={() => apply.mutate(action.id)}
            onReject={() => reject.mutate(action.id)}
          />
        ))}
      </div>
    </section>
  );
}

function NoteActionReviewCard({
  action,
  applying,
  rejecting,
  onApply,
  onReject,
}: {
  action: AgentAction;
  applying: boolean;
  rejecting: boolean;
  onApply(): void;
  onReject(): void;
}) {
  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-background p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{action.kind}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {summarizeNoteAction(action)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label="reject"
            disabled={applying || rejecting}
            onClick={onReject}
            className="rounded-[var(--radius-control)] border border-border p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="apply"
            disabled={applying || rejecting}
            onClick={onApply}
            className="rounded-[var(--radius-control)] border border-foreground bg-foreground p-1 text-background disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}

function summarizeNoteAction(action: AgentAction): string {
  const input = action.input;
  if (typeof input.title === "string") return input.title;
  if (typeof input.noteId === "string") return input.noteId;
  return action.requestId;
}
