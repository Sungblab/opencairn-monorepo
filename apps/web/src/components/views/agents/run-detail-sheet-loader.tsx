"use client";

import dynamic from "next/dynamic";
import type { RunDetailSheetProps } from "./run-detail-sheet";

const LazyRunDetailSheet = dynamic<RunDetailSheetProps>(
  () => import("./run-detail-sheet").then((mod) => mod.RunDetailSheet),
  {
    ssr: false,
    loading: () => null,
  },
);

export function RunDetailSheetLoader(props: RunDetailSheetProps) {
  if (!props.open || !props.run) return null;
  return <LazyRunDetailSheet {...props} />;
}
