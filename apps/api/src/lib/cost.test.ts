import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateTokenCost } from "./cost";

describe("estimateTokenCost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Gemini 3 Flash standard pricing for chat usage", () => {
    const cost = estimateTokenCost({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });

    expect(cost.costUsd).toBe(3.5);
    expect(cost.costKrw).toBe(5775);
    expect(cost.billableCredits).toBe(9240);
    expect(cost.usdToKrw).toBe(1650);
    expect(cost.marginMultiplier).toBe(1.6);
    expect(cost.inputUsdPer1M).toBe(0.5);
    expect(cost.outputUsdPer1M).toBe(3);
  });

  it("prices Gemini embedding standard and batch usage separately", () => {
    const standard = estimateTokenCost({
      provider: "gemini",
      model: "gemini-embedding-001",
      operation: "embedding",
      tokensIn: 1_000_000,
      tokensOut: 0,
    });
    const batch = estimateTokenCost({
      provider: "gemini",
      model: "gemini-embedding-001",
      operation: "embedding.batch",
      pricingTier: "batch",
      tokensIn: 1_000_000,
      tokensOut: 0,
    });

    expect(standard.costUsd).toBe(0.15);
    expect(batch.costUsd).toBe(0.075);
    expect(standard.inputUsdPer1M).toBe(0.15);
    expect(batch.inputUsdPer1M).toBe(0.075);
  });

  it("charges cached Gemini 3 Flash input tokens at the cache rate", () => {
    const cost = estimateTokenCost({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      tokensIn: 1_000_000,
      tokensOut: 0,
      cachedTokens: 250_000,
    });

    expect(cost.costUsd).toBe(0.3875);
    expect(cost.inputUsdPer1M).toBe(0.5);
    expect(cost.cachedInputUsdPer1M).toBe(0.05);
  });

  it("lets ops adjust margin without changing raw provider cost", () => {
    vi.stubEnv("LLM_COST_MARGIN_MULTIPLIER", "2");
    const cost = estimateTokenCost({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      tokensIn: 1_000_000,
      tokensOut: 0,
    });

    expect(cost.costUsd).toBe(0.5);
    expect(cost.costKrw).toBe(825);
    expect(cost.billableCredits).toBe(1650);
    expect(cost.marginMultiplier).toBe(2);
  });
});
