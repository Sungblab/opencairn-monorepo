"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FilePlus2,
  FileSearch,
  GitBranch,
  HelpCircle,
  ListChecks,
  PenLine,
  Search,
  ShieldCheck,
} from "lucide-react";

import type { WorkflowConsoleRun } from "@/lib/api-client";

type TimelineStepKind =
  | "readSource"
  | "searchProject"
  | "askClarification"
  | "buildPlan"
  | "preflight"
  | "createFile"
  | "updateNote"
  | "editFile"
  | "linkEvidence"
  | "needsReview"
  | "openArtifact"
  | "completed"
  | "failed";

type TimelineStep = {
  kind: TimelineStepKind;
  tone: "active" | "pending" | "success" | "warning" | "danger";
  detail?: string;
};

const STEP_ICON = {
  readSource: FileSearch,
  searchProject: Search,
  askClarification: HelpCircle,
  buildPlan: ListChecks,
  preflight: ShieldCheck,
  createFile: FilePlus2,
  updateNote: PenLine,
  editFile: PenLine,
  linkEvidence: GitBranch,
  needsReview: ClipboardCheck,
  openArtifact: ExternalLink,
  completed: CheckCircle2,
  failed: AlertTriangle,
} satisfies Record<TimelineStepKind, typeof Search>;

const STEP_ORDER: TimelineStepKind[] = [
  "readSource",
  "searchProject",
  "askClarification",
  "buildPlan",
  "preflight",
  "createFile",
  "updateNote",
  "editFile",
  "linkEvidence",
  "needsReview",
  "openArtifact",
  "completed",
  "failed",
];

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "reverted",
]);

function toneFor(run: WorkflowConsoleRun): TimelineStep["tone"] {
  if (run.status === "failed") return "danger";
  if (run.status === "completed") return "success";
  if (run.status === "approval_required" || run.status === "blocked") {
    return "warning";
  }
  if (TERMINAL_STATUSES.has(run.status)) return "pending";
  return "active";
}

function addStep(
  steps: Map<TimelineStepKind, TimelineStep>,
  kind: TimelineStepKind,
  run: WorkflowConsoleRun,
  detail?: string,
) {
  if (steps.has(kind)) return;
  steps.set(kind, {
    kind,
    tone: kind === "failed" ? "danger" : toneFor(run),
    detail: detail ?? run.title,
  });
}

export function getAgentRunTimelineSteps(
  runs: WorkflowConsoleRun[],
): TimelineStep[] {
  const steps = new Map<TimelineStepKind, TimelineStep>();
  for (const run of runs) {
    if (run.error || run.status === "failed") {
      addStep(steps, "failed", run, run.error?.message ?? run.title);
      continue;
    }
    if (run.runType === "import") {
      addStep(steps, "readSource", run);
    }
    if (run.runType === "chat" || run.agentRole === "research") {
      addStep(steps, "searchProject", run);
    }
    if (run.progress) {
      addStep(steps, "buildPlan", run);
    }
    if (run.status === "blocked") {
      addStep(steps, "askClarification", run);
    }
    if (
      run.runType === "document_generation" ||
      run.runType === "agentic_plan"
    ) {
      addStep(steps, "preflight", run);
    }
    if (run.runType === "agent_action") {
      if (run.actionKind === "note.update") {
        addStep(steps, "updateNote", run);
      } else if (run.actionKind === "file.update") {
        addStep(steps, "editFile", run);
      } else if (run.actionKind === "file.create") {
        addStep(steps, "createFile", run);
      }
    }
    if (
      run.status === "approval_required" ||
      run.approvals.some((approval) => approval.status === "requested")
    ) {
      addStep(steps, "needsReview", run);
    }
    if (
      run.outputs.some((output) =>
        ["agent_file", "document", "export", "preview"].includes(
          output.outputType,
        ),
      )
    ) {
      addStep(steps, "createFile", run);
    }
    if (run.outputs.some((output) => Boolean(output.url))) {
      addStep(steps, "openArtifact", run);
    }
    if (
      run.outputs.some((output) =>
        ["citation", "evidence", "preview"].includes(output.outputType),
      )
    ) {
      addStep(steps, "linkEvidence", run);
    }
    if (run.status === "completed") {
      addStep(steps, "completed", run);
    }
  }

  return STEP_ORDER.flatMap((kind) => {
    const step = steps.get(kind);
    return step ? [step] : [];
  });
}

function stepClassName(tone: TimelineStep["tone"]) {
  const base =
    "inline-flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1 text-xs font-medium";
  switch (tone) {
    case "active":
      return `${base} border-primary/30 bg-primary/5 text-foreground`;
    case "success":
      return `${base} border-emerald-500/25 bg-emerald-500/5 text-foreground`;
    case "warning":
      return `${base} border-amber-500/30 bg-amber-500/10 text-foreground`;
    case "danger":
      return `${base} border-destructive/30 bg-destructive/5 text-destructive`;
    case "pending":
      return `${base} border-border bg-muted/30 text-muted-foreground`;
  }
}

export function AgentRunTimeline({
  runs,
  title,
  className,
}: {
  runs: WorkflowConsoleRun[];
  title?: string;
  className?: string;
}) {
  const t = useTranslations("agentPanel.runTimeline");
  const steps = useMemo(() => getAgentRunTimelineSteps(runs), [runs]);
  if (steps.length === 0) return null;

  return (
    <section
      aria-label={title ?? t("title")}
      className={className ?? "rounded border border-border bg-background p-2.5"}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
          {title ?? t("title")}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {t("count", { count: steps.length })}
        </span>
      </div>
      <ol className="flex min-w-0 flex-wrap gap-1.5">
        {steps.map((step) => {
          const Icon = STEP_ICON[step.kind];
          return (
            <li key={step.kind} className={stepClassName(step.tone)}>
              <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t(`step.${step.kind}`)}</span>
            </li>
          );
        })}
      </ol>
      {steps.some((step) => step.kind === "failed" && step.detail) ? (
        <p className="mt-2 line-clamp-2 text-xs text-destructive">
          {steps.find((step) => step.kind === "failed")?.detail}
        </p>
      ) : null}
    </section>
  );
}
