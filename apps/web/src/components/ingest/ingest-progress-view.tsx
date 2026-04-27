"use client";
import { useTranslations } from "next-intl";
import { useIngestStore } from "@/stores/ingest-store";
import { IngestFigureGallery } from "./ingest-figure-gallery";
import { IngestOutlineTree } from "./ingest-outline-tree";
import { IngestPagePulse } from "./ingest-page-pulse";

export type IngestViewMode = "spotlight" | "tab" | "dock";

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
    <div className={`ingest-progress-view mode-${mode}`}>
      <header className="ingest-header">
        <h2>{fileName}</h2>
        {run.stage && <span>{t(`stage.${run.stage}`)}</span>}
        {pct !== null && <span>{pct}%</span>}
      </header>
      <div className="ingest-grid">
        <aside className="ingest-outline">
          <IngestOutlineTree nodes={run.outline} />
        </aside>
        <main className="ingest-pulse">
          <IngestPagePulse units={run.units} />
        </main>
        <aside className="ingest-figures">
          <IngestFigureGallery figures={run.figures} workflowId={wfid} />
          <span data-testid="figure-count" className="sr-only">
            {run.figures.length}
          </span>
        </aside>
      </div>
    </div>
  );
}
