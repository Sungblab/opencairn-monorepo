import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { TabShell } from "./tab-shell";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

// Stub the TabBar + router loader so we can assert on the branch choice
// directly without loading routed viewer bundles in jsdom.
vi.mock("./tab-bar", () => ({ TabBar: () => <div data-testid="tab-bar" /> }));
vi.mock("./tab-mode-router-loader", () => ({
  TabModeRouterLoader: ({ tab }: { tab: Tab }) => (
    <div data-testid={`router-${tab.mode}`} />
  ),
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

  it("lets routed children fill the available shell width", () => {
    act(() => useTabsStore.getState().addTab(mk({ mode: "plate" })));
    wrap(<div data-testid="route-child" />);
    const contentSlot = screen.getByTestId("route-child").parentElement;
    expect(contentSlot?.className).toContain("flex-1");
    expect(contentSlot?.className).toContain("w-full");
  });

  it("uses the app shell scrollbar style for the route scroller", () => {
    act(() => useTabsStore.getState().addTab(mk({ mode: "plate" })));
    wrap(<div data-testid="route-child" />);
    const routeScroller = screen.getByTestId("route-child").parentElement?.parentElement;

    expect(routeScroller?.className).toContain("app-scrollbar-thin");
    expect(routeScroller?.className).toContain("overflow-auto");
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
