import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore, type Tab } from "./tabs-store";

const mkTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: "t1",
  kind: "note",
  targetId: "n1",
  mode: "plate",
  title: "Note 1",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...overrides,
});

describe("tabs-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
  });

  it("has null workspaceId initially", () => {
    expect(useTabsStore.getState().workspaceId).toBeNull();
    expect(useTabsStore.getState().tabs).toEqual([]);
  });

  it("setWorkspace loads persisted tabs for that workspace", () => {
    localStorage.setItem(
      "oc:tabs:ws-a",
      JSON.stringify({ tabs: [mkTab({ id: "a1" })], activeId: "a1" }),
    );
    useTabsStore.getState().setWorkspace("ws-a");
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe("a1");
  });

  it("setWorkspace defaults to empty when no persisted state", () => {
    useTabsStore.getState().setWorkspace("ws-new");
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useTabsStore.getState().activeId).toBeNull();
  });

  it("setWorkspace flushes prior workspace state to its own key", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "x1" }));
    useTabsStore.getState().setWorkspace("ws-b");
    const raw = localStorage.getItem("oc:tabs:ws-a");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.tabs[0].id).toBe("x1");
  });

  it("addTab sets activeId when first tab", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab());
    expect(useTabsStore.getState().activeId).toBe("t1");
  });

  it("closeTab selects right neighbor", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "t1" }));
    useTabsStore.getState().addTab(mkTab({ id: "t2" }));
    useTabsStore.getState().addTab(mkTab({ id: "t3" }));
    useTabsStore.getState().setActive("t2");
    useTabsStore.getState().closeTab("t2");
    expect(useTabsStore.getState().activeId).toBe("t3");
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([
      "t1",
      "t3",
    ]);
  });

  it("closeTab refuses pinned tabs", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "t1", pinned: true }));
    useTabsStore.getState().closeTab("t1");
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("findTabByTarget returns tab matching kind+targetId", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore
      .getState()
      .addTab(mkTab({ id: "t1", kind: "note", targetId: "n1" }));
    const found = useTabsStore.getState().findTabByTarget("note", "n1");
    expect(found?.id).toBe("t1");
    expect(
      useTabsStore.getState().findTabByTarget("project", "n1"),
    ).toBeUndefined();
  });

  it("updateTab patches the matching tab in place", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "t1", dirty: false }));
    useTabsStore.getState().updateTab("t1", { dirty: true, scrollY: 100 });
    const t = useTabsStore.getState().tabs[0];
    expect(t.dirty).toBe(true);
    expect(t.scrollY).toBe(100);
  });

  it("closeTab on last tab leaves activeId null", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "t1" }));
    useTabsStore.getState().closeTab("t1");
    expect(useTabsStore.getState().tabs).toHaveLength(0);
    expect(useTabsStore.getState().activeId).toBeNull();
  });
});
