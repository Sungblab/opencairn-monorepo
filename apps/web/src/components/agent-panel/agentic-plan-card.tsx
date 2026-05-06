"use client";

import { useMemo, useState } from "react";
import { Play, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgenticPlan } from "@opencairn/shared";

import { agenticPlansApi } from "@/lib/api-client";

interface Props {
  projectId: string | null;
}

const listKey = (projectId: string | null) => [
  "agentic-plans",
  projectId ?? "_disabled_",
];

export function AgenticPlanCard({ projectId }: Props) {
  const t = useTranslations("agentPanel.agenticPlan");
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const query = useQuery({
    queryKey: listKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { plans: [] };
      return agenticPlansApi.list(projectId, { limit: 3 });
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listKey(projectId) });
    void queryClient.invalidateQueries({
      queryKey: ["workflow-console-runs", projectId],
    });
  };

  const create = useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error("missing_project");
      return agenticPlansApi.create(projectId, { goal: goal.trim() });
    },
    onSuccess: () => {
      setGoal("");
      invalidate();
    },
  });

  const start = useMutation({
    mutationFn: (planId: string) => {
      if (!projectId) throw new Error("missing_project");
      return agenticPlansApi.start(projectId, planId, {});
    },
    onSuccess: invalidate,
  });

  const recover = useMutation({
    mutationFn: (input: { planId: string; stepId: string }) => {
      if (!projectId) throw new Error("missing_project");
      return agenticPlansApi.recover(projectId, input.planId, {
        stepId: input.stepId,
        strategy: "manual_review",
      });
    },
    onSuccess: invalidate,
  });

  if (!projectId) return null;

  const plans = query.data?.plans ?? [];
  const busy = create.isPending || start.isPending || recover.isPending;
  const canCreate = goal.trim().length >= 3 && !busy;

  return (
    <section
      aria-label={t("title")}
      className="border-b border-border bg-background/70 p-3"
    >
      <div className="rounded-[var(--radius-card)] border border-border bg-[var(--theme-surface)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          {query.isFetching ? (
            <span className="text-[11px] text-muted-foreground">
              {t("refreshing")}
            </span>
          ) : null}
        </div>

        <label className="block text-xs font-medium text-muted-foreground">
          {t("goalLabel")}
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={t("goalPrompt")}
            rows={2}
            className="mt-1 min-h-16 w-full resize-none rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => create.mutate()}
            className="app-btn-primary inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("create")}
          </button>
        </div>

        {query.isError ? (
          <p className="mt-3 text-xs text-destructive">{t("loadFailed")}</p>
        ) : null}
        {create.isError || start.isError || recover.isError ? (
          <p className="mt-3 text-xs text-destructive">{t("actionFailed")}</p>
        ) : null}

        <div className="mt-3 space-y-2">
          {query.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("loading")}</p>
          ) : null}
          {!query.isLoading && plans.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("empty")}</p>
          ) : null}
          {plans.map((plan) => (
            <AgenticPlanSummary
              key={plan.id}
              plan={plan}
              busy={busy}
              onStart={() => start.mutate(plan.id)}
              onRecover={(stepId) => recover.mutate({ planId: plan.id, stepId })}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AgenticPlanSummary({
  plan,
  busy,
  onStart,
  onRecover,
}: {
  plan: AgenticPlan;
  busy: boolean;
  onStart: () => void;
  onRecover: (stepId: string) => void;
}) {
  const t = useTranslations("agentPanel.agenticPlan");
  const completed = useMemo(
    () => plan.steps.filter((step) => step.status === "completed").length,
    [plan.steps],
  );
  const recoverable = plan.steps.find((step) =>
    ["failed", "blocked", "cancelled"].includes(step.status),
  );
  const issue = plan.steps.find((step) =>
    ["failed", "blocked"].includes(step.status)
    && (step.errorCode || step.errorMessage),
  );

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-background px-2.5 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {plan.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`status.${plan.status}`)} · {t("progress", {
              completed,
              total: plan.steps.length,
            })}
          </p>
        </div>
        <span
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          {plan.steps.length}
        </span>
      </div>

      <ol className="mt-2 space-y-1">
        {plan.steps.slice(0, 3).map((step) => (
          <li
            key={step.id}
            className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusTone(step.status)}`}
            />
            <span className="truncate">{step.title}</span>
            <span className="shrink-0">{t(`stepStatus.${step.status}`)}</span>
          </li>
        ))}
      </ol>

      {issue ? (
        <p className="mt-2 text-xs text-destructive">
          {t("stepIssue", {
            reason: issue.errorCode ?? issue.errorMessage ?? issue.status,
          })}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {recoverable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRecover(recoverable.id)}
            className="app-btn-ghost inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("recover")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || plan.status === "completed" || plan.status === "cancelled"}
          onClick={onStart}
          className="app-btn-ghost inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs"
        >
          <Play className="h-3.5 w-3.5" aria-hidden />
          {t("start")}
        </button>
      </div>
    </article>
  );
}

function statusTone(status: AgenticPlan["steps"][number]["status"]): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "failed" || status === "cancelled") return "bg-destructive";
  if (status === "blocked" || status === "approval_required") return "bg-amber-500";
  return "bg-primary";
}
