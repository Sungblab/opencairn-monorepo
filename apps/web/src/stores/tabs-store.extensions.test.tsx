import { beforeEach, describe, expect, it } from "vitest";
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
});
