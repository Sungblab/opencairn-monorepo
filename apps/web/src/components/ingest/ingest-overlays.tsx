"use client";
import { IngestSpotlight } from "./ingest-spotlight";
import { IngestDock } from "./ingest-dock";

/**
 * Mounts the live-ingest overlay layer (spotlight + dock) inside the AppShell.
 *
 * Gated by `NEXT_PUBLIC_FEATURE_LIVE_INGEST`. The backend always publishes
 * IngestEvents (Tasks 3-7), so flipping the flag never causes a backend
 * regression — only the UI surface appears or disappears.
 */
export function IngestOverlays() {
  if (process.env.NEXT_PUBLIC_FEATURE_LIVE_INGEST !== "true") return null;
  return (
    <>
      <IngestSpotlight />
      <IngestDock />
    </>
  );
}
