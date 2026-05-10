import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { TabModeRouter } from "./tab-mode-router";
import type { Tab } from "@/stores/tabs-store";

// Shallow-mock the heavy viewers; the router's job is just dispatch. Their
// own tests cover behavior.
vi.mock("./routed-viewer-loader", () => ({
  LazyReadingViewer: () => <div data-testid="reading-viewer" />,
  LazySourceViewer: () => <div data-testid="source-viewer" />,
  LazyDataViewer: () => <div data-testid="data-viewer" />,
  LazyCanvasViewer: () => <div data-testid="canvas-viewer" />,
  LazyProjectGraphViewer: () => <div data-testid="project-graph-viewer" />,
  LazyIngestViewer: () => <div data-testid="ingest-viewer" />,
  LazyLitSearchViewer: () => <div data-testid="lit-search-viewer" />,
  LazyAgentFileViewer: () => <div data-testid="agent-file-viewer" />,
  LazyCodeWorkspaceViewer: () => <div data-testid="code-workspace-viewer" />,
}));

const mk = (mode: Tab["mode"]): Tab => ({
  id: "t", kind: "note", targetId: "n1", mode,
  title: "T", titleKey: undefined, titleParams: undefined,
  pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0,
});

const messages = {
  appShell: { viewers: { stub: { unavailable: "{mode} unavailable" } } },
};

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("TabModeRouter", () => {
  it("dispatches reading → ReadingViewer", () => {
    wrap(<TabModeRouter tab={mk("reading")} />);
    expect(screen.getByTestId("reading-viewer")).toBeInTheDocument();
  });

  it("dispatches source → SourceViewer", () => {
    wrap(<TabModeRouter tab={mk("source")} />);
    expect(screen.getByTestId("source-viewer")).toBeInTheDocument();
  });

  it("dispatches data → DataViewer", () => {
    wrap(<TabModeRouter tab={mk("data")} />);
    expect(screen.getByTestId("data-viewer")).toBeInTheDocument();
  });

  it("dispatches canvas → CanvasViewer", () => {
    wrap(<TabModeRouter tab={mk("canvas")} />);
    expect(screen.getByTestId("canvas-viewer")).toBeInTheDocument();
  });

  it("falls back to StubViewer for non-core modes", () => {
    wrap(<TabModeRouter tab={mk("whiteboard")} />);
    expect(screen.getByTestId("stub-viewer")).toBeInTheDocument();
  });

  it("throws when given plate mode (should be routed via route children)", () => {
    // plate goes through Next.js route children (TabShell branch), not
    // TabModeRouter. Any caller that routes plate here has a bug — fail loudly.
    expect(() => wrap(<TabModeRouter tab={mk("plate")} />)).toThrow(
      /plate.*children/i,
    );
  });

  it("dispatches graph → ProjectGraphViewer", () => {
    wrap(<TabModeRouter tab={mk("graph")} />);
    expect(screen.getByTestId("project-graph-viewer")).toBeInTheDocument();
  });

  it("dispatches code-workspace → CodeWorkspaceViewer", () => {
    wrap(
      <TabModeRouter
        tab={{
          ...mk("code-workspace"),
          kind: "code_workspace",
          targetId: "cw-1",
        }}
      />,
    );
    expect(screen.getByTestId("code-workspace-viewer")).toBeInTheDocument();
  });
});
