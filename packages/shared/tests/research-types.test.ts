import { describe, it, expect } from "vitest";
import {
  createResearchRunSchema,
  addTurnSchema,
  updatePlanSchema,
  researchModelValues,
  researchBillingPathValues,
  type ResearchRunSummary,
  type ResearchRunDetail,
} from "../src/research-types.js";

describe("createResearchRunSchema", () => {
  it("accepts minimal valid input", () => {
    const parsed = createResearchRunSchema.parse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      topic: "How did LLM scaling laws evolve in 2024-2026?",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
    });
    expect(parsed.model).toBe("deep-research-preview-04-2026");
  });

  it("rejects empty topic", () => {
    expect(() =>
      createResearchRunSchema.parse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        topic: "",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    ).toThrow();
  });

  it("rejects unknown model enum", () => {
    expect(() =>
      createResearchRunSchema.parse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        topic: "valid",
        model: "gpt-5",
        billingPath: "byok",
      }),
    ).toThrow();
  });

  it("rejects unknown billingPath", () => {
    expect(() =>
      createResearchRunSchema.parse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        topic: "valid",
        model: "deep-research-preview-04-2026",
        billingPath: "crypto",
      }),
    ).toThrow();
  });
});

describe("addTurnSchema", () => {
  it("requires non-empty feedback", () => {
    expect(() => addTurnSchema.parse({ feedback: "" })).toThrow();
  });
  it("enforces max length", () => {
    expect(() => addTurnSchema.parse({ feedback: "x".repeat(8001) })).toThrow();
  });
  it("accepts valid", () => {
    expect(addTurnSchema.parse({ feedback: "narrow to 2025 only" }).feedback).toBe(
      "narrow to 2025 only",
    );
  });
});

describe("updatePlanSchema", () => {
  it("requires non-empty edited_text", () => {
    expect(() => updatePlanSchema.parse({ editedText: "" })).toThrow();
  });
});

describe("enum value exports", () => {
  it("exports model values in sync with DB enum", () => {
    expect(researchModelValues).toEqual([
      "deep-research-preview-04-2026",
      "deep-research-max-preview-04-2026",
    ]);
  });
  it("exports billing path values", () => {
    expect(researchBillingPathValues).toEqual(["byok", "managed"]);
  });
});

describe("response types compile", () => {
  it("ResearchRunSummary / Detail are assignable", () => {
    // Compile-time only — narrow shape assertion.
    const s: ResearchRunSummary = {
      id: "x",
      topic: "t",
      model: "deep-research-preview-04-2026",
      status: "planning",
      billingPath: "byok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const d: ResearchRunDetail = {
      ...s,
      workspaceId: "w",
      projectId: "p",
      currentInteractionId: null,
      approvedPlanText: null,
      noteId: null,
      error: null,
      totalCostUsdCents: null,
      completedAt: null,
      turns: [],
      artifacts: [],
    };
    expect(s.id).toBe("x");
    expect(d.turns.length).toBe(0);
  });
});
