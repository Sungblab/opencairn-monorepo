import { describe, expect, it } from "vitest";
import { genTabId, newTab } from "./tab-factory";

describe("genTabId", () => {
  it("produces a `t_`-prefixed unique id", () => {
    const a = genTabId();
    const b = genTabId();
    expect(a.startsWith("t_")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("newTab", () => {
  it("defaults mode to plate and preview=true for notes", () => {
    const tab = newTab({ kind: "note", targetId: "n1", title: "Note" });
    expect(tab.kind).toBe("note");
    expect(tab.mode).toBe("plate");
    expect(tab.preview).toBe(true);
    expect(tab.pinned).toBe(false);
    expect(tab.dirty).toBe(false);
    expect(tab.splitWith).toBeNull();
    expect(tab.title).toBe("Note");
  });

  it("non-note kinds default preview=false", () => {
    expect(newTab({ kind: "dashboard", targetId: null, title: "D" }).preview).toBe(
      false,
    );
    expect(
      newTab({ kind: "research_hub", targetId: null, title: "R" }).preview,
    ).toBe(false);
    expect(newTab({ kind: "project", targetId: "p", title: "P" }).preview).toBe(
      false,
    );
  });

  it("preview override wins over kind-based default", () => {
    expect(
      newTab({ kind: "note", targetId: "n", title: "N", preview: false })
        .preview,
    ).toBe(false);
    expect(
      newTab({
        kind: "project",
        targetId: "p",
        title: "P",
        preview: true,
      }).preview,
    ).toBe(true);
  });

  it("mode override wins over kind-based default", () => {
    expect(
      newTab({ kind: "note", targetId: "n", title: "N", mode: "reading" }).mode,
    ).toBe("reading");
  });

  it("each invocation produces a fresh id", () => {
    const a = newTab({ kind: "note", targetId: "x", title: "X" });
    const b = newTab({ kind: "note", targetId: "x", title: "X" });
    expect(a.id).not.toBe(b.id);
  });
});
