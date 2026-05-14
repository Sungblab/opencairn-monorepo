import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { TabShell } from "./tab-shell";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { usePanelStore } from "@/stores/panel-store";

// Stub the TabBar + router loader so we can assert on the branch choice
// directly without loading routed viewer bundles in jsdom.
vi.mock("./tab-bar", () => ({ TabBar: () => <div data-testid="tab-bar" /> }));
vi.mock("./tab-mode-router-loader", () => ({
  TabModeRouterLoader: ({ tab }: { tab: Tab }) => (
    <div data-testid={`router-${tab.mode}`} />
  ),
}));
vi.mock("@/components/agent-panel/workflow-console-runs", () => ({
  WorkflowConsoleRuns: ({ projectId }: { projectId: string | null }) => (
    <div data-testid="dock-workflow-runs">{projectId}</div>
  ),
}));
vi.mock("@/components/sidebar/use-current-project", () => ({
  useCurrentProjectContext: () => ({ projectId: "project-1" }),
}));

const messages = {
  appShell: {
    tabs: {
      layout: {
        title: "탭 그룹",
        vertical: "좌우 분할",
        horizontal: "상하 분할",
        swap: "위치 바꾸기",
        unsplit: "분할 닫기",
      },
    },
    bottomDock: {
      title: "실행 패널",
      close: "닫기",
      noProject: "프로젝트 없음",
      tabs: {
        activity: "활동",
        logs: "로그",
      },
      logsEmpty: {
        title: "로그 준비 중",
        body: "활동 탭을 사용하세요.",
      },
    },
  },
};

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
        version: 1,
        tabs: [],
        activeId: null,
        activePane: "primary",
        split: null,
        closedStack: [],
        recentlyActiveTabIds: [],
      },
      false,
    );
    useTabsStore.getState().setWorkspace("ws");
    usePanelStore.setState(usePanelStore.getInitialState(), true);
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
    const routeScroller = screen.getByTestId("route-child").parentElement;

    expect(routeScroller?.className).toContain("app-scrollbar-thin");
    expect(routeScroller?.className).toContain("overflow-auto");
  });

  it("keeps routed viewers inside a non-scrolling full-height slot", () => {
    act(() =>
      useTabsStore
        .getState()
        .addTab(mk({ id: "s", mode: "source" })),
    );
    wrap(<div data-testid="route-child" />);
    const viewerSlot = screen.getByTestId("router-source").parentElement;
    const shellBody = viewerSlot?.parentElement;

    expect(viewerSlot?.className).toContain("h-full");
    expect(viewerSlot?.className).toContain("overflow-hidden");
    expect(shellBody?.className).toContain("overflow-hidden");
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

  it("renders a two-pane split with route children and a routed viewer", () => {
    act(() => {
      useTabsStore.getState().addTab(mk({ id: "left", mode: "plate" }));
      useTabsStore.getState().openTabToRight(
        mk({
          id: "right",
          kind: "note",
          mode: "source",
          targetId: "source-1",
        }),
      );
    });

    wrap(<div data-testid="route-child" />);

    expect(screen.getByTestId("split-pane-primary")).toBeInTheDocument();
    expect(screen.getByTestId("split-pane-secondary")).toBeInTheDocument();
    expect(screen.getByTestId("split-layout-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("route-child")).toBeInTheDocument();
    expect(screen.getByTestId("router-source")).toBeInTheDocument();
  });

  it("lets the split layout toolbar change orientation", () => {
    act(() => {
      useTabsStore.getState().addTab(mk({ id: "left", mode: "plate" }));
      useTabsStore.getState().openTabToRight(
        mk({
          id: "right",
          kind: "note",
          mode: "source",
          targetId: "source-1",
        }),
      );
    });

    wrap(<div data-testid="route-child" />);
    act(() => {
      screen.getByTestId("split-layout-horizontal").click();
    });

    expect(useTabsStore.getState().split?.orientation).toBe("horizontal");
  });

  it("renders a horizontal two-pane split when a tab is opened below", () => {
    act(() => {
      useTabsStore.getState().addTab(mk({ id: "top", mode: "plate" }));
      useTabsStore.getState().openTabBelow(
        mk({
          id: "bottom",
          kind: "note",
          mode: "source",
          targetId: "source-1",
        }),
      );
    });

    wrap(<div data-testid="route-child" />);

    expect(screen.getByTestId("split-pane-primary")).toHaveStyle({
      height: "50%",
    });
    expect(screen.getByTestId("split-pane-secondary")).toHaveStyle({
      height: "50%",
    });
    expect(screen.getByTestId("router-source")).toBeInTheDocument();
  });

  it("clicking a split pane makes that pane the active pane", () => {
    act(() => {
      useTabsStore.getState().addTab(mk({ id: "left", mode: "plate" }));
      useTabsStore.getState().openTabToRight(
        mk({
          id: "right",
          kind: "note",
          mode: "source",
          targetId: "source-1",
        }),
      );
    });

    wrap(<div data-testid="route-child" />);
    act(() => {
      screen.getByTestId("split-pane-primary").click();
    });

    expect(useTabsStore.getState().activePane).toBe("primary");
    expect(useTabsStore.getState().activeId).toBe("left");
  });

  it("renders the bottom dock without replacing the main workspace", () => {
    act(() => {
      useTabsStore.getState().addTab(mk({ mode: "plate" }));
      usePanelStore.getState().openBottomDock("activity");
    });

    wrap(<div data-testid="route-child" />);

    expect(screen.getByTestId("route-child")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-bottom-dock")).toBeInTheDocument();
    expect(screen.getByTestId("dock-workflow-runs")).toHaveTextContent(
      "project-1",
    );
  });

  it("shows a logs placeholder instead of duplicating the activity list", () => {
    act(() => {
      useTabsStore.getState().addTab(mk({ mode: "plate" }));
      usePanelStore.getState().openBottomDock("logs");
    });

    wrap(<div data-testid="route-child" />);

    expect(screen.queryByTestId("dock-workflow-runs")).toBeNull();
    expect(screen.getByText("로그 준비 중")).toBeInTheDocument();
  });
});
