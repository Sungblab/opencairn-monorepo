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

  it("defines a school bundle with the core subject projects", () => {
    const template = getProjectTemplate("school_subjects");

    expect(template?.projects.map((project) => project.nameKey)).toEqual([
      "subjects.korean.name",
      "subjects.math.name",
      "subjects.english.name",
      "subjects.science.name",
    ]);
  });

  it("resolves project copy by locale", () => {
    const ko = getResolvedProjectTemplate("school_subjects", "ko");
    const en = getResolvedProjectTemplate("school_subjects", "en-US,en;q=0.9");

    expect(ko?.projects.map((project) => project.name)).toEqual([
      "국어",
      "수학",
      "영어",
      "과학",
    ]);
    expect(en?.projects.map((project) => project.name)).toEqual([
      "Korean",
      "Math",
      "English",
      "Science",
    ]);
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
