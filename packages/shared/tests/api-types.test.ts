import { describe, expect, it } from "vitest";
import {
  createNoteSchema,
  patchCanvasSchema,
  canvasLanguageSchema,
} from "../src/api-types";

describe("createNoteSchema (canvas extension)", () => {
  const baseValid = {
    projectId: "00000000-0000-0000-0000-000000000001",
  };

  it("rejects sourceType='canvas' without canvasLanguage", () => {
    const r = createNoteSchema.safeParse({ ...baseValid, sourceType: "canvas" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toContain("canvasLanguage");
      expect(r.error.issues[0].message).toBe(
        "canvasLanguage required when sourceType=canvas",
      );
    }
  });

  it("accepts non-canvas sourceType with stray canvasLanguage (DB CHECK enforces, not API)", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "manual",
      canvasLanguage: "python",
    });
    expect(r.success).toBe(true);
  });

  it("accepts sourceType='canvas' + canvasLanguage='python'", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "print('hi')",
    });
    expect(r.success).toBe(true);
  });

  it("contentText > 64KB rejected", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "a".repeat(64 * 1024 + 1),
    });
    expect(r.success).toBe(false);
  });

  it("works without canvas fields (backward compat)", () => {
    const r = createNoteSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe("");
    }
  });

  it("accepts a unified tree parent for child page creation", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      parentTreeNodeId: "00000000-0000-0000-0000-000000000002",
    });
    expect(r.success).toBe(true);
  });
});

describe("patchCanvasSchema", () => {
  it("accepts source + language", () => {
    const r = patchCanvasSchema.safeParse({ source: "x", language: "python" });
    expect(r.success).toBe(true);
  });

  it("source > 64KB rejected", () => {
    const r = patchCanvasSchema.safeParse({ source: "a".repeat(64 * 1024 + 1) });
    expect(r.success).toBe(false);
  });

  it("invalid language rejected", () => {
    const r = patchCanvasSchema.safeParse({ source: "x", language: "ruby" });
    expect(r.success).toBe(false);
  });

  it("accepts source without language (language is optional)", () => {
    const r = patchCanvasSchema.safeParse({ source: "x" });
    expect(r.success).toBe(true);
  });
});

describe("canvasLanguageSchema", () => {
  it("accepts 4 known languages", () => {
    expect(canvasLanguageSchema.safeParse("python").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("javascript").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("html").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("react").success).toBe(true);
  });
});
