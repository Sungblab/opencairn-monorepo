import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "./tab-bar";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { TestShellLabelsProvider } from "@/components/shell/shell-labels.test-utils";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/ko/workspace/acme/",
  useParams: () => ({ wsSlug: "acme" }),
}));

const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "t1",
  kind: "note",
  targetId: "n1",
  mode: "plate",
  title: "Alpha",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...p,
});

function renderTabBar() {
  return render(
    <TestShellLabelsProvider>
      <TabBar />
    </TestShellLabelsProvider>,
  );
}

describe("TabBar", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws_slug:acme");
    push.mockClear();
    replace.mockClear();
  });

  it("renders every open tab", () => {
    useTabsStore.getState().addTab(mk({ id: "a", title: "Alpha" }));
    useTabsStore
      .getState()
      .addTab(mk({ id: "b", title: "Beta", targetId: "n2" }));
    renderTabBar();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("does not expose a generic new-tab button in the tab strip", () => {
    renderTabBar();
    expect(screen.queryByTestId("tab-bar-new")).toBeNull();
  });

  it("clicking a tab navigates to its URL via router.replace", () => {
    useTabsStore.getState().addTab(mk({ id: "a", targetId: "n1" }));
    renderTabBar();
    fireEvent.click(screen.getByText("Alpha"));
    expect(replace).toHaveBeenCalledWith("/ko/workspace/acme/note/n1");
  });

  it("clicking a transient ingest tab activates it without replacing the URL", () => {
    useTabsStore.getState().addTab(mk({ id: "project", kind: "project", targetId: "p1" }));
    useTabsStore.getState().addTab(
      mk({
        id: "ingest-wf-1",
        kind: "ingest",
        targetId: "wf-1",
        mode: "ingest",
        title: "분석 중: report.pdf",
      }),
    );
    useTabsStore.getState().setActive("project");

    renderTabBar();
    fireEvent.click(screen.getByText("분석 중: report.pdf"));

    expect(useTabsStore.getState().activeId).toBe("ingest-wf-1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("marks the active tab with aria-selected=true", () => {
    useTabsStore.getState().addTab(mk({ id: "a" }));
    useTabsStore.getState().addTab(mk({ id: "b", title: "Beta" }));
    useTabsStore.getState().setActive("b");
    renderTabBar();
    expect(screen.getByTestId("tab-b").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("tab-a").getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("overflow trigger is hidden when no tabs are open", () => {
    renderTabBar();
    expect(screen.queryByTestId("tab-overflow-trigger")).toBeNull();
  });

  it("overflow trigger appears when any tabs are open", () => {
    useTabsStore.getState().addTab(mk({ id: "a" }));
    renderTabBar();
    expect(screen.getByTestId("tab-overflow-trigger")).toBeInTheDocument();
  });

  it("marks tabs that are currently assigned to split panes", () => {
    useTabsStore.getState().addTab(mk({ id: "left", title: "Left" }));
    useTabsStore
      .getState()
      .openTabToRight(mk({ id: "right", title: "Right", targetId: "n2" }));

    renderTabBar();

    expect(screen.getByLabelText("splitPrimary")).toBeInTheDocument();
    expect(screen.getByLabelText("splitSecondary")).toBeInTheDocument();
  });
});
