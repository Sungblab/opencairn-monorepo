import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isDeepResearchEnabled,
  isImportEnabled,
  isManagedDeepResearchEnabled,
} from "../src/lib/feature-flags.js";

describe("api feature flags", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("enables Deep Research by default", () => {
    delete process.env.FEATURE_DEEP_RESEARCH;
    expect(isDeepResearchEnabled()).toBe(true);
  });

  it("allows Deep Research to be explicitly disabled", () => {
    process.env.FEATURE_DEEP_RESEARCH = "false";
    expect(isDeepResearchEnabled()).toBe(false);
  });

  it("enables Import by default", () => {
    delete process.env.FEATURE_IMPORT_ENABLED;
    expect(isImportEnabled()).toBe(true);
  });

  it("allows Import to be explicitly disabled", () => {
    process.env.FEATURE_IMPORT_ENABLED = "false";
    expect(isImportEnabled()).toBe(false);
  });

  it("keeps managed Deep Research disabled by default", () => {
    delete process.env.FEATURE_MANAGED_DEEP_RESEARCH;
    expect(isManagedDeepResearchEnabled()).toBe(false);
  });

  it("enables managed Deep Research only for true", () => {
    process.env.FEATURE_MANAGED_DEEP_RESEARCH = "true";
    expect(isManagedDeepResearchEnabled()).toBe(true);
  });
});
