"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import type { ResearchRunSummary } from "@opencairn/shared";

export interface ResearchPlanReviewProps {
  runId: string;
  planText: string;
  status: ResearchRunSummary["status"];
}

export function ResearchPlanReview({
  runId,
  planText,
  status,
}: ResearchPlanReviewProps) {
  const t = useTranslations("research.plan_review");
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(planText);
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: researchKeys.detail(runId) });

  const sendFeedback = useMutation({
    mutationFn: (text: string) => researchApi.addTurn(runId, text),
    onSuccess: () => {
      setFeedback("");
      invalidate();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const saveEdits = useMutation({
    mutationFn: (text: string) => researchApi.updatePlan(runId, text),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const approve = useMutation({
    mutationFn: () => researchApi.approve(runId),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (status === "planning" && !planText) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h2 className="mb-2 text-xl font-semibold">{t("heading")}</h2>
      <p className="text-muted-foreground mb-4 text-sm">{t("explainer")}</p>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-64 w-full rounded border border-border p-2 font-mono text-sm"
        />
      ) : (
        <pre className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">
          {planText}
        </pre>
      )}

      {status === "planning" && planText && (
        <p className="text-muted-foreground mt-2 text-xs">{t("iterating")}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (editing) {
              saveEdits.mutate(draft);
            } else {
              setDraft(planText);
              setEditing(true);
            }
          }}
          className="rounded border border-border px-3 py-1 text-sm"
        >
          {editing ? t("edit_save") : t("edit_direct")}
        </button>
        {editing && (
          // Discard the in-flight textarea edits and return to the read view.
          // Re-entering edit mode resets the draft from `planText`, so we
          // don't need to clear it here.
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded border border-border px-3 py-1 text-sm"
          >
            {t("edit_cancel")}
          </button>
        )}
        <button
          type="button"
          onClick={() => approve.mutate()}
          disabled={approve.isPending}
          className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm"
        >
          {approve.isPending ? t("approving") : t("approve")}
        </button>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t("feedback_placeholder")}
          className="w-full rounded border border-border p-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => sendFeedback.mutate(feedback)}
            disabled={!feedback.trim() || sendFeedback.isPending}
            className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
          >
            {t("feedback_send")}
          </button>
        </div>
      </div>
      {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
    </div>
  );
}
