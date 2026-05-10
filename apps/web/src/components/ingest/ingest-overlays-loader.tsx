"use client";

import dynamic from "next/dynamic";

const LazyIngestOverlays = dynamic(
  () => import("./ingest-overlays").then((mod) => mod.IngestOverlays),
  {
    ssr: false,
    loading: () => null,
  },
);

export function IngestOverlaysLoader() {
  if (process.env.NEXT_PUBLIC_FEATURE_LIVE_INGEST !== "true") return null;
  return <LazyIngestOverlays />;
}
