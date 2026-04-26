import { describe, it, expect } from "vitest";
import {
  loadTemplate,
  listTemplates,
  renderPrompt,
  validateOutput,
  buildTemplateOutput,
} from "../src/engine.js";
import type { TemplateContext } from "../src/types.js";

describe("loadTemplate", () => {
  it("loads quiz template by id", () => {
    const t = loadTemplate("quiz");
    expect(t.id).toBe("quiz");
    expect(t.renderer).toBe("structured");
    expect(Array.isArray(t.variables)).toBe(true);
    expect(t.variables).toContain("topic");
  });

  it("returns same object on second call (cache hit)", () => {
    const a = loadTemplate("flashcard");
    const b = loadTemplate("flashcard");
    expect(a).toBe(b);
  });

  it("throws for unknown template id", () => {
    expect(() => loadTemplate("nonexistent")).toThrow();
  });
});

describe("listTemplates", () => {
  it("returns all 9 templates", () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(9);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain("quiz");
    expect(ids).toContain("flashcard");
    expect(ids).toContain("fill-blank");
    expect(ids).toContain("mock-exam");
    expect(ids).toContain("teach-back");
    expect(ids).toContain("concept-compare");
    expect(ids).toContain("slides");
    expect(ids).toContain("mindmap");
    expect(ids).toContain("cheatsheet");
  });

  it("canvas templates have renderer=canvas", () => {
    const templates = listTemplates();
    const canvasOnes = templates.filter((t) => t.renderer === "canvas");
    expect(canvasOnes.map((t) => t.id).sort()).toEqual(
      ["cheatsheet", "mindmap", "slides"]
    );
  });
});

describe("renderPrompt", () => {
  it("interpolates all variables", () => {
    const t = loadTemplate("quiz");
    const ctx: TemplateContext = {
      topic: "JavaScript Closures",
      context: "A closure is a function...",
      num_questions: "5",
    };
    const prompt = renderPrompt(t, ctx);
    expect(prompt).toContain("JavaScript Closures");
    expect(prompt).toContain("5");
  });

  it("throws when required variable is missing", () => {
    const t = loadTemplate("quiz");
    expect(() =>
      renderPrompt(t, { topic: "X" } as TemplateContext)
    ).toThrow(/requires variable/);
  });

  it("leaves unknown {{keys}} from context as-is if not in variables", () => {
    const t = loadTemplate("quiz");
    const ctx: TemplateContext = {
      topic: "Test",
      context: "ctx",
      num_questions: "3",
      extra_key: "should not break",
    };
    expect(() => renderPrompt(t, ctx)).not.toThrow();
  });
});

describe("validateOutput", () => {
  it("parses valid quiz output", () => {
    const t = loadTemplate("quiz");
    const raw = {
      title: "My Quiz",
      questions: [
        {
          question: "Q1?",
          options: ["A", "B", "C", "D"],
          correctIndex: 0,
          explanation: "Because A.",
        },
      ],
    };
    const result = validateOutput(t, raw);
    expect((result as any).title).toBe("My Quiz");
  });

  it("throws ZodError for invalid quiz output", () => {
    const t = loadTemplate("quiz");
    expect(() => validateOutput(t, { title: 123 })).toThrow();
  });

  it("throws for unknown output_schema_id", () => {
    const fakeTemplate = {
      id: "fake",
      name: "Fake",
      description: "",
      renderer: "structured" as const,
      prompt_template: "",
      variables: [],
      output_schema_id: "unknown_schema",
    };
    expect(() => validateOutput(fakeTemplate, {})).toThrow(
      /No schema registered/
    );
  });
});

describe("buildTemplateOutput", () => {
  it("returns complete TemplateOutput for quiz", () => {
    const rawJson = {
      title: "Closures Quiz",
      questions: [
        {
          question: "What is closure?",
          options: ["A", "B", "C", "D"],
          correctIndex: 2,
          explanation: "C is correct.",
        },
      ],
    };
    const output = buildTemplateOutput("quiz", {
      topic: "Closures",
      context: "ctx",
      num_questions: "1",
    }, rawJson);

    expect(output.templateId).toBe("quiz");
    expect(output.renderer).toBe("structured");
    expect((output.data as any).title).toBe("Closures Quiz");
    expect(output.rawPrompt).toContain("Closures");
  });
});
