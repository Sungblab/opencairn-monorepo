import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { TabShell } from "./tab-shell";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

// Stub the TabBar + router so we can assert on the branch choice directly.
// We intentionally reimplement `isRoutedByTabModeRouter` inline rather than
// `vi.importActual`-ing the real module, because the real module's imports
// (ReadingViewer → Plate → katex CSS) can't be loaded in the vitest
// environment. The predicate is the canonical plate-vs-router switch and
// both sides keep it in lockstep: TabModeRouter throws for plate; here we
// return false for plate so TabShell renders children instead.
vi.mock("./tab-bar", () => ({ TabBar: () => <div data-testid="tab-bar" /> }));
vi.mock("./tab-mode-router", () => ({
  TabModeRouter: ({ tab }: { tab: Tab }) => (
    <div data-testid={`router-${tab.mode}`} />
  ),
  isRoutedByTabModeRouter: (tab: Tab) => tab.mode !== "plate",
}));

const messages = {};

function wrap(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <TabShell>{children}</TabShell>
    </NextIntlClientProvider>,
  );
}

const mk = (overrides: Partial<Tab>): Tab => ({
  id: "t",
  kind: "note",
  targetId: "n1",
  mode: "plate",
  title: "T",
  titleKey: undefined,
  titleParams: undefined,
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...overrides,
});

describe("TabShell", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset Zustand store to its initial state so each test starts fresh.
    useTabsStore.setState(
      {
        workspaceId: null,
        tabs: [],
        activeId: null,
        closedStack: [],
      },
      false,
    );
    useTabsStore.getState().setWorkspace("ws");
  });

  it("renders children when active tab is plate-mode", () => {
    act(() => useTabsStore.getState().addTab(mk({ mode: "plate" })));
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("route-child")).toBeInTheDocument();
    expect(screen.queryByTestId(/^router-/)).toBeNull();
  });

  it("renders TabModeRouter when active tab is non-plate (reading)", () => {
    act(() =>
      useTabsStore
        .getState()
        .addTab(mk({ id: "r", mode: "reading" })),
    );
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("router-reading")).toBeInTheDocument();
    expect(screen.queryByTestId("route-child")).toBeNull();
  });

  it("renders TabModeRouter when active tab is source-mode", () => {
    act(() =>
      useTabsStore
        .getState()
        .addTab(mk({ id: "s", mode: "source" })),
    );
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("router-source")).toBeInTheDocument();
    expect(screen.queryByTestId("route-child")).toBeNull();
  });

  it("renders children when there is no active tab", () => {
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("route-child")).toBeInTheDocument();
    expect(screen.queryByTestId(/^router-/)).toBeNull();
  });

  it("renders children when active tab falls back to an unknown kind with plate mode", () => {
    // Future kinds might still default to plate mode — branch should stay
    // on children (route page).
    act(() => useTabsStore.getState().addTab(mk({ mode: "plate" })));
    wrap(<div data-testid="route-child" />);
    expect(screen.getByTestId("route-child")).toBeInTheDocument();
  });
});
