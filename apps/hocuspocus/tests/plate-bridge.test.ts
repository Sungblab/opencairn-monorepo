import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  plateToYDoc,
  yDocToPlate,
  PLATE_BRIDGE_ROOT_KEY,
  EMPTY_PLATE_VALUE,
} from "../src/plate-bridge.js";

describe("plate-bridge", () => {
  it("round-trip preserves a simple Plate value", () => {
    const value = [
      {
        type: "p",
        children: [{ text: "Hello " }, { text: "world", bold: true }],
      },
      { type: "h1", children: [{ text: "Title" }] },
    ];
    const doc = new Y.Doc();
    plateToYDoc(doc, value);
    const back = yDocToPlate(doc);
    expect(back).toEqual(value);
  });

  it("empty doc returns the canonical empty paragraph", () => {
    const doc = new Y.Doc();
    expect(yDocToPlate(doc)).toEqual([
      { type: "p", children: [{ text: "" }] },
    ]);
    // Also matches the exported constant shape.
    expect(yDocToPlate(doc)).toEqual(EMPTY_PLATE_VALUE);
  });

  it("plateToYDoc is idempotent — a second seed is a no-op", () => {
    const value = [{ type: "p", children: [{ text: "once" }] }];
    const doc = new Y.Doc();
    plateToYDoc(doc, value);
    plateToYDoc(doc, value); // second call must not duplicate
    expect(yDocToPlate(doc)).toEqual(value);
  });

  it("preserves nested block structure (lists)", () => {
    const value = [
      {
        type: "bulleted-list",
        children: [
          { type: "list-item", children: [{ text: "one" }] },
          { type: "list-item", children: [{ text: "two" }] },
        ],
      },
    ];
    const doc = new Y.Doc();
    plateToYDoc(doc, value);
    const back = yDocToPlate(doc);
    expect(back).toEqual(value);
  });

  it("ROOT_KEY is 'content' — matches @platejs/yjs client convention", () => {
    expect(PLATE_BRIDGE_ROOT_KEY).toBe("content");
    // And the bridge must actually mount the shared type under that key.
    const doc = new Y.Doc();
    plateToYDoc(doc, [{ type: "p", children: [{ text: "probe" }] }]);
    const shared = doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText;
    expect(shared.length).toBeGreaterThan(0);
  });
});
