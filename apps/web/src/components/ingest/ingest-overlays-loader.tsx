"use client";

import dynamic from "next/dynamic";
import { useIdleReady } from "@/lib/performance/use-idle-ready";

const LazyIngestOverlays = dynamic(
  () => import("./ingest-overlays").then((mod) => mod.IngestOverlays),
  {
    ssr: false,
    loading: () => null,
  },
);

export function IngestOverlaysLoader() {
  const ready = useIdleReady({ timeout: 2000, fallbackMs: 1000 });

  if (process.env.NEXT_PUBLIC_FEATURE_LIVE_INGEST !== "true") return null;
  return ready ? <LazyIngestOverlays /> : null;
}
