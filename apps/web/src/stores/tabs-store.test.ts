import { describe, it, expect } from "vitest";
import { modeFromSourceType } from "./tabs-store";

describe("modeFromSourceType", () => {
  it("'canvas' source type → 'canvas' mode", () => {
    expect(modeFromSourceType("canvas")).toBe("canvas");
  });

  it("null source type → 'plate' mode (default)", () => {
    expect(modeFromSourceType(null)).toBe("plate");
  });

  it("'pdf' source type → 'source' mode", () => {
    expect(modeFromSourceType("pdf")).toBe("source");
  });

  it("other source types → 'plate'", () => {
    expect(modeFromSourceType("manual")).toBe("plate");
  });
});
