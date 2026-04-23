import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "./tab-bar";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/w/acme/",
  useParams: () => ({ wsSlug: "acme" }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (_ns?: string) => (key: string) => key,
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
    render(<TabBar />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("exposes a new-tab button regardless of tab count", () => {
    render(<TabBar />);
    expect(screen.getByTestId("tab-bar-new")).toBeInTheDocument();
  });

  it("clicking the new-tab button adds a note tab with the localized title", () => {
    render(<TabBar />);
    fireEvent.click(screen.getByTestId("tab-bar-new"));
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe("note");
    expect(tabs[0].title).toBe("newTabTitle");
    // The + button creates a real (non-preview) tab — matches the spec
    // rule that preview is only for sidebar-navigated notes.
    expect(tabs[0].preview).toBe(false);
  });

  it("clicking a tab navigates to its URL via router.replace", () => {
    useTabsStore.getState().addTab(mk({ id: "a", targetId: "n1" }));
    render(<TabBar />);
    fireEvent.click(screen.getByText("Alpha"));
    expect(replace).toHaveBeenCalledWith("/w/acme/n/n1");
  });

  it("marks the active tab with aria-selected=true", () => {
    useTabsStore.getState().addTab(mk({ id: "a" }));
    useTabsStore.getState().addTab(mk({ id: "b", title: "Beta" }));
    useTabsStore.getState().setActive("b");
    render(<TabBar />);
    expect(screen.getByTestId("tab-b").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("tab-a").getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("overflow trigger is hidden when no tabs are open", () => {
    render(<TabBar />);
    expect(screen.queryByTestId("tab-overflow-trigger")).toBeNull();
  });

  it("overflow trigger appears when any tabs are open", () => {
    useTabsStore.getState().addTab(mk({ id: "a" }));
    render(<TabBar />);
    expect(screen.getByTestId("tab-overflow-trigger")).toBeInTheDocument();
  });
});
