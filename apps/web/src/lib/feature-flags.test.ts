import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDeepResearchEnabled,
  isManagedDeepResearchEnabled,
} from "./feature-flags";

describe("feature-flags", () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
  });
  afterEach(() => {
    process.env = saved;
  });

  it("isDeepResearchEnabled defaults false", () => {
    delete process.env.FEATURE_DEEP_RESEARCH;
    expect(isDeepResearchEnabled()).toBe(false);
  });

  it("isDeepResearchEnabled returns true for 'true' (case-insensitive)", () => {
    process.env.FEATURE_DEEP_RESEARCH = "True";
    expect(isDeepResearchEnabled()).toBe(true);
  });

  it("isDeepResearchEnabled is false for any non-true value", () => {
    process.env.FEATURE_DEEP_RESEARCH = "1";
    expect(isDeepResearchEnabled()).toBe(false);
  });

  it("isManagedDeepResearchEnabled defaults false", () => {
    delete process.env.FEATURE_MANAGED_DEEP_RESEARCH;
    expect(isManagedDeepResearchEnabled()).toBe(false);
  });

  it("isManagedDeepResearchEnabled true for 'true'", () => {
    process.env.FEATURE_MANAGED_DEEP_RESEARCH = "true";
    expect(isManagedDeepResearchEnabled()).toBe(true);
  });
});
