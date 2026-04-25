import { describe, it, expect } from "vitest";
import { modeFromSourceType } from "./tabs-store";

describe("modeFromSourceType", () => {
  it("'canvas' source type → 'canvas' mode", () => {
    expect(modeFromSourceType("canvas")).toBe("canvas");
  });

  it("null source type → 'plate' mode (default)", () => {
    expect(modeFromSourceType(null)).toBe("plate");
  });

  it("other source types → 'plate' (Phase 1 baseline)", () => {
    expect(modeFromSourceType("pdf")).toBe("plate");
    expect(modeFromSourceType("manual")).toBe("plate");
  });
});
