import { describe, expect, it } from "vitest";
import { getProjectTemplate, projectTemplates } from "../src/project-templates";

describe("project templates", () => {
  it("keeps template ids unique", () => {
    const ids = projectTemplates.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defines a school bundle with the core subject projects", () => {
    const template = getProjectTemplate("school_subjects");

    expect(template?.projects.map((project) => project.name)).toEqual([
      "국어",
      "수학",
      "영어",
      "과학",
    ]);
  });

  it("only ships starter notes with usable titles", () => {
    for (const template of projectTemplates) {
      for (const project of template.projects) {
        for (const note of project.notes) {
          expect(note.title.trim()).not.toBe("");
        }
      }
    }
  });
});
