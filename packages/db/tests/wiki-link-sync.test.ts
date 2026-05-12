import { describe, expect, it } from "vitest";
import {
  extractWikiLinkReferences,
  extractWikiLinkTargets,
} from "../src/lib/wiki-link-sync";

describe("extractWikiLinkTargets", () => {
  it("extracts editor and imported wiki-link node variants", () => {
    const editorTarget = "11111111-1111-4111-8111-111111111111";
    const importedTarget = "22222222-2222-4222-8222-222222222222";

    const targets = extractWikiLinkTargets([
      {
        type: "p",
        children: [
          {
            type: "wiki-link",
            targetId: editorTarget,
            children: [{ text: "Editor link" }],
          },
          {
            type: "wikilink",
            noteId: importedTarget,
            children: [{ text: "Imported link" }],
          },
        ],
      },
    ]);

    expect([...targets].sort()).toEqual([editorTarget, importedTarget].sort());
  });
});

describe("extractWikiLinkReferences", () => {
  it("keeps unresolved imported wiki-link labels as title references", () => {
    const value = [
      {
        type: "p",
        children: [
          {
            type: "wikilink",
            noteId: null,
            label: "운영체제",
            children: [{ text: "운영체제" }],
          },
        ],
      },
    ];
    const references = extractWikiLinkReferences(value);

    expect(references.targetIds).toEqual(new Set());
    expect(references.targetTitles).toEqual(new Set(["운영체제"]));
    expect(extractWikiLinkTargets(value)).toEqual(new Set(["운영체제"]));
  });
});
