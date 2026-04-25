import { describe, it, expect } from "vitest";
import { extractWikiLinkTargets } from "../src/wiki-link-sync.js";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";
const ID_C = "33333333-3333-3333-3333-333333333333";

describe("extractWikiLinkTargets", () => {
  it("returns empty set for non-array root", () => {
    expect(extractWikiLinkTargets(null)).toEqual(new Set());
    expect(extractWikiLinkTargets(undefined)).toEqual(new Set());
    expect(extractWikiLinkTargets({})).toEqual(new Set());
    expect(extractWikiLinkTargets("nope")).toEqual(new Set());
  });

  it("finds a single top-level wiki-link", () => {
    const v = [
      { type: "p", children: [
        { text: "see " },
        { type: "wiki-link", targetId: ID_A, title: "A", children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set([ID_A]));
  });

  it("dedupes identical targets", () => {
    const v = [
      { type: "p", children: [
        { type: "wiki-link", targetId: ID_A, title: "A", children: [{ text: "" }] },
        { type: "wiki-link", targetId: ID_A, title: "A", children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set([ID_A]));
  });

  it("walks deeply nested children", () => {
    const v = [
      { type: "blockquote", children: [
        { type: "p", children: [
          { type: "ul", children: [
            { type: "li", children: [
              { type: "wiki-link", targetId: ID_B, title: "B", children: [{ text: "" }] },
            ] },
          ] },
        ] },
      ] },
      { type: "p", children: [
        { type: "wiki-link", targetId: ID_C, title: "C", children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set([ID_B, ID_C]));
  });

  it("rejects non-UUID targetId", () => {
    const v = [
      { type: "p", children: [
        { type: "wiki-link", targetId: "not-a-uuid", children: [{ text: "" }] },
        { type: "wiki-link", targetId: 12345, children: [{ text: "" }] },
      ] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set());
  });

  it("ignores nodes with the wrong type", () => {
    const v = [
      { type: "mention", targetId: ID_A, children: [{ text: "" }] },
      { type: "link", url: "https://...", children: [{ text: "" }] },
    ];
    expect(extractWikiLinkTargets(v)).toEqual(new Set());
  });
});
