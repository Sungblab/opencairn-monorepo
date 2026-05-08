"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useIngestStore } from "@/stores/ingest-store";
import { useIngestStream } from "@/hooks/use-ingest-stream";
import { IngestProgressView } from "./ingest-progress-view";
import { openIngestTab } from "./open-ingest-tab";

const SPOTLIGHT_TIMEOUT_MS = 7000;

/**
 * Full-screen overlay shown immediately after upload. Auto-collapses on:
 *   1. first figure_extracted, OR
 *   2. first unit_started/unit_parsed (any progress signal), OR
 *   3. 7-second timeout
 * Whichever fires first hides the spotlight; the dock + tab take over.
 */
export function IngestSpotlight() {
  const wfid = useIngestStore((s) => s.spotlightWfid);
  const setSpotlight = useIngestStore((s) => s.setSpotlight);
  const run = useIngestStore((s) => (wfid ? s.runs[wfid] : null));
  const t = useTranslations("ingest.spotlight");

  // Open the SSE stream while the spotlight is active so progress events
  // can drive the auto-collapse logic.
  useIngestStream(wfid);

  useEffect(() => {
    if (!wfid || !run) return;
    if (run.figures.length > 0 || run.units.current > 0) {
      setSpotlight(null);
      return;
    }
    const timer = setTimeout(() => setSpotlight(null), SPOTLIGHT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [wfid, run, setSpotlight]);

  if (!wfid || !run || run.status !== "running") return null;

  return (
    <div data-testid="ingest-spotlight" className="ingest-spotlight-overlay">
      <button
        type="button"
        className="skip-button"
        onClick={() => {
          openIngestTab(wfid, run.fileName);
          setSpotlight(null);
        }}
      >
        {t("skipToTab")}
      </button>
      <IngestProgressView wfid={wfid} mode="spotlight" />
    </div>
  );
}
