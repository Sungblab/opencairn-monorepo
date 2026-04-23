import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTabKeyboard } from "./use-tab-keyboard";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "x",
  kind: "note",
  targetId: "n",
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

function press(
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
) {
  // Default the relevant platform modifier so the tests don't have to know
  // whether the CI runs on mac or linux.
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
  const useMeta = isMac ? mods.meta !== false : false;
  const useCtrl = !isMac ? mods.ctrl !== false : false;
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: useMeta,
    ctrlKey: useCtrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    cancelable: true,
  });
  window.dispatchEvent(event);
}

const seed = (ids: string[]) => {
  ids.forEach((id) => useTabsStore.getState().addTab(mk({ id, title: id })));
};

describe("useTabKeyboard", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-kb");
  });

  it("⌘1 activates the first tab", () => {
    seed(["a", "b", "c"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("c");
    act(() => press("1"));
    expect(useTabsStore.getState().activeId).toBe("a");
  });

  it("⌘9 is a no-op when there are fewer than 9 tabs", () => {
    seed(["a", "b"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("a");
    act(() => press("9"));
    expect(useTabsStore.getState().activeId).toBe("a");
  });

  it("⌘W closes the active tab", () => {
    seed(["a", "b"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("a");
    act(() => press("w"));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["b"]);
  });

  it("⌘W is a no-op on a pinned active tab", () => {
    useTabsStore.getState().addTab(mk({ id: "a", pinned: true }));
    useTabsStore.getState().addTab(mk({ id: "b" }));
    useTabsStore.getState().setActive("a");
    renderHook(() => useTabKeyboard());
    act(() => press("w"));
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("⌘→ activates the next tab", () => {
    seed(["a", "b", "c"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("a");
    act(() => press("ArrowRight"));
    expect(useTabsStore.getState().activeId).toBe("b");
  });

  it("⌘→ wraps from the last tab to the first", () => {
    seed(["a", "b"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("b");
    act(() => press("ArrowRight"));
    expect(useTabsStore.getState().activeId).toBe("a");
  });

  it("⌘← activates the previous tab", () => {
    seed(["a", "b", "c"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("c");
    act(() => press("ArrowLeft"));
    expect(useTabsStore.getState().activeId).toBe("b");
  });

  it("⌘⌥→ reorders the active tab one slot to the right", () => {
    seed(["a", "b", "c"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("a");
    act(() => press("ArrowRight", { alt: true }));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("⌘⌥← reorders the active tab one slot to the left", () => {
    seed(["a", "b", "c"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("c");
    act(() => press("ArrowLeft", { alt: true }));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("a plain letter press without the modifier is ignored", () => {
    seed(["a", "b"]);
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("a");
    const event = new KeyboardEvent("keydown", { key: "w", cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });
});
