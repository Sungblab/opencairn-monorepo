import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabActions } from "./use-tab-actions";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const push = vi.fn();
const replace = vi.fn();
let currentPath = "/ko/workspace/acme/note/n-1";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  useRouter: () => ({ push, replace }),
  useParams: () => ({ locale: "ko", wsSlug: "acme" }),
}));

const mk = (overrides: Partial<Tab>): Tab => ({
  id: "tab",
  kind: "note",
  targetId: "n-1",
  mode: "plate",
  title: "Tab",
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

describe("useTabActions", () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    replace.mockClear();
    currentPath = "/ko/workspace/acme/note/n-1";
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws_slug:acme");
  });

  it("navigates away when closing an inactive tab that owns the current route", () => {
    useTabsStore.setState({
      tabs: [
        mk({
          id: "dashboard",
          kind: "dashboard",
          targetId: null,
          title: "Dashboard",
        }),
        mk({ id: "note", kind: "note", targetId: "n-1", title: "Note" }),
      ],
      activeId: "dashboard",
      recentlyActiveTabIds: ["dashboard", "note"],
    });

    const { result } = renderHook(() => useTabActions());

    act(() => result.current.closeTab("note"));

    expect(useTabsStore.getState().activeId).toBe("dashboard");
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([
      "dashboard",
    ]);
    expect(replace).toHaveBeenCalledWith("/ko/workspace/acme/");
  });

  it("does not navigate when closing an inactive tab that is not the current route", () => {
    currentPath = "/ko/workspace/acme/note/n-2";
    useTabsStore.setState({
      tabs: [
        mk({
          id: "dashboard",
          kind: "dashboard",
          targetId: null,
          title: "Dashboard",
        }),
        mk({ id: "note-1", kind: "note", targetId: "n-1", title: "Note 1" }),
        mk({ id: "note-2", kind: "note", targetId: "n-2", title: "Note 2" }),
      ],
      activeId: "dashboard",
      recentlyActiveTabIds: ["dashboard", "note-2"],
    });

    const { result } = renderHook(() => useTabActions());

    act(() => result.current.closeTab("note-1"));

    expect(useTabsStore.getState().activeId).toBe("dashboard");
    expect(replace).not.toHaveBeenCalled();
  });

  it("navigates away when closeRight removes the tab that owns the current route", () => {
    useTabsStore.setState({
      tabs: [
        mk({
          id: "dashboard",
          kind: "dashboard",
          targetId: null,
          title: "Dashboard",
        }),
        mk({ id: "note", kind: "note", targetId: "n-1", title: "Note" }),
      ],
      activeId: "dashboard",
      recentlyActiveTabIds: ["dashboard", "note"],
    });

    const { result } = renderHook(() => useTabActions());

    act(() => result.current.closeRight("dashboard"));

    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([
      "dashboard",
    ]);
    expect(replace).toHaveBeenCalledWith("/ko/workspace/acme/");
  });

  it("routes agent file tabs so refresh stays on the file viewer", () => {
    const tab = mk({
      id: "file",
      kind: "agent_file",
      targetId: "file-1",
      mode: "agent-file",
      title: "paper.pdf",
    });
    useTabsStore.setState({
      tabs: [tab],
      activeId: null,
      recentlyActiveTabIds: [],
    });

    const { result } = renderHook(() => useTabActions());

    act(() => result.current.activateTab(tab));

    expect(useTabsStore.getState().activeId).toBe("file");
    expect(replace).toHaveBeenCalledWith("/ko/workspace/acme/file/file-1");
  });

  it("routes non-plate note modes so refresh preserves the active viewer", () => {
    const tab = mk({
      id: "reading",
      kind: "note",
      targetId: "n-1",
      mode: "reading",
      title: "Note",
    });
    useTabsStore.setState({
      tabs: [tab],
      activeId: null,
      recentlyActiveTabIds: [],
    });

    const { result } = renderHook(() => useTabActions());

    act(() => result.current.activateTab(tab));

    expect(replace).toHaveBeenCalledWith("/ko/workspace/acme/note/n-1/reading");
  });

  it("routes code workspace tabs so refresh stays on the code workspace", () => {
    const tab = mk({
      id: "code",
      kind: "code_workspace",
      targetId: "cw-1",
      mode: "code-workspace",
      title: "Workspace",
    });
    useTabsStore.setState({
      tabs: [tab],
      activeId: null,
      recentlyActiveTabIds: [],
    });

    const { result } = renderHook(() => useTabActions());

    act(() => result.current.activateTab(tab));

    expect(replace).toHaveBeenCalledWith(
      "/ko/workspace/acme/code-workspace/cw-1",
    );
  });
});
