import { describe, expect, it } from "vitest";
import {
  projectWikiIndexToPrompt,
  type ProjectWikiIndex,
} from "./project-wiki-index";

describe("projectWikiIndexToPrompt", () => {
  it("summarizes linked project pages for chat context", () => {
    const index: ProjectWikiIndex = {
      projectId: "project-1",
      totals: { pages: 3, wikiLinks: 4 },
      pages: [
        {
          id: "n1",
          title: "Orphan",
          type: "note",
          sourceType: null,
          summary: "",
          updatedAt: "2026-05-13T00:00:00.000Z",
          inboundLinks: 0,
          outboundLinks: 0,
        },
        {
          id: "n2",
          title: "Compiler",
          type: "wiki",
          sourceType: "manual",
          summary: "Maintains wiki pages.",
          updatedAt: "2026-05-13T00:00:00.000Z",
          inboundLinks: 3,
          outboundLinks: 1,
        },
      ],
    };

    expect(projectWikiIndexToPrompt(index)).toContain("## Project Wiki Index");
    expect(projectWikiIndexToPrompt(index)).toContain("Pages: 3");
    expect(projectWikiIndexToPrompt(index)).toContain("Wiki links: 4");
    expect(projectWikiIndexToPrompt(index)).toContain(
      "- Compiler (wiki; in:3, out:1) - Maintains wiki pages.",
    );
  });
});
