import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { yjsStateToPlateValue, fallbackPlateValue } from "../src/lib/yjs-to-plate.js";

describe("yjsStateToPlateValue", () => {
  it("decodes a Y.Doc state into a Plate value", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("content");
    const para = new Y.XmlElement("p");
    para.insert(0, [new Y.XmlText("hello")]);
    fragment.insert(0, [para]);
    const state = Y.encodeStateAsUpdate(doc);

    const value = yjsStateToPlateValue(state);
    expect(Array.isArray(value)).toBe(true);
    expect(value.length).toBeGreaterThan(0);
  });

  it("returns empty value for an empty doc state", () => {
    const doc = new Y.Doc();
    const state = Y.encodeStateAsUpdate(doc);
    const value = yjsStateToPlateValue(state);
    expect(Array.isArray(value)).toBe(true);
  });

  it("falls back to legacy plate content when given non-yjs payload", () => {
    const legacy = [{ type: "p", children: [{ text: "legacy" }] }];
    expect(fallbackPlateValue(legacy)).toEqual(legacy);
  });

  it("falls back to empty paragraph when content is null", () => {
    const out = fallbackPlateValue(null);
    expect(out).toEqual([{ type: "p", children: [{ text: "" }] }]);
  });
});
