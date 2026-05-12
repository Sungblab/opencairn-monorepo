import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsStore, type Tab } from "./tabs-store";

const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "x",
  kind: "note",
  targetId: null,
  mode: "plate",
  title: "",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...p,
});

describe("tabs-store extensions", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-a");
  });

  describe("reorderTab", () => {
    it("moves a tab from fromIndex to toIndex", () => {
      ["a", "b", "c"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().reorderTab(0, 2);
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([
        "b",
        "c",
        "a",
      ]);
    });

    it("is a no-op when from === to", () => {
      useTabsStore.getState().addTab(mk({ id: "a" }));
      useTabsStore.getState().addTab(mk({ id: "b" }));
      useTabsStore.getState().reorderTab(1, 1);
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([
        "a",
        "b",
      ]);
    });

    it("persists the reorder", () => {
      useTabsStore.getState().addTab(mk({ id: "a" }));
      useTabsStore.getState().addTab(mk({ id: "b" }));
      useTabsStore.getState().reorderTab(0, 1);
      const raw = JSON.parse(localStorage.getItem("oc:tabs:ws-a")!);
      expect(raw.tabs.map((t: Tab) => t.id)).toEqual(["b", "a"]);
    });
  });

  describe("togglePin", () => {
    it("flips the pinned flag", () => {
      useTabsStore.getState().addTab(mk({ id: "a" }));
      useTabsStore.getState().togglePin("a");
      expect(useTabsStore.getState().tabs[0].pinned).toBe(true);
      useTabsStore.getState().togglePin("a");
      expect(useTabsStore.getState().tabs[0].pinned).toBe(false);
    });
  });

  describe("promoteFromPreview", () => {
    it("flips preview=false", () => {
      useTabsStore.getState().addTab(mk({ id: "a", preview: true }));
      useTabsStore.getState().promoteFromPreview("a");
      expect(useTabsStore.getState().tabs[0].preview).toBe(false);
    });

    it("is idempotent for non-preview tabs", () => {
      useTabsStore.getState().addTab(mk({ id: "a", preview: false }));
      useTabsStore.getState().promoteFromPreview("a");
      expect(useTabsStore.getState().tabs[0].preview).toBe(false);
    });
  });

  describe("addOrReplacePreview", () => {
    it("replaces existing preview tab with the new one", () => {
      useTabsStore
        .getState()
        .addTab(mk({ id: "prev", targetId: "n1", preview: true }));
      useTabsStore
        .getState()
        .addOrReplacePreview(mk({ id: "new", targetId: "n2", preview: true }));
      const tabs = useTabsStore.getState().tabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe("new");
      expect(tabs[0].targetId).toBe("n2");
      expect(useTabsStore.getState().activeId).toBe("new");
    });

    it("appends when no preview tab exists", () => {
      useTabsStore.getState().addTab(mk({ id: "pinned", preview: false }));
      useTabsStore.getState().addOrReplacePreview(mk({ id: "p", preview: true }));
      expect(useTabsStore.getState().tabs).toHaveLength(2);
      expect(useTabsStore.getState().activeId).toBe("p");
    });

    it("persists the replacement", () => {
      useTabsStore.getState().addTab(mk({ id: "prev", preview: true }));
      useTabsStore.getState().addOrReplacePreview(mk({ id: "new", preview: true }));
      const raw = JSON.parse(localStorage.getItem("oc:tabs:ws-a")!);
      expect(raw.tabs.map((t: Tab) => t.id)).toEqual(["new"]);
      expect(raw.activeId).toBe("new");
    });
  });

  describe("closeOthers", () => {
    it("keeps only the target tab plus pinned tabs", () => {
      ["a", "b", "c", "d"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().togglePin("c");
      useTabsStore.getState().closeOthers("a");
      const ids = useTabsStore
        .getState()
        .tabs.map((t) => t.id)
        .sort();
      expect(ids).toEqual(["a", "c"]);
      expect(useTabsStore.getState().activeId).toBe("a");
    });

    it("pushes evicted tabs onto closedStack (pinned are skipped)", () => {
      ["a", "b", "c", "d"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().togglePin("c");
      useTabsStore.getState().closeOthers("a");
      // b + d were closed; c was pinned and stayed; a is the survivor.
      expect(
        useTabsStore.getState().closedStack.map((t) => t.id),
      ).toEqual(["b", "d"]);
    });
  });

  describe("closeRight", () => {
    it("closes tabs strictly to the right of id", () => {
      ["a", "b", "c", "d"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().closeRight("b");
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([
        "a",
        "b",
      ]);
    });

    it("keeps active tab intact when it survives the trim", () => {
      ["a", "b", "c"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().setActive("a");
      useTabsStore.getState().closeRight("b");
      expect(useTabsStore.getState().activeId).toBe("a");
    });

    it("reassigns active when the active tab is closed", () => {
      ["a", "b", "c"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().setActive("c");
      useTabsStore.getState().closeRight("a");
      expect(useTabsStore.getState().activeId).toBe("a");
    });

    it("pushes evicted right-side tabs onto closedStack", () => {
      ["a", "b", "c", "d"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().closeRight("b");
      expect(
        useTabsStore.getState().closedStack.map((t) => t.id),
      ).toEqual(["c", "d"]);
    });

    it("keeps a pinned tab on the right side; does not push it to closedStack", () => {
      ["a", "b", "c", "d"].forEach((id) =>
        useTabsStore.getState().addTab(mk({ id })),
      );
      useTabsStore.getState().togglePin("d");
      useTabsStore.getState().closeRight("b");
      // c is evicted; d is pinned and stays.
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([
        "a",
        "b",
        "d",
      ]);
      expect(
        useTabsStore.getState().closedStack.map((t) => t.id),
      ).toEqual(["c"]);
    });
  });

  describe("closedStack / restoreClosed", () => {
    it("pushes closed tabs onto the stack (capped at 10)", () => {
      // Seed 12 tabs, close them all in order. Stack keeps only the most
      // recent 10.
      const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
      ids.forEach((id) => useTabsStore.getState().addTab(mk({ id })));
      ids.forEach((id) => useTabsStore.getState().closeTab(id));
      const stack = useTabsStore.getState().closedStack;
      expect(stack).toHaveLength(10);
      expect(stack[0].id).toBe("t2");
      expect(stack[9].id).toBe("t11");
    });

    it("restoreClosed pops the last closed tab and reopens it", () => {
      useTabsStore.getState().addTab(mk({ id: "a" }));
      useTabsStore.getState().addTab(mk({ id: "b" }));
      useTabsStore.getState().closeTab("b");
      useTabsStore.getState().restoreClosed();
      const tabs = useTabsStore.getState().tabs;
      expect(tabs.map((t) => t.id)).toEqual(["a", "b"]);
      expect(useTabsStore.getState().activeId).toBe("b");
      expect(useTabsStore.getState().closedStack).toHaveLength(0);
    });

    it("restoreClosed is a no-op when the stack is empty", () => {
      useTabsStore.getState().restoreClosed();
      expect(useTabsStore.getState().tabs).toEqual([]);
    });

    it("pinned tabs cannot be closed so they don't enter closedStack", () => {
      useTabsStore.getState().addTab(mk({ id: "a", pinned: true }));
      useTabsStore.getState().closeTab("a");
      expect(useTabsStore.getState().closedStack).toHaveLength(0);
    });

    it("persists closedStack across setWorkspace", () => {
      useTabsStore.getState().addTab(mk({ id: "a" }));
      useTabsStore.getState().closeTab("a");
      useTabsStore.getState().setWorkspace("ws-b");
      useTabsStore.getState().setWorkspace("ws-a");
      expect(useTabsStore.getState().closedStack.map((t) => t.id)).toEqual([
        "a",
      ]);
    });
  });

  describe("split layout", () => {
    it("filters stale recent ids when loading persisted tab state", () => {
      useTabsStore.setState(useTabsStore.getInitialState(), true);
      localStorage.setItem(
        "oc:tabs:ws-a",
        JSON.stringify({
          version: 1,
          tabs: [mk({ id: "current" })],
          activeId: "missing",
          activePane: "primary",
          split: null,
          closedStack: [],
          recentlyActiveTabIds: ["missing", "current"],
        }),
      );

      useTabsStore.getState().setWorkspace("ws-a");

      expect(useTabsStore.getState().activeId).toBe("current");
      expect(useTabsStore.getState().recentlyActiveTabIds).toEqual([
        "current",
      ]);
    });

    it("loads legacy splitWith/splitSide fields into a versioned split layout", () => {
      localStorage.setItem(
        "oc:tabs:ws-legacy",
        JSON.stringify({
          tabs: [
            mk({
              id: "left",
              splitWith: "right",
              splitSide: "left",
            }),
            mk({
              id: "right",
              targetId: "n2",
              splitWith: "left",
              splitSide: "right",
            }),
          ],
          activeId: "left",
          closedStack: [],
        }),
      );

      useTabsStore.getState().setWorkspace("ws-legacy");

      expect(useTabsStore.getState().split).toEqual({
        primaryTabId: "left",
        secondaryTabId: "right",
        orientation: "vertical",
        ratio: 0.5,
      });
      expect(useTabsStore.getState().activePane).toBe("primary");
    });

    it("openTabToRight creates a vertical split and promotes preview tabs", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore
        .getState()
        .openTabToRight(mk({ id: "right", targetId: "n2", preview: true }));

      const state = useTabsStore.getState();
      expect(state.tabs.map((tab) => tab.id)).toEqual(["left", "right"]);
      expect(state.tabs.find((tab) => tab.id === "right")?.preview).toBe(
        false,
      );
      expect(state.split).toEqual({
        primaryTabId: "left",
        secondaryTabId: "right",
        orientation: "vertical",
        ratio: 0.5,
      });
      expect(state.activeId).toBe("right");
      expect(state.activePane).toBe("secondary");
    });

    it("openTabToRight reuses an existing tab with the same kind and target", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore
        .getState()
        .addTab(mk({ id: "existing", targetId: "n2", preview: true }));
      useTabsStore.getState().setActive("left");

      useTabsStore
        .getState()
        .openTabToRight(mk({ id: "new", targetId: "n2", preview: true }));

      const state = useTabsStore.getState();
      expect(state.tabs.map((tab) => tab.id)).toEqual(["left", "existing"]);
      expect(state.tabs.find((tab) => tab.id === "existing")?.preview).toBe(
        false,
      );
      expect(state.split?.secondaryTabId).toBe("existing");
    });

    it("closing a split tab dissolves the split and focuses the surviving tab", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));

      useTabsStore.getState().closeTab("right");

      expect(useTabsStore.getState().split).toBeNull();
      expect(useTabsStore.getState().activeId).toBe("left");
      expect(useTabsStore.getState().activePane).toBe("primary");
    });

    it("setActive dissolves the split when activating a tab outside the split", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().addTab(mk({ id: "outside" }));
      useTabsStore.getState().setActive("left");
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));

      useTabsStore.getState().setActive("outside");

      expect(useTabsStore.getState().split).toBeNull();
      expect(useTabsStore.getState().activeId).toBe("outside");
      expect(useTabsStore.getState().activePane).toBe("primary");
      const raw = JSON.parse(localStorage.getItem("oc:tabs:ws-a")!);
      expect(raw.split).toBeNull();
      expect(raw.activeId).toBe("outside");
    });

    it("swapSplitPanes swaps pane ids and keeps the same active tab", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));
      useTabsStore.getState().setActivePane("secondary");

      useTabsStore.getState().swapSplitPanes();

      expect(useTabsStore.getState().split).toMatchObject({
        primaryTabId: "right",
        secondaryTabId: "left",
      });
      expect(useTabsStore.getState().activeId).toBe("right");
      expect(useTabsStore.getState().activePane).toBe("primary");
    });

    it("setActivePane is a no-op when the pane is already active", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));
      expect(useTabsStore.getState().activePane).toBe("secondary");
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      setItem.mockClear();

      useTabsStore.getState().setActivePane("secondary");

      expect(setItem).not.toHaveBeenCalled();
      expect(useTabsStore.getState().recentlyActiveTabIds).toEqual([
        "right",
        "left",
      ]);
      setItem.mockRestore();
    });

    it("setSplitRatio clamps and persists the split ratio", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));

      useTabsStore.getState().setSplitRatio(0.9);

      expect(useTabsStore.getState().split?.ratio).toBe(0.75);
      const raw = JSON.parse(localStorage.getItem("oc:tabs:ws-a")!);
      expect(raw.split.ratio).toBe(0.75);
    });

    it("unsplit keeps the requested pane active", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));

      useTabsStore.getState().unsplit("primary");

      expect(useTabsStore.getState().split).toBeNull();
      expect(useTabsStore.getState().activeId).toBe("left");
      expect(useTabsStore.getState().activePane).toBe("primary");
    });

    it("addTab dissolves the split so the newly active tab is visible", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));

      useTabsStore.getState().addTab(mk({ id: "new" }));

      expect(useTabsStore.getState().split).toBeNull();
      expect(useTabsStore.getState().activeId).toBe("new");
    });

    it("restoreClosed dissolves the split so the restored active tab is visible", () => {
      useTabsStore.getState().addTab(mk({ id: "left" }));
      useTabsStore.getState().addTab(mk({ id: "closed" }));
      useTabsStore.getState().closeTab("closed");
      useTabsStore.getState().setActive("left");
      useTabsStore.getState().openTabToRight(mk({ id: "right" }));

      useTabsStore.getState().restoreClosed();

      expect(useTabsStore.getState().split).toBeNull();
      expect(useTabsStore.getState().activeId).toBe("closed");
    });
  });
});
