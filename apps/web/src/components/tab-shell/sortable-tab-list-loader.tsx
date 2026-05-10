"use client";

import { lazy, Suspense } from "react";
import { StaticTabListFallback } from "./static-tab-list-fallback";
import type { TabListProps } from "./tab-list-types";

const LazySortableTabList = lazy(() =>
  import("./sortable-tab-list").then((mod) => ({
    default: mod.SortableTabList,
  })),
);

export function SortableTabListLoader(props: TabListProps) {
  return (
    <Suspense fallback={<StaticTabListFallback {...props} />}>
      <LazySortableTabList {...props} />
    </Suspense>
  );
}
