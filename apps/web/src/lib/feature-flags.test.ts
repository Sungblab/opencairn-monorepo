import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDeepResearchEnabled,
  isImportEnabled,
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

  it("isDeepResearchEnabled defaults true", () => {
    delete process.env.FEATURE_DEEP_RESEARCH;
    expect(isDeepResearchEnabled()).toBe(true);
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

  it("isImportEnabled defaults true", () => {
    delete process.env.FEATURE_IMPORT_ENABLED;
    expect(isImportEnabled()).toBe(true);
  });

  it("isImportEnabled can be disabled explicitly", () => {
    process.env.FEATURE_IMPORT_ENABLED = "false";
    expect(isImportEnabled()).toBe(false);
  });
});
