import { describe, expect, it } from "vitest";
import { extractWikiLinkTargets } from "../src/lib/wiki-link-sync";

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
