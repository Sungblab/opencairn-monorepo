"use client";

import { lazy, Suspense } from "react";
import { StaticTabListFallback } from "./static-tab-list-fallback";
import type { TabListProps } from "./tab-list-types";

const LazyStaticTabList = lazy(() =>
  import("./static-tab-list").then((mod) => ({
    default: mod.StaticTabList,
  })),
);

export function StaticTabListLoader(props: TabListProps) {
  return (
    <Suspense fallback={<StaticTabListFallback {...props} />}>
      <LazyStaticTabList {...props} />
    </Suspense>
  );
}
