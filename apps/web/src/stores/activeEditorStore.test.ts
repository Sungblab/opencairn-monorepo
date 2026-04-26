import { describe, expect, it, beforeEach } from "vitest";
import { useActiveEditorStore } from "./activeEditorStore";

describe("activeEditorStore", () => {
  beforeEach(() => {
    useActiveEditorStore.setState({ editors: new Map() });
  });

  it("registers an editor by noteId", () => {
    const fakeEditor = { id: "ed-1" } as never;
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);
    expect(useActiveEditorStore.getState().getEditor("note-1")).toBe(fakeEditor);
  });

  it("returns undefined for an unknown noteId", () => {
    expect(useActiveEditorStore.getState().getEditor("missing")).toBeUndefined();
  });

  it("removes an editor", () => {
    const fakeEditor = { id: "ed-1" } as never;
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);
    useActiveEditorStore.getState().removeEditor("note-1");
    expect(useActiveEditorStore.getState().getEditor("note-1")).toBeUndefined();
  });

  it("supports multiple concurrent editors", () => {
    const a = { id: "a" } as never;
    const b = { id: "b" } as never;
    useActiveEditorStore.getState().setEditor("n-a", a);
    useActiveEditorStore.getState().setEditor("n-b", b);
    expect(useActiveEditorStore.getState().getEditor("n-a")).toBe(a);
    expect(useActiveEditorStore.getState().getEditor("n-b")).toBe(b);
  });
});
