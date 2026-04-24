import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useTabModeShortcut } from "./use-tab-mode-shortcut";
import { useTabsStore, type Tab, type TabMode } from "@/stores/tabs-store";

function press(key: string, mods: { shift?: boolean; mod?: boolean } = {}) {
  const useMod = mods.mod !== false;
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      // useKeyboardShortcut checks metaKey on mac and ctrlKey elsewhere;
      // setting both covers both platforms so the test is platform-neutral.
      metaKey: useMod,
      ctrlKey: useMod,
      shiftKey: !!mods.shift,
    }),
  );
}

const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "a",
  kind: "note",
  targetId: "n",
  mode: "plate" as TabMode,
  title: "N",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...p,
});

describe("useTabModeShortcut", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws");
  });

  it("⌘⇧R toggles plate → reading", () => {
    useTabsStore.getState().addTab(mk({ mode: "plate" }));
    renderHook(() => useTabModeShortcut());
    useTabsStore.getState().setActive("a");
    act(() => press("R", { shift: true }));
    expect(useTabsStore.getState().tabs[0].mode).toBe("reading");
  });

  it("⌘⇧R toggles reading → plate", () => {
    useTabsStore.getState().addTab(mk({ mode: "reading" }));
    renderHook(() => useTabModeShortcut());
    useTabsStore.getState().setActive("a");
    act(() => press("R", { shift: true }));
    expect(useTabsStore.getState().tabs[0].mode).toBe("plate");
  });

  it("is a no-op when active tab is source/data/stub", () => {
    useTabsStore.getState().addTab(mk({ mode: "source" }));
    renderHook(() => useTabModeShortcut());
    useTabsStore.getState().setActive("a");
    act(() => press("R", { shift: true }));
    expect(useTabsStore.getState().tabs[0].mode).toBe("source");
  });

  it("is a no-op without modifier keys", () => {
    useTabsStore.getState().addTab(mk({ mode: "plate" }));
    renderHook(() => useTabModeShortcut());
    useTabsStore.getState().setActive("a");
    act(() => press("R", { mod: false }));
    expect(useTabsStore.getState().tabs[0].mode).toBe("plate");
  });
});
