"use client";

// Bridges an AI-emitted ViewSpec into the two surfaces the rest of the
// graph stack already reads from:
//   1. `useViewStateStore.setInline` so `useProjectGraph` returns the spec
//      verbatim instead of re-fetching the canonical view (Task 14).
//   2. The URL — `?view=<viewType>&root=<rootId>` — so a refresh, share,
//      or browser-back lands the user on the same view, and the
//      `ViewSwitcher` segmented control reflects the active view.
//
// Other query params (`relation`, `q`, etc.) are preserved so the dialog
// doesn't accidentally clear filters the user set before opening it.
// `router.replace` (not `push`) keeps the AI step out of the back-stack —
// the user shouldn't have to press Back twice to escape an applied spec.

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ViewSpec } from "@opencairn/shared";
import { useViewStateStore } from "./view-state-store";

export function useViewSpecApply() {
  const router = useRouter();
  const params = useSearchParams();
  const setInline = useViewStateStore((s) => s.setInline);

  return useCallback(
    (spec: ViewSpec, projectId: string) => {
      setInline(projectId, spec);
      const next = new URLSearchParams(params.toString());
      next.set("view", spec.viewType);
      if (spec.rootId) next.set("root", spec.rootId);
      else next.delete("root");
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, params, setInline],
  );
}
