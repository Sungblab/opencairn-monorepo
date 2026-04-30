import { describe, expect, it } from "vitest";

import {
  canonicalizeForHash,
  contentHash,
  previewText,
  stableJson,
} from "../src/lib/note-version-hash";

describe("note version hashing", () => {
  it("is stable across object key order", () => {
    const a = [{ type: "p", children: [{ text: "hello", bold: true }] }];
    const b = [{ children: [{ bold: true, text: "hello" }], type: "p" }];

    expect(contentHash({ title: "T", content: a })).toBe(
      contentHash({ title: "T", content: b }),
    );
  });

  it("includes title in the hash", () => {
    const content = [{ type: "p", children: [{ text: "hello" }] }];

    expect(contentHash({ title: "A", content })).not.toBe(
      contentHash({ title: "B", content }),
    );
  });

  it("removes volatile keys before hashing", () => {
    expect(
      canonicalizeForHash({
        type: "p",
        id: "stable",
        updatedAt: "2026-04-30",
        createdAt: "2026-04-29",
        selection: { anchor: 1 },
        cursor: { x: 1 },
        awareness: { users: [] },
        children: [{ text: "x" }],
      }),
    ).toEqual({
      children: [{ text: "x" }],
      id: "stable",
      type: "p",
    });
  });

  it("serializes canonical JSON deterministically", () => {
    expect(stableJson({ b: 1, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":1}',
    );
  });

  it("creates short previews", () => {
    expect(previewText("a".repeat(160))).toBe(`${"a".repeat(117)}...`);
  });
});
