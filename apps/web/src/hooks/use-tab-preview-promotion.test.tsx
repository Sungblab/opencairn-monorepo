import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTabPreviewPromotion } from "./use-tab-preview-promotion";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "t1",
  kind: "note",
  targetId: "n1",
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

describe("useTabPreviewPromotion", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-p");
  });

  it("promotes the matching preview tab", () => {
    useTabsStore
      .getState()
      .addTab(mk({ id: "a", targetId: "note-1", preview: true }));
    const { result } = renderHook(() => useTabPreviewPromotion("note-1"));
    result.current();
    expect(useTabsStore.getState().tabs[0].preview).toBe(false);
  });

  it("is a no-op when the matching tab is not preview", () => {
    useTabsStore
      .getState()
      .addTab(mk({ id: "a", targetId: "note-1", preview: false }));
    const { result } = renderHook(() => useTabPreviewPromotion("note-1"));
    result.current();
    expect(useTabsStore.getState().tabs[0].preview).toBe(false);
  });

  it("is a no-op when no tab matches the note id", () => {
    useTabsStore
      .getState()
      .addTab(mk({ id: "a", targetId: "other", preview: true }));
    const { result } = renderHook(() => useTabPreviewPromotion("note-1"));
    result.current(); // Should not throw.
    // The "other" preview tab remains a preview — the hook only touches its
    // target note.
    expect(useTabsStore.getState().tabs[0].preview).toBe(true);
  });

  it("is a no-op when noteId is null", () => {
    useTabsStore
      .getState()
      .addTab(mk({ id: "a", targetId: "note-1", preview: true }));
    const { result } = renderHook(() => useTabPreviewPromotion(null));
    result.current();
    expect(useTabsStore.getState().tabs[0].preview).toBe(true);
  });
});
