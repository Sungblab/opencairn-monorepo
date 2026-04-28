import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getGeminiProvider,
  LLMNotConfiguredError,
} from "../../src/lib/llm/gemini.js";

describe("getGeminiProvider", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });
  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
    process.env.GOOGLE_API_KEY = originalGoogleKey;
    vi.restoreAllMocks();
  });

  it("throws LLMNotConfiguredError when no key is set", () => {
    expect(() => getGeminiProvider()).toThrowError(LLMNotConfiguredError);
  });

  it("falls back to GOOGLE_API_KEY when GEMINI_API_KEY missing", () => {
    process.env.GOOGLE_API_KEY = "AI" + "za-test-fallback";
    expect(() => getGeminiProvider()).not.toThrow();
  });

  it("LLMNotConfiguredError has code llm_not_configured", () => {
    try {
      getGeminiProvider();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMNotConfiguredError);
      expect((e as LLMNotConfiguredError).code).toBe("llm_not_configured");
    }
  });
});
