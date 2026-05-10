import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import { TestShellLabelsProvider } from "./shell-labels.test-utils";
import { usePanelStore } from "@/stores/panel-store";

const mocks = vi.hoisted(() => ({
  breakpoint: "xs",
}));

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => mocks.breakpoint,
}));

vi.mock("@/components/sidebar/shell-sidebar-loader", () => ({
  ShellSidebarLoader: () => <div data-testid="app-shell-sidebar" />,
}));

vi.mock("@/components/agent-panel/agent-panel-loader", () => ({
  LazyAgentPanel: () => <aside data-testid="app-shell-agent-panel" />,
}));

vi.mock("../tab-shell/tab-shell", () => ({
  TabShell: ({ children }: { children: ReactNode }) => (
    <main data-testid="app-shell-main">{children}</main>
  ),
}));

vi.mock("./shell-resize-handle", () => ({
  ShellResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("./compact-app-shell-loader", () => ({
  CompactAppShellLoader: ({
    children,
    compactSidebarOpen,
    compactAgentPanelOpen,
  }: {
    children: ReactNode;
    compactSidebarOpen: boolean;
    compactAgentPanelOpen: boolean;
  }) => (
    <div data-testid="app-shell">
      {compactSidebarOpen ? <div data-testid="app-shell-sidebar" /> : null}
      <main data-testid="app-shell-main">{children}</main>
      {compactAgentPanelOpen ? (
        <aside data-testid="app-shell-agent-panel" />
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/ingest/ingest-overlays-loader", () => ({
  IngestOverlaysLoader: () => null,
}));

function renderCompactShell() {
  return render(
    <TestShellLabelsProvider>
      <AppShell wsSlug="e2e-mock-ws" deepResearchEnabled={false}>
        <div>route content</div>
      </AppShell>
    </TestShellLabelsProvider>,
  );
}

describe("AppShell compact sheets", () => {
  beforeEach(() => {
    mocks.breakpoint = "xs";
    usePanelStore.setState({
      compactSidebarOpen: false,
      compactAgentPanelOpen: false,
    });
  });

  it("does not mount closed compact sheet content over the route", () => {
    renderCompactShell();

    expect(screen.getByText("route content")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-shell-agent-panel")).not.toBeInTheDocument();
  });

  it("mounts compact sheet content only when the corresponding panel is open", () => {
    renderCompactShell();
    act(() => {
      usePanelStore.getState().setCompactAgentPanelOpen(true);
    });

    expect(screen.queryByTestId("app-shell-sidebar")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-shell-agent-panel")).toBeInTheDocument();
  });

  it("keeps desktop fallback side panels CSS-hidden below lg", () => {
    mocks.breakpoint = "lg";
    usePanelStore.setState({
      sidebarOpen: true,
      agentPanelOpen: true,
    });

    renderCompactShell();

    expect(screen.getByTestId("app-shell-sidebar").parentElement).toHaveClass(
      "hidden",
      "lg:block",
    );
    expect(screen.getByTestId("app-shell-agent-panel").parentElement).toHaveClass(
      "hidden",
      "lg:block",
    );
  });
});
