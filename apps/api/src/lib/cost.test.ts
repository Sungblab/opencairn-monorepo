import { describe, expect, it } from "vitest";
import { estimateTokenCost } from "./cost";

describe("estimateTokenCost", () => {
  it("returns USD and KRW estimates for known Gemini token usage", () => {
    const cost = estimateTokenCost({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });

    expect(cost.costUsd).toBe(0.375);
    expect(cost.costKrw).toBe(618.75);
    expect(cost.usdToKrw).toBe(1650);
  });
});
