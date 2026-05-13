import { describe, expect, it } from "vitest";
import {
  getProjectTemplate,
  getResolvedProjectTemplate,
  projectTemplates,
} from "../src/project-templates";

describe("project templates", () => {
  it("keeps template ids unique", () => {
    const ids = projectTemplates.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defines focused knowledge-work templates", () => {
    const template = getProjectTemplate("source_library");

    expect(template?.projects.map((project) => project.nameKey)).toEqual([
      "sourceLibrary.project.name",
    ]);
  });

  it("resolves project copy by locale", () => {
    const ko = getResolvedProjectTemplate("source_library", "ko");
    const en = getResolvedProjectTemplate("source_library", "en-US,en;q=0.9");

    expect(ko?.projects.map((project) => project.name)).toEqual(["자료 분석 프로젝트"]);
    expect(en?.projects.map((project) => project.name)).toEqual(["Source analysis project"]);
  });

  it("only ships starter notes with usable titles", () => {
    for (const template of projectTemplates) {
      const resolved = getResolvedProjectTemplate(template.id, "ko");
      expect(resolved).not.toBeNull();
      for (const project of resolved?.projects ?? []) {
        for (const note of project.notes) {
          expect(note.title.trim()).not.toBe("");
          expect(note.contentText.trim()).not.toBe("");
        }
      }
    }
  });
});
