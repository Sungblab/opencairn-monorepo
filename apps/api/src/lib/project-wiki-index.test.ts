import { describe, expect, it } from "vitest";
import {
  projectWikiIndexToPrompt,
  type ProjectWikiIndex,
} from "./project-wiki-index";

describe("projectWikiIndexToPrompt", () => {
  it("summarizes linked project pages for chat context", () => {
    const index: ProjectWikiIndex = {
      projectId: "project-1",
      generatedAt: "2026-05-13T00:01:00.000Z",
      latestPageUpdatedAt: "2026-05-13T00:00:00.000Z",
      totals: { pages: 3, wikiLinks: 4, orphanPages: 1 },
      links: [
        {
          sourceNoteId: "n2",
          sourceTitle: "Compiler",
          targetNoteId: "n3",
          targetTitle: "Runtime",
        },
      ],
      unresolvedLinks: [
        {
          sourceNoteId: "n2",
          sourceTitle: "Compiler",
          targetTitle: "Missing Runtime",
          reason: "missing",
        },
      ],
      recentLogs: [
        {
          noteId: "n2",
          noteTitle: "Compiler",
          agent: "librarian",
          action: "update",
          reason: "ingested new source",
          createdAt: "2026-05-13T00:02:00.000Z",
        },
      ],
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
    expect(projectWikiIndexToPrompt(index)).toContain(
      "Generated at: 2026-05-13T00:01:00.000Z",
    );
    expect(projectWikiIndexToPrompt(index)).toContain(
      "Latest page update: 2026-05-13T00:00:00.000Z",
    );
    expect(projectWikiIndexToPrompt(index)).toContain("Pages: 3");
    expect(projectWikiIndexToPrompt(index)).toContain("Wiki links: 4");
    expect(projectWikiIndexToPrompt(index)).toContain("Orphan pages: 1");
    expect(projectWikiIndexToPrompt(index)).toContain(
      "Orphan page candidates:\n- Orphan (note)",
    );
    expect(projectWikiIndexToPrompt(index)).toContain(
      "- Compiler (wiki; in:3, out:1) - Maintains wiki pages.",
    );
    expect(projectWikiIndexToPrompt(index)).toContain(
      "Wiki link map:\n- Compiler -> Runtime",
    );
    expect(projectWikiIndexToPrompt(index)).toContain(
      "Recent wiki activity:\n- 2026-05-13T00:02:00.000Z librarian update Compiler - ingested new source",
    );
    expect(projectWikiIndexToPrompt(index)).toContain(
      "Unresolved wiki links:\n- Compiler -> Missing Runtime (missing)",
    );
  });

  it("limits wiki link map entries by default", () => {
    const index: ProjectWikiIndex = {
      projectId: "project-1",
      generatedAt: "2026-05-13T00:01:00.000Z",
      latestPageUpdatedAt: "2026-05-13T00:00:00.000Z",
      totals: { pages: 30, wikiLinks: 30, orphanPages: 0 },
      links: Array.from({ length: 30 }, (_, i) => ({
        sourceNoteId: `s${i}`,
        sourceTitle: `Source ${i}`,
        targetNoteId: `t${i}`,
        targetTitle: `Target ${i}`,
      })),
      unresolvedLinks: [],
      recentLogs: [],
      pages: [],
    };

    const prompt = projectWikiIndexToPrompt(index);

    expect(prompt).toContain("- Source 23 -> Target 23");
    expect(prompt).not.toContain("- Source 24 -> Target 24");
  });
});
