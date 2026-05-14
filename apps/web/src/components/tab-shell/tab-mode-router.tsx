"use client";
import type { Tab } from "@/stores/tabs-store";
import {
  LazyAgentFileViewer,
  LazyAgentPanelViewer,
  LazyCanvasViewer,
  LazyCodeWorkspaceViewer,
  LazyDataViewer,
  LazyIngestViewer,
  LazyLitSearchViewer,
  LazyProjectGraphViewer,
  LazyReadingViewer,
  LazySourceViewer,
} from "./routed-viewer-loader";
import { StubViewer } from "./viewers/stub-viewer";
export { isRoutedByTabModeRouter } from "./tab-mode-routing";

export function TabModeRouter({ tab }: { tab: Tab }) {
  switch (tab.mode) {
    case "reading":
      return <LazyReadingViewer tab={tab} />;
    case "source":
      return <LazySourceViewer tab={tab} />;
    case "data":
      return <LazyDataViewer tab={tab} />;
    case "canvas":
      return <LazyCanvasViewer tab={tab} />;
    case "graph":
      return <LazyProjectGraphViewer tab={tab} />;
    case "ingest":
      return <LazyIngestViewer tab={tab} />;
    case "lit-search":
      return <LazyLitSearchViewer tab={tab} />;
    case "agent-file":
      return <LazyAgentFileViewer tab={tab} />;
    case "agent-panel":
      return <LazyAgentPanelViewer tab={tab} />;
    case "code-workspace":
      return <LazyCodeWorkspaceViewer tab={tab} />;
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
