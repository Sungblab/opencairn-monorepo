"use client";
import {
  Bot,
  Check,
  FileArchive,
  FileText,
  Image,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useIngestStore,
  type IngestRunState,
} from "@/stores/ingest-store";
import { IngestFigureGallery } from "./ingest-figure-gallery";
import { IngestOutlineTree } from "./ingest-outline-tree";
import { IngestPagePulse } from "./ingest-page-pulse";

export type IngestViewMode = "spotlight" | "tab" | "dock";

type PipelineStepId =
  | "downloading"
  | "parsing"
  | "markdown"
  | "figures"
  | "enhancing"
  | "persisting";

type PipelineState = "done" | "current" | "waiting" | "failed";

const pipelineSteps: {
  id: PipelineStepId;
  icon: typeof UploadCloud;
}[] = [
  { id: "downloading", icon: UploadCloud },
  { id: "parsing", icon: FileArchive },
  { id: "markdown", icon: FileText },
  { id: "figures", icon: Image },
  { id: "enhancing", icon: Bot },
  { id: "persisting", icon: Check },
];

/**
 * Single source-of-truth for ingest progress UI. Spotlight, dock, and tab
 * containers all render this component with a different `mode`. Each mode
 * picks the appropriate density / chrome.
 */
export function IngestProgressView({
  wfid,
  mode,
}: {
  wfid: string;
  mode: IngestViewMode;
}) {
  const run = useIngestStore((s) => s.runs[wfid]);
  const t = useTranslations("ingest");
  if (!run) return null;

  const pct =
    run.units.total !== null && run.units.total > 0
      ? Math.round((run.units.current / run.units.total) * 100)
      : null;

  const fileName = run.fileName ?? "?";

  if (mode === "dock") {
    return (
      <div className="ingest-card-dock" data-testid="ingest-dock-card">
        <div className="ingest-card-name">{fileName}</div>
        <progress max={100} value={pct ?? undefined} />
        <span className="sr-only" data-testid="figure-count">
          {run.figures.length}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`ingest-progress-view mode-${mode} flex h-full min-h-0 flex-col gap-4`}
    >
      <header className="ingest-header flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {fileName}
        </h2>
        {run.stage && (
          <span className="rounded-[var(--radius-control)] bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t(`stage.${run.stage}`)}
          </span>
        )}
        {pct !== null && (
          <span className="text-xs font-medium text-muted-foreground">
            {pct}%
          </span>
        )}
      </header>

      <IngestPipeline run={run} />

      <div className="ingest-grid grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)]">
        <main className="ingest-pulse min-h-0 rounded-[var(--radius-control)] border border-border p-3">
          <IngestPagePulse units={run.units} />
        </main>
        <aside className="ingest-figures min-h-0 rounded-[var(--radius-control)] border border-border p-3">
          <IngestFigureGallery figures={run.figures} workflowId={wfid} />
          <span data-testid="figure-count" className="sr-only">
            {run.figures.length}
          </span>
        </aside>
        {run.outline.length > 0 ? (
          <aside className="ingest-outline rounded-[var(--radius-control)] border border-border p-3 lg:col-span-2">
            <IngestOutlineTree nodes={run.outline} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function IngestPipeline({ run }: { run: IngestRunState }) {
  const t = useTranslations("ingest");
  const stateByStep = resolvePipelineState(run);
  const artifactsByStep = groupArtifacts(run, t("pipeline.sourceNoteLabel"));
  const bundleLabel =
    run.bundleStatus === "completed"
      ? t("pipeline.bundleCompleted")
      : run.bundleStatus === "failed"
        ? t("pipeline.bundleFailed")
        : run.bundleNodeId
          ? t("pipeline.bundleRunning")
          : null;

  return (
    <section
      aria-label={t("pipeline.title")}
      className="rounded-[var(--radius-control)] border border-border bg-background p-3"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("pipeline.title")}</h3>
        {bundleLabel ? (
          <span className="rounded-[var(--radius-control)] bg-muted px-2 py-1 text-xs text-muted-foreground">
            {bundleLabel}
          </span>
        ) : null}
      </div>
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {pipelineSteps.map((step) => {
          const state = stateByStep[step.id];
          const artifacts = artifactsByStep[step.id] ?? [];
          const StepIcon = step.icon;
          return (
            <li
              key={step.id}
              data-testid={`ingest-pipeline-step-${step.id}`}
              data-state={state}
              className="min-h-28 rounded-[var(--radius-control)] border border-border bg-muted/20 p-3 data-[state=current]:border-primary data-[state=current]:bg-primary/5 data-[state=done]:bg-emerald-500/5 data-[state=failed]:border-destructive data-[state=failed]:bg-destructive/5"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-background text-muted-foreground ring-1 ring-border">
                  {state === "done" ? (
                    <Check aria-hidden className="h-4 w-4 text-emerald-600" />
                  ) : state === "current" ? (
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <StepIcon aria-hidden className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {t(`pipeline.${step.id}.title`)}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t(`pipeline.${state}`)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t(`pipeline.${step.id}.description`)}
                  </p>
                </div>
              </div>
              <ArtifactList
                artifacts={artifacts}
                emptyLabel={t("pipeline.emptyArtifacts")}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ArtifactList({
  artifacts,
  emptyLabel,
}: {
  artifacts: { label: string; role: string }[];
  emptyLabel: string;
}) {
  const t = useTranslations("ingest");
  if (artifacts.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground/80">{emptyLabel}</p>
    );
  }
  return (
    <ul className="mt-3 space-y-1.5">
      {artifacts.slice(0, 5).map((artifact, idx) => (
        <li
          key={`${artifact.role}-${artifact.label}-${idx}`}
          className="flex min-h-6 items-center gap-2 rounded-[var(--radius-control)] bg-background px-2 py-1 text-xs ring-1 ring-border"
        >
          <span className="min-w-0 flex-1 truncate">{artifact.label}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {t(`artifactRole.${artifactRoleKey(artifact.role)}`)}
          </span>
        </li>
      ))}
      {artifacts.length > 5 ? (
        <li className="px-2 text-xs text-muted-foreground">
          +{artifacts.length - 5}
        </li>
      ) : null}
    </ul>
  );
}

function groupArtifacts(run: IngestRunState, sourceNoteLabel: string) {
  const grouped: Record<
    PipelineStepId,
    { label: string; role: string }[]
  > = {
    downloading: [],
    parsing: [],
    markdown: [],
    figures: [],
    enhancing: [],
    persisting: [],
  };
  for (const artifact of run.artifacts) {
    grouped[stepForRole(artifact.role)].push(artifact);
  }
  if (run.noteId) {
    grouped.enhancing.push({ label: sourceNoteLabel, role: "source_note" });
  }
  return grouped;
}

function resolvePipelineState(
  run: IngestRunState,
): Record<PipelineStepId, PipelineState> {
  if (run.status === "failed") {
    const failedStep = stageToStep(run.stage) ?? "downloading";
    const failedIndex = stepIndex(failedStep);
    return Object.fromEntries(
      pipelineSteps.map((step, idx) => [
        step.id,
        step.id === failedStep
          ? "failed"
          : idx < failedIndex
            ? "done"
            : "waiting",
      ]),
    ) as Record<PipelineStepId, PipelineState>;
  }

  if (run.bundleStatus === "failed") {
    const failedIndex = stepIndex("persisting");
    return Object.fromEntries(
      pipelineSteps.map((step, idx) => [
        step.id,
        step.id === "persisting"
          ? "failed"
          : idx < failedIndex
            ? "done"
            : "waiting",
      ]),
    ) as Record<PipelineStepId, PipelineState>;
  }

  if (run.status === "completed" || run.bundleStatus === "completed") {
    return Object.fromEntries(
      pipelineSteps.map((step) => [step.id, "done"]),
    ) as Record<PipelineStepId, PipelineState>;
  }

  const current = stageToStep(run.stage) ?? "downloading";
  const currentIndex = stepIndex(current);
  const roles = new Set(run.artifacts.map((artifact) => artifact.role));
  const hasMarkdown = roles.has("parsed") || roles.has("parsed_page");
  const hasFigures = roles.has("figure") || run.figures.length > 0;

  return Object.fromEntries(
    pipelineSteps.map((step, idx) => {
      if (step.id === current) return [step.id, "current"];
      if (idx < currentIndex) return [step.id, "done"];
      if (step.id === "markdown" && hasMarkdown) return [step.id, "done"];
      if (step.id === "figures" && hasFigures) return [step.id, "done"];
      return [step.id, "waiting"];
    }),
  ) as Record<PipelineStepId, PipelineState>;
}

function stageToStep(
  stage: IngestRunState["stage"],
): PipelineStepId | null {
  if (stage === "downloading") return "downloading";
  if (stage === "parsing") return "parsing";
  if (stage === "enhancing") return "enhancing";
  if (stage === "persisting") return "persisting";
  return null;
}

function stepIndex(step: PipelineStepId) {
  return pipelineSteps.findIndex((item) => item.id === step);
}

function stepForRole(role: string): PipelineStepId {
  if (role === "parsed" || role === "parsed_page") return "markdown";
  if (role === "figure") return "figures";
  if (
    role === "source_note" ||
    role === "analysis" ||
    role === "outline" ||
    role === "tables" ||
    role === "translation" ||
    role === "summary"
  ) {
    return "enhancing";
  }
  return "persisting";
}

function artifactRoleKey(role: string) {
  if (
    role === "parsed" ||
    role === "parsed_page" ||
    role === "figure" ||
    role === "source_note" ||
    role === "analysis"
  ) {
    return role;
  }
  return "other";
}
