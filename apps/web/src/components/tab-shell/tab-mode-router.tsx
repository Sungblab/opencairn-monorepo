"use client";
import type { Tab } from "@/stores/tabs-store";
import { ReadingViewer } from "./viewers/reading-viewer";
import { SourceViewer } from "./viewers/source-viewer";
import { DataViewer } from "./viewers/data-viewer";
import { CanvasViewer } from "./viewers/canvas-viewer";
import { StubViewer } from "./viewers/stub-viewer";

export function TabModeRouter({ tab }: { tab: Tab }) {
  switch (tab.mode) {
    case "reading":
      return <ReadingViewer tab={tab} />;
    case "source":
      return <SourceViewer tab={tab} />;
    case "data":
      return <DataViewer tab={tab} />;
    case "canvas":
      return <CanvasViewer tab={tab} />;
    case "plate":
      // plate renders through the Next.js route page; TabShell should pick
      // children when mode === 'plate'. Reaching here means a caller bypassed
      // that branch.
      throw new Error(
        "TabModeRouter received plate mode — plate is dispatched via route children, not here.",
      );
    default:
      return <StubViewer mode={tab.mode} />;
  }
}

/**
 * Predicate used by TabShell to decide the top-level branch: plate → render
 * `children` (SSR editor page), everything else → TabModeRouter. Exported
 * here so both TabShell and its own tests use the same decision.
 */
export function isRoutedByTabModeRouter(tab: Tab): boolean {
  return tab.mode !== "plate";
}
